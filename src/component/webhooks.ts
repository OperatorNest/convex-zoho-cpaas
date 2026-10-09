import { isRecord as asRecord } from "../shared/record.js";
import { v } from "convex/values";
import type { FunctionHandle } from "convex/server";
import { normalizeEmail, normalizeRecipient } from "../shared/provider.js";
import { canTransitionStatus } from "../shared/status.js";
import {
  parseWebhookBody,
  verifyWebhookSignature,
  normalizedWebhookEventValidator,
  maxWebhookBodyBytes,
  type NormalizedWebhookEvent,
} from "../shared/webhook.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { action, env, internalMutation, type MutationCtx } from "./_generated/server.js";
import { resolveTestMode } from "./config.js";
import { sha256Hex } from "../shared/crypto.js";

const eventValidator = normalizedWebhookEventValidator;

function recognizedEventType(type: string): NormalizedWebhookEvent["type"] {
  switch (type) {
    case "hardbounce":
    case "softbounce":
    case "complaint":
    case "open":
    case "click":
    case "delivered":
    case "read":
    case "undelivered":
    case "failed":
      return type;
    default:
      return "unknown";
  }
}

function nextStatus(event: NormalizedWebhookEvent): Doc<"messages">["status"] | null {
  if (event.channel === "email") {
    const mapping: Record<string, Doc<"messages">["status"]> = {
      hardbounce: "bounced",
      complaint: "complained",
    };
    return mapping[event.type] ?? null;
  }
  const mapping: Record<string, Doc<"messages">["status"]> = {
    delivered: "delivered",
    read: "read",
    undelivered: "failed",
    failed: "failed",
  };
  return mapping[event.type] ?? null;
}

async function applyEvent(
  ctx: MutationCtx,
  event: NormalizedWebhookEvent,
  message: Doc<"messages">,
): Promise<void> {
  const next = nextStatus(event);
  const patch: Partial<Doc<"messages">> = {};
  if (event.providerRequestId && !message.providerRequestId)
    patch.providerRequestId = event.providerRequestId;
  if (event.providerMessageId && !message.providerMessageId)
    patch.providerMessageId = event.providerMessageId;
  if (next && canTransitionStatus(message.status, next, message.channel)) {
    patch.status = next;
    if (next === "bounced" || next === "complained" || next === "failed" || next === "read")
      patch.terminalAt = Date.now();
    if (
      next === "failed" &&
      message.channel === "whatsapp" &&
      message.attempts <= 1 &&
      (event.type === "failed" || event.type === "undelivered")
    )
      patch.failureDefinitive = true;
  }
  if (Object.keys(patch).length) await ctx.db.patch("messages", message._id, patch);
  await addSuppression(ctx, event, message);
}

function envelopeRecipients(event: NormalizedWebhookEvent): string[] {
  const raw = event.raw;
  if (!asRecord(raw)) return [];
  const message = raw.event_message;
  if (!asRecord(message)) return [];
  const info = message.email_info;
  if (!asRecord(info)) return [];
  const found = new Set<string>();
  for (const field of ["to", "cc", "bcc"]) {
    const list = info[field];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!asRecord(item)) continue;
      const email = item.email_address;
      if (!asRecord(email)) continue;
      const address = email.address;
      if (typeof address !== "string") continue;
      try {
        found.add(normalizeEmail(address));
      } catch {
        // Ignore invalid provider-controlled addresses.
      }
    }
  }
  return [...found];
}

async function addSuppression(
  ctx: MutationCtx,
  event: NormalizedWebhookEvent,
  message?: Doc<"messages">,
): Promise<void> {
  if (event.channel !== "email" || (event.type !== "hardbounce" && event.type !== "complaint"))
    return;
  const recipient = message?.to ?? event.recipient;
  if (!recipient) return;
  let address: string;
  try {
    address = normalizeEmail(recipient);
  } catch {
    return;
  }
  const old = await ctx.db
    .query("suppressions")
    .withIndex("by_channel_and_address", (q) => q.eq("channel", "email").eq("address", address))
    .unique();
  if (!old)
    await ctx.db.insert("suppressions", {
      channel: "email",
      address,
      reason: event.type,
      ...(message ? { sourceMessageId: message._id } : {}),
      createdAt: Date.now(),
    });
}

