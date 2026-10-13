import { createFunctionHandle } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import { httpAction, internalMutation, internalQuery } from "./_generated/server.js";
import { readBoundedText } from "../../src/shared/bounds.js";
import schema from "./schema.js";

const maxBodyBytes = 512 * 1024;
const maxSignatureBytes = 4096;
const maxSessionAttempts = 64;
const captureTtlMs = 30 * 60 * 1000;

export const e2eWebhook = httpAction(async (ctx, request) => {
  const session = await ctx.runQuery(internal.e2eWebhook.activeSession, {});
  if (!session || session.expiresAt <= Date.now())
    return new Response("Not found", { status: 404 });
  const reservation = await ctx.runMutation(internal.e2eWebhook.reserve, {
    sessionId: session.sessionId,
  });
  if (reservation === "quota")
    return new Response("End-to-end capture quota exceeded", { status: 429 });
  if (reservation === "inactive") return new Response("Not found", { status: 404 });
  const body = await readBoundedText(request, maxBodyBytes);
  const contentType = request.headers.get("content-type") ?? "";
  const header = request.headers.get("producer-signature") ?? undefined;
  const signature =
    header && new TextEncoder().encode(header).byteLength <= maxSignatureBytes ? header : undefined;
  let reason = body === undefined ? "unreadable_body" : "";
  if (body !== undefined) {
    try {
      const callbackHandle = await createFunctionHandle(internal.webhookEvents.record);
      const result = await ctx.runAction(components.zohoCpaas.webhooks.receive, {
        rawBody: body,
        contentType,
        ...(signature ? { signature } : {}),
        callbackHandle,
      });
      reason = result.reason;
    } catch {
      reason = "processing_failed";
    }
  }
  await ctx.runMutation(internal.e2eWebhook.capture, {
    sessionId: session.sessionId,
    rawBody: body ?? "<body unavailable>",
    contentType,
    ...(signature ? { signature } : {}),
    reason,
  });
  if (reason === "processing_failed" || reason === "missing_secret")
    return new Response("Webhook processing failed", { status: 500 });
  if (reason === "oversized_body")
    return new Response("Webhook body exceeds limit", { status: 413 });
  if (reason === "unreadable_body")
    return new Response("Webhook body exceeds limit or is not UTF-8", { status: 400 });
  if (reason === "invalid_signature")
    return new Response("Invalid webhook signature", { status: 401 });
  return new Response(reason === "duplicate" ? "Duplicate" : "OK", { status: 200 });
});

export const begin = internalMutation({
  args: { sessionId: v.string(), durationMinutes: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      !/^[a-f0-9-]{36}$/.test(args.sessionId) ||
      !Number.isInteger(args.durationMinutes) ||
      args.durationMinutes < 1 ||
      args.durationMinutes > 1440
    )
      throw new ConvexError({
        code: "ZOHO_CPAAS_INVALID_ARGUMENT",
        message: "Invalid e2e session configuration",
      });
    const old = await ctx.db
      .query("e2eWebhookSession")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .unique();
    if (old?.sessionId === args.sessionId) {
      await ctx.db.patch("e2eWebhookSession", old._id, {
        expiresAt: Date.now() + args.durationMinutes * 60_000,
      });
      return null;
    }
    if (old) await ctx.db.delete("e2eWebhookSession", old._id);
    await ctx.db.insert("e2eWebhookSession", {
      key: "current",
      sessionId: args.sessionId,
      expiresAt: Date.now() + args.durationMinutes * 60_000,
      attemptCount: 0,
      quotaExceeded: false,
    });
    return null;
  },
});

export const activeSession = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      sessionId: v.string(),
      expiresAt: v.number(),
      attemptCount: v.number(),
      quotaExceeded: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("e2eWebhookSession")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .unique();
    return row
      ? {
          sessionId: row.sessionId,
          expiresAt: row.expiresAt,
          attemptCount: row.attemptCount,
          quotaExceeded: row.quotaExceeded,
        }
      : null;
  },
});

export const reserve = internalMutation({
  args: { sessionId: v.string() },
  returns: v.union(v.literal("reserved"), v.literal("quota"), v.literal("inactive")),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("e2eWebhookSession")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .unique();
    if (!session || session.sessionId !== args.sessionId || session.expiresAt <= Date.now())
      return "inactive";
    if (session.attemptCount >= maxSessionAttempts) {
      if (!session.quotaExceeded)
        await ctx.db.patch("e2eWebhookSession", session._id, { quotaExceeded: true });
      return "quota";
    }
    await ctx.db.patch("e2eWebhookSession", session._id, {
      attemptCount: session.attemptCount + 1,
    });
    return "reserved";
  },
});

export const end = internalMutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("e2eWebhookSession")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .unique();
    if (row?.sessionId === args.sessionId) await ctx.db.delete("e2eWebhookSession", row._id);
    return null;
  },
});

export const capture = internalMutation({
  args: {
    sessionId: v.string(),
    rawBody: v.string(),
    contentType: v.string(),
    signature: v.optional(v.string()),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("e2eWebhookSession")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .unique();
    if (session?.sessionId !== args.sessionId || session.expiresAt <= Date.now()) return null;
    const id = await ctx.db.insert("e2eWebhookAttempts", { ...args, receivedAt: Date.now() });
    await ctx.scheduler.runAfter(captureTtlMs, internal.e2eWebhook.expire, { id });
    return null;
  },
});

export const pending = internalQuery({
  args: { sessionId: v.string() },
  returns: v.array(schema.doc("e2eWebhookAttempts")),
  handler: (ctx, args) =>
    ctx.db
      .query("e2eWebhookAttempts")
      .withIndex("by_sessionId_and_receivedAt", (q) => q.eq("sessionId", args.sessionId))
      .take(10),
});

export const clear = internalMutation({
  args: { sessionId: v.string(), ids: v.array(v.id("e2eWebhookAttempts")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Promise.all(
      args.ids.map(async (id) => {
        const row = await ctx.db.get("e2eWebhookAttempts", id);
        if (row?.sessionId === args.sessionId) await ctx.db.delete("e2eWebhookAttempts", id);
      }),
    );
    return null;
  },
});

export const expire = internalMutation({
  args: { id: v.id("e2eWebhookAttempts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("e2eWebhookAttempts", args.id);
    if (row) await ctx.db.delete("e2eWebhookAttempts", args.id);
    return null;
  },
});
