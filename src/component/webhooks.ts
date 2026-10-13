import { isRecord as asRecord } from "../shared/record.js";
import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";
import type { FunctionHandle } from "convex/server";
import { normalizeEmail, normalizeRecipient } from "../shared/provider.js";
import { canTransitionStatus } from "../shared/status.js";
import {
  parseWebhookBody,
  verifyWebhookSignature,
  normalizedWebhookEventValidator,
  maxWebhookBodyBytes,
  webhookReceiptRetentionMs,
  type NormalizedWebhookEvent,
  type ParsedWebhookEvent,
} from "../shared/webhook.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { action, env, internalMutation, type MutationCtx } from "./_generated/server.js";
import schema from "./schema.js";
import { readConfig } from "../shared/config.js";
import { readTestMode } from "./config.js";
import { sha256Hex } from "../shared/crypto.js";
import { boundedPage } from "../shared/bounds.js";

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
): Promise<Doc<"messages">> {
  const next = nextStatus(event);
  const patch: Partial<Doc<"messages">> = {};
  if (event.zohoRequestId && !message.zohoRequestId) patch.zohoRequestId = event.zohoRequestId;
  if (event.zohoMessageId && !message.zohoMessageId) patch.zohoMessageId = event.zohoMessageId;
  if (next && canTransitionStatus(message.status, next, message.channel)) {
    patch.status = next;
    patch.error = undefined;
    if (next === "delivered") patch.terminalAt = undefined;
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
  return { ...message, ...patch };
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
      } catch {}
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
      testMode: message?.testMode ?? readTestMode(undefined),
      channel: "email",
      address,
      reason: event.type,
      ...(message ? { sourceMessageId: message._id } : {}),
      createdAt: Date.now(),
    });
}

type Match = { message: Doc<"messages"> | null; ambiguous: boolean };
type LookupKind = "request" | "reference" | "message";
type LookupCache = Map<string, { kind: LookupKind; rows: Doc<"messages">[] }>;

function recipientOf(event: NormalizedWebhookEvent): string | null | undefined {
  if (event.recipient === undefined) return undefined;
  if (event.channel === "unknown") return null;
  try {
    return normalizeRecipient(event.channel, event.recipient);
  } catch {
    return null;
  }
}
function compatible(
  row: Doc<"messages">,
  event: NormalizedWebhookEvent,
  recipient: string | undefined,
): boolean {
  return (
    row.channel === event.channel &&
    (!recipient || row.to === recipient) &&
    (!event.clientReference || row.clientReference === event.clientReference) &&
    (!event.zohoRequestId || !row.zohoRequestId || row.zohoRequestId === event.zohoRequestId) &&
    (!event.zohoMessageId || !row.zohoMessageId || row.zohoMessageId === event.zohoMessageId)
  );
}
function selectMatch(
  rows: Doc<"messages">[],
  event: NormalizedWebhookEvent,
  recipient: string | undefined,
): Match {
  if (rows.length > 1) return { message: null, ambiguous: true };
  const row = rows[0];
  return { message: row && compatible(row, event, recipient) ? row : null, ambiguous: false };
}
async function findMessage(
  ctx: MutationCtx,
  event: NormalizedWebhookEvent,
  cache: LookupCache,
): Promise<Match> {
  if (event.channel === "unknown") return { message: null, ambiguous: false };
  const recipient = recipientOf(event);
  if (recipient === null) return { message: null, ambiguous: false };
  const lookup = async (
    key: [LookupKind, ...unknown[]],
    read: () => Promise<Doc<"messages">[]>,
  ) => {
    const encoded = JSON.stringify(key);
    const cached = cache.get(encoded);
    if (cached) return cached.rows;
    const rows = await read();
    cache.set(encoded, { kind: key[0], rows });
    return rows;
  };
  let ambiguous = false;
  const consider = (rows: Doc<"messages">[]) => {
    const result = selectMatch(rows, event, recipient);
    ambiguous ||= result.ambiguous;
    return result.message;
  };
  if (event.zohoRequestId) {
    const addresses = recipient ? [recipient] : envelopeRecipients(event);
    if (addresses.length > 1) ambiguous = true;
    if (addresses.length === 1) {
      const address = addresses[0];
      if (address) {
        const rows = await lookup(["request", event.channel, event.zohoRequestId, address], () =>
          ctx.db
            .query("messages")
            .withIndex("by_zohoRequestId_and_to", (q) =>
              q.eq("zohoRequestId", event.zohoRequestId).eq("to", address),
            )
            .take(2),
        );
        const message = consider(rows);
        if (message) return { message, ambiguous: false };
      }
    }
  }
  if (event.clientReference) {
    const channel = event.channel;
    const referenceValue = event.clientReference;
    const rows = await lookup(["reference", event.channel, event.clientReference, recipient], () =>
      ctx.db
        .query("messages")
        .withIndex("by_channel_and_clientReference_and_to", (q) => {
          const reference = q.eq("channel", channel).eq("clientReference", referenceValue);
          return recipient ? reference.eq("to", recipient) : reference;
        })
        .take(2),
    );
    const message = consider(rows);
    if (message) return { message, ambiguous: false };
  }
  if (event.zohoMessageId) {
    const rows = await lookup(["message", event.zohoMessageId], () =>
      ctx.db
        .query("messages")
        .withIndex("by_zohoMessageId", (q) => q.eq("zohoMessageId", event.zohoMessageId))
        .take(2),
    );
    const message = consider(rows);
    if (message) return { message, ambiguous: false };
  }
  return { message: null, ambiguous };
}