async function findMessage(
  ctx: MutationCtx,
  event: NormalizedWebhookEvent,
): Promise<{ message: Doc<"messages"> | null; ambiguous: boolean }> {
  if (event.channel === "unknown") return { message: null, ambiguous: false };
  let recipient: string | undefined;
  try {
    recipient = event.recipient ? normalizeRecipient(event.channel, event.recipient) : undefined;
  } catch {
    recipient = undefined;
  }
  if (event.providerRequestId && recipient) {
    const exact = await ctx.db
      .query("messages")
      .withIndex("by_providerRequestId_and_to", (q) =>
        q.eq("providerRequestId", event.providerRequestId).eq("to", recipient),
      )
      .unique();
    if (exact && exact.channel === event.channel) return { message: exact, ambiguous: false };
  }
  let fallbackAmbiguous = false;
  if (event.providerRequestId && event.channel === "email") {
    const candidates = envelopeRecipients(event);
    const addresses = [...new Set([...(recipient ? [recipient] : []), ...candidates])];
    const matching: Doc<"messages">[] = [];
    for (const address of addresses) {
      const row = await ctx.db
        .query("messages")
        .withIndex("by_providerRequestId_and_to", (q) =>
          q.eq("providerRequestId", event.providerRequestId).eq("to", address),
        )
        .unique();
      if (row?.channel === "email" && !matching.some((candidate) => candidate._id === row._id))
        matching.push(row);
    }
    if (matching.length === 1 && matching[0]) return { message: matching[0], ambiguous: false };
    fallbackAmbiguous = matching.length > 1;
  }
  if (event.clientReference) {
    const clientReference = event.clientReference;
    const matches = await ctx.db
      .query("messages")
      .withIndex("by_clientReference", (q) => q.eq("clientReference", clientReference))
      .take(501);
    const eligible = matches.filter(
      (row) =>
        row.channel === event.channel &&
        (!recipient || row.to === recipient) &&
        (!event.providerRequestId ||
          !row.providerRequestId ||
          row.providerRequestId === event.providerRequestId),
    );
    if (matches.length < 501 && eligible.length === 1)
      return { message: eligible[0] ?? null, ambiguous: false };
    if (matches.length < 501 && eligible.length > 1) fallbackAmbiguous = true;
  }
  if (event.providerMessageId) {
    const matches = await ctx.db
      .query("messages")
      .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", event.providerMessageId))
      .take(2);
    const eligible = matches.filter(
      (row) => row.channel === event.channel && (!recipient || row.to === recipient),
    );
    if (matches.length < 2 && eligible.length === 1)
      return { message: eligible[0] ?? null, ambiguous: false };
    if (matches.length < 2 && eligible.length > 1) fallbackAmbiguous = true;
  }
  return { message: null, ambiguous: fallbackAmbiguous };
}