export const commit = internalMutation({
  args: {
    zohoEventId: v.string(),
    bodyHash: v.string(),
    events: v.array(eventValidator),
    callbackHandle: v.optional(v.string()),
  },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("webhookReceipts")
      .withIndex("by_zohoEventId_and_reason", (q) =>
        q.eq("zohoEventId", args.zohoEventId).eq("reason", undefined),
      )
      .unique();
    if (old) return { duplicate: true };
    const sameBody = await ctx.db
      .query("webhookReceipts")
      .withIndex("by_bodyHash_and_reason", (q) =>
        q.eq("bodyHash", args.bodyHash).eq("reason", undefined),
      )
      .unique();
    if (sameBody) return { duplicate: true };
    await ctx.db.insert("webhookReceipts", {
      testMode: readTestMode(undefined),
      zohoEventId: args.zohoEventId,
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
    const cache: LookupCache = new Map();
    for (const event of args.events) {
      const duplicateRaw = (terminalRawCounts.get(JSON.stringify(event.raw)) ?? 0) > 1;
      const matched = duplicateRaw
        ? { message: null, ambiguous: true }
        : await findMessage(ctx, event, cache);
      const message = matched.message ? await ctx.db.get("messages", matched.message._id) : null;
      const ambiguous = duplicateRaw || matched.ambiguous;
      await ctx.db.insert("events", {
        ...(message ? { messageId: message._id } : {}),
        channel: event.channel,
        type: event.type,
        occurredAt: event.occurredAt,
        receivedAt: Date.now(),
        zohoEventId: args.zohoEventId,
        raw: JSON.stringify(event.raw),
        ...(event.zohoRequestId ? { zohoRequestId: event.zohoRequestId } : {}),
        ...(event.zohoMessageId ? { zohoMessageId: event.zohoMessageId } : {}),
        ...(event.clientReference ? { clientReference: event.clientReference } : {}),
        ...(event.recipient ? { recipient: event.recipient } : {}),
        ambiguous,
        testMode: message?.testMode ?? readTestMode(undefined),
      });
      if (message) {
        const updated = await applyEvent(ctx, event, message);
        for (const [key, entry] of cache) {
          if (
            (entry.kind === "request" && updated.zohoRequestId !== message.zohoRequestId) ||
            (entry.kind === "message" && updated.zohoMessageId !== message.zohoMessageId)
          )
            cache.delete(key);
          else
            cache.set(key, {
              kind: entry.kind,
              rows: entry.rows.map((row) => (row._id === updated._id ? updated : row)),
            });
        }
      } else if (!ambiguous) await addSuppression(ctx, event);
      if (args.callbackHandle) {
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
  cursor: string | null = null,
): Promise<void> {
  const page = await paginator(ctx.db, schema)
    .query("events")
    .withIndex("by_zohoRequestId_and_recipient", (q) => q.eq("zohoRequestId", requestId))
    .paginate(boundedPage({ cursor, numItems: 100 }));
  const messages: Doc<"messages">[] = [];
  for (const id of messageIds) {
    const row = await ctx.db.get("messages", id);
    if (row) messages.push(row);
  }
  for (const stored of page.page) {
    if (stored.messageId || stored.ambiguous) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(stored.raw);
    } catch {
      raw = null;
    }
    const event: NormalizedWebhookEvent = {
      zohoEventId: stored.zohoEventId,
      channel: stored.channel,
      type: recognizedEventType(stored.type),
      occurredAt: stored.occurredAt,
      recipient: stored.recipient,
      zohoRequestId: stored.zohoRequestId,
      zohoMessageId: stored.zohoMessageId,
      clientReference: stored.clientReference,
      raw,
    };
    const recipient = recipientOf(event);
    if (recipient === null) continue;
    const envelope = recipient === undefined ? envelopeRecipients(event) : [];
    const candidates = messages.filter(
      (row) =>
        compatible(row, event, recipient) &&
        (recipient !== undefined || envelope.length === 0 || envelope.includes(row.to)),
    );
    if (candidates.length !== 1) {
      if (candidates.length > 1) await ctx.db.patch("events", stored._id, { ambiguous: true });
      continue;
    }
    const candidate = candidates[0];
    if (!candidate) continue;
    const message = await ctx.db.get("messages", candidate._id);
    if (!message) continue;
    await ctx.db.patch("events", stored._id, {
      messageId: message._id,
      ambiguous: false,
      testMode: message.testMode || readTestMode(undefined),
    });
    await applyEvent(ctx, event, message);
  }
  if (!page.isDone)
    await ctx.scheduler.runAfter(0, internal.webhooks.reconcile, {
      requestId,
      messageIds,
      cursor: page.continueCursor,
    });
}
export const reconcile = internalMutation({
  args: { requestId: v.string(), messageIds: v.array(v.id("messages")), cursor: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await reconcileRequestEvents(ctx, args.requestId, args.messageIds, args.cursor);
    return null;
  },
});

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
      v.literal("stale_event"),
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
      | "invalid_payload"
      | "stale_event";
  }> => {
    if (new TextEncoder().encode(args.rawBody).byteLength > maxWebhookBodyBytes)
      return { duplicate: false, reason: "oversized_body" };
    const config = readConfig(env);
    if (!config.webhookSecret && !config.webhookSecretPrevious)
      return { duplicate: false, reason: "missing_secret" };
    if (!args.signature || new TextEncoder().encode(args.signature).byteLength > 4096)
      return { duplicate: false, reason: "invalid_signature" };
    const signed = await verifyWebhookSignature(
      args.rawBody,
      args.signature,
      config.webhookSecret,
      config.webhookSecretPrevious,
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
    const now = Date.now();
    const oldestEventAt = now - webhookReceiptRetentionMs(config.retentionDays) + 86_400_000;
    const latestEventAt = now + 5 * 60 * 1000;
    const isFresh = (event: ParsedWebhookEvent): event is NormalizedWebhookEvent =>
      event.occurredAt !== undefined &&
      event.occurredAt >= oldestEventAt &&
      event.occurredAt <= latestEventAt;
    const events = parsed.events;
    if (!events.every(isFresh)) {
      const result = await ctx.runMutation(internal.webhooks.recordFailure, {
        bodyHash,
        reason: "stale_event",
      });
      return { duplicate: result.duplicate, reason: "stale_event" };
    }
    if (
      events.length > 500 ||
      new TextEncoder().encode(JSON.stringify(events)).byteLength > 256 * 1024
    )
      return invalidPayload();
    const result = await ctx.runMutation(internal.webhooks.commit, {
      zohoEventId: parsed.zohoEventId,
      events,
      bodyHash,
      ...(args.callbackHandle ? { callbackHandle: args.callbackHandle } : {}),
    });
    return { duplicate: result.duplicate, reason: result.duplicate ? "duplicate" : "accepted" };
  },
});

export const recordFailure = internalMutation({
  args: {
    bodyHash: v.string(),
    reason: v.union(v.literal("invalid_payload"), v.literal("stale_event")),
  },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("webhookReceipts")
      .withIndex("by_bodyHash_and_reason", (q) =>
        q.eq("bodyHash", args.bodyHash).eq("reason", args.reason),
      )
      .unique();
    if (old) return { duplicate: false };
    await ctx.db.insert("webhookReceipts", {
      testMode: readTestMode(undefined),
      zohoEventId: `invalid:${args.bodyHash}`,
      bodyHash: args.bodyHash,
      reason: args.reason,
      createdAt: Date.now(),
    });
    return { duplicate: false };
  },
});