export const commit = internalMutation({
  args: {
    providerEventId: v.string(),
    bodyHash: v.string(),
    events: v.array(eventValidator),
    callbackHandle: v.optional(v.string()),
  },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("webhookReceipts")
      .withIndex("by_providerEventId", (q) => q.eq("providerEventId", args.providerEventId))
      .unique();
    if (old) return { duplicate: true };
    const sameBody = await ctx.db
      .query("webhookReceipts")
      .withIndex("by_bodyHash", (q) => q.eq("bodyHash", args.bodyHash))
      .unique();
    if (sameBody) return { duplicate: true };
    await ctx.db.insert("webhookReceipts", {
      providerEventId: args.providerEventId,
      bodyHash: args.bodyHash,
      createdAt: Date.now(),
    });
    const terminalRawCounts = new Map<string, number>();
    for (const event of args.events)
      if (
        event.channel === "email" &&
        (event.type === "hardbounce" || event.type === "complaint")
      ) {
        const key = JSON.stringify(event.raw);
        terminalRawCounts.set(key, (terminalRawCounts.get(key) ?? 0) + 1);
      }
    for (const event of args.events) {
      const duplicateRaw = (terminalRawCounts.get(JSON.stringify(event.raw)) ?? 0) > 1;
      const matched = duplicateRaw
        ? { message: null, ambiguous: true }
        : await findMessage(ctx, event);
      const message = matched.message;
      const ambiguous = duplicateRaw || matched.ambiguous;
      await ctx.db.insert("events", {
        ...(message ? { messageId: message._id } : {}),
        channel: event.channel,
        type: event.type,
        occurredAt: event.occurredAt,
        receivedAt: Date.now(),
        providerEventId: args.providerEventId,
        raw: JSON.stringify(event.raw),
        ...(event.providerRequestId ? { providerRequestId: event.providerRequestId } : {}),
        ...(event.providerMessageId ? { providerMessageId: event.providerMessageId } : {}),
        ...(event.clientReference ? { clientReference: event.clientReference } : {}),
        ...(event.recipient ? { recipient: event.recipient } : {}),
        ambiguous,
        ...(message?.testMode || resolveTestMode(undefined) ? { testMode: true } : {}),
      });
      if (message) await applyEvent(ctx, event, message);
      else if (!ambiguous) await addSuppression(ctx, event);
      if (args.callbackHandle) {
        // Function handles originate from createFunctionHandle in the app route.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex serializes function handles as strings
        await ctx.runMutation(args.callbackHandle as FunctionHandle<"mutation">, {
          event,
          ...(message ? { messageId: message._id } : {}),
          ambiguous,
        });
      }
    }
    return { duplicate: false };
  },
});

export async function reconcileRequestEvents(
  ctx: MutationCtx,
  requestId: string,
  messageIds: Id<"messages">[],
): Promise<void> {
  const events = await ctx.db
    .query("events")
    .withIndex("by_providerRequestId_and_recipient", (q) => q.eq("providerRequestId", requestId))
    .take(501);
  if (events.length > 500) return;
  const messages: Doc<"messages">[] = [];
  for (const id of messageIds) {
    const row = await ctx.db.get("messages", id);
    if (row) messages.push(row);
  }
  for (const event of events) {
    if (event.messageId) continue;
    let recipient: string | undefined;
    try {
      recipient = event.recipient
        ? normalizeRecipient(event.channel === "unknown" ? "email" : event.channel, event.recipient)
        : undefined;
    } catch {
      continue;
    }
    let storedRaw: unknown;
    try {
      storedRaw = JSON.parse(event.raw);
    } catch {
      storedRaw = null;
    }
    const candidates =
      event.channel === "email"
        ? envelopeRecipients({
            providerEventId: event.providerEventId,
            type: recognizedEventType(event.type),
            channel: event.channel,
            occurredAt: event.occurredAt,
            raw: storedRaw,
          })
        : [];
    const addresses = new Set([...(recipient ? [recipient] : []), ...candidates]);
    let fallbackAmbiguous = false;
    let match: Doc<"messages"> | undefined;
    if (recipient) {
      const exact = messages.filter((row) => row.channel === event.channel && row.to === recipient);
      if (exact.length === 1) match = exact[0];
      else if (exact.length > 1) fallbackAmbiguous = true;
    }
    if (!match && event.clientReference) {
      const byReference = messages.filter(
        (row) =>
          row.channel === event.channel &&
          row.clientReference === event.clientReference &&
          (!event.providerRequestId ||
            !row.providerRequestId ||
            row.providerRequestId === event.providerRequestId),
      );
      if (byReference.length === 1) match = byReference[0];
      else if (byReference.length > 1) fallbackAmbiguous = true;
    }
    if (!match && event.providerMessageId) {
      const byProviderId = messages.filter(
        (row) =>
          row.channel === event.channel &&
          row.providerMessageId === event.providerMessageId &&
          (!recipient || row.to === recipient),
      );
      if (byProviderId.length === 1) match = byProviderId[0];
      else if (byProviderId.length > 1) fallbackAmbiguous = true;
    }
    if (!match) {
      const fallback = messages.filter(
        (row) => row.channel === event.channel && (addresses.size === 0 || addresses.has(row.to)),
      );
      if (fallback.length === 1) match = fallback[0];
      else if (fallback.length > 1) fallbackAmbiguous = true;
    }
    if (!match) {
      if (fallbackAmbiguous) await ctx.db.patch("events", event._id, { ambiguous: true });
      continue;
    }
    const message = await ctx.db.get("messages", match._id);
    if (!message) continue;
    await ctx.db.patch("events", event._id, { messageId: message._id, ambiguous: false });
    let raw: unknown;
    try {
      raw = JSON.parse(event.raw);
    } catch {
      raw = null;
    }
    await applyEvent(
      ctx,
      {
        providerEventId: event.providerEventId,
        channel: event.channel,
        type: recognizedEventType(event.type),
        occurredAt: event.occurredAt,
        ...(event.recipient ? { recipient: event.recipient } : {}),
        ...(event.providerRequestId ? { providerRequestId: event.providerRequestId } : {}),
        ...(event.providerMessageId ? { providerMessageId: event.providerMessageId } : {}),
        ...(event.clientReference ? { clientReference: event.clientReference } : {}),
        raw,
      },
      message,
    );
    if (message.testMode || resolveTestMode(undefined))
      await ctx.db.patch("events", event._id, { testMode: true });
  }
}

export const receive = action({
  args: {
    rawBody: v.string(),
    contentType: v.string(),
    signature: v.optional(v.string()),
    callbackHandle: v.optional(v.string()),
  },
  returns: v.object({
    duplicate: v.boolean(),
    reason: v.union(
      v.literal("accepted"),
      v.literal("duplicate"),
      v.literal("invalid_signature"),
      v.literal("missing_secret"),
      v.literal("oversized_body"),
      v.literal("invalid_payload"),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    duplicate: boolean;
    reason:
      | "accepted"
      | "duplicate"
      | "invalid_signature"
      | "missing_secret"
      | "oversized_body"
      | "invalid_payload";
  }> => {
    if (new TextEncoder().encode(args.rawBody).byteLength > maxWebhookBodyBytes)
      return { duplicate: false, reason: "oversized_body" };
    if (!env.ZOHO_CPAAS_WEBHOOK_SECRET && !env.ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS)
      return { duplicate: false, reason: "missing_secret" };
    if (!args.signature || new TextEncoder().encode(args.signature).byteLength > 4096)
      return { duplicate: false, reason: "invalid_signature" };
    const signed = await verifyWebhookSignature(
      args.rawBody,
      args.signature,
      env.ZOHO_CPAAS_WEBHOOK_SECRET,
      env.ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS,
    );
    if (signed === null) return { duplicate: false, reason: "invalid_signature" };
    const bodyHash = await sha256Hex(args.rawBody);
    const invalidPayload = async () => {
      const result = await ctx.runMutation(internal.webhooks.recordFailure, {
        bodyHash,
        reason: "invalid_payload",
      });
      return {
        duplicate: result.duplicate,
        reason: "invalid_payload" as const,
      };
    };
    if (
      !/^(application\/json|application\/x-www-form-urlencoded)(\s*;|\s*$)/i.test(args.contentType)
    )
      return invalidPayload();
    const parsed = parseWebhookBody(signed);
    if (!parsed) return invalidPayload();
    if (parsed.events.length === 0 || parsed.events.every((event) => event.channel === "unknown"))
      return invalidPayload();
    if (
      parsed.events.length > 500 ||
      new TextEncoder().encode(JSON.stringify(parsed.events)).byteLength > 256 * 1024
    )
      return invalidPayload();
    const result = await ctx.runMutation(internal.webhooks.commit, {
      ...parsed,
      bodyHash,
      ...(args.callbackHandle ? { callbackHandle: args.callbackHandle } : {}),
    });
    return { duplicate: result.duplicate, reason: result.duplicate ? "duplicate" : "accepted" };
  },
});

export const recordFailure = internalMutation({
  args: { bodyHash: v.string(), reason: v.string() },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("webhookReceipts")
      .withIndex("by_bodyHash", (q) => q.eq("bodyHash", args.bodyHash))
      .unique();
    if (old) return { duplicate: true };
    await ctx.db.insert("webhookReceipts", {
      providerEventId: `invalid:${args.bodyHash}`,
      bodyHash: args.bodyHash,
      reason: args.reason,
      createdAt: Date.now(),
    });
    return { duplicate: false };
  },
});
