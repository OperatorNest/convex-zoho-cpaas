import { isRecord as isObject } from "./record.js";
import type { Channel } from "./status.js";
import { normalizeEmail, normalizePhone } from "./provider.js";
import { v, type Infer } from "convex/values";
import { channelValidator } from "./validators.js";

export const maxWebhookBodyBytes = 512 * 1024;

export function webhookReceiptRetentionMs(retentionDays: number): number {
  return Math.max(retentionDays, 30) * 86_400_000;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function decodedBody(rawBody: string): string | null {
  const trimmed = rawBody.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return rawBody;
  try {
    const decoded = decodeURIComponent(rawBody.replace(/\+/g, " "));
    const separator = decoded.indexOf("=");
    return separator > 0 ? decoded.slice(separator + 1) : null;
  } catch {
    return null;
  }
}

function signatureBytes(encoded: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(encoded);
    if (binary.length !== 32) return null;
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function verifyWith(
  secret: string,
  body: string,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(body));
}

export async function verifyWebhookSignature(
  rawBody: string,
  header: string | null | undefined,
  currentSecret: string | null | undefined,
  previousSecret?: string | null,
  nowMs = Date.now(),
): Promise<string | null> {
  if (!header || (!currentSecret && !previousSecret)) return null;
  const parts = new Map<string, string>();
  for (const piece of header.split(";")) {
    const index = piece.indexOf("=");
    if (index > 0)
      parts.set(piece.slice(0, index).trim().toLowerCase(), piece.slice(index + 1).trim());
  }
  const timestamp = Number(parts.get("ts"));
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    nowMs - timestamp > MAX_AGE_MS ||
    timestamp - nowMs > MAX_FUTURE_SKEW_MS ||
    parts.get("s-algorithm")?.toLowerCase() !== "hmacsha256"
  )
    return null;
  const encoded = parts.get("s");
  if (!encoded) return null;
  let decodedSignature: string;
  try {
    decodedSignature = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const signature = signatureBytes(decodedSignature) ?? signatureBytes(encoded);
  const decoded = decodedBody(rawBody);
  if (!signature) return null;
  // Zoho signs URL-decoded form bodies. A signed body that is not a supported form or JSON shape
  // still authenticates as exact textbody, so it can be acknowledged and recorded as a failed receipt.
  const body = decoded ?? rawBody;
  if (currentSecret && (await verifyWith(currentSecret, body, signature))) return body;
  if (previousSecret && (await verifyWith(previousSecret, body, signature))) return body;
  return null;
}

type JSONObject = Record<string, unknown>;

function object(value: unknown): JSONObject | null {
  return isObject(value) ? value : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.find((part) => typeof part === "string");
  return string(value);
}

export const webhookEventTypeValidator = v.union(
  v.literal("hardbounce"),
  v.literal("softbounce"),
  v.literal("complaint"),
  v.literal("open"),
  v.literal("click"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("undelivered"),
  v.literal("failed"),
  v.literal("unknown"),
);
/** A Zoho event category used to update or observe an outbound message. */
export type WebhookEventType = Infer<typeof webhookEventTypeValidator>;
/** A signed webhook event normalized from a Zoho payload, as passed to the `onEvent` callback. */
export const normalizedWebhookEventValidator = v.object({
  zohoEventId: v.string(),
  type: webhookEventTypeValidator,
  channel: v.union(channelValidator, v.literal("unknown")),
  recipient: v.optional(v.string()),
  zohoRequestId: v.optional(v.string()),
  zohoMessageId: v.optional(v.string()),
  clientReference: v.optional(v.string()),
  occurredAt: v.number(),
  raw: v.any(),
});
/** A verified provider event normalized for stored-message correlation. */
export type NormalizedWebhookEvent = Infer<typeof normalizedWebhookEventValidator>;

const eventTypes: Record<string, WebhookEventType> = {
  hardbounce: "hardbounce",
  hard_bounce: "hardbounce",
  softbounce: "softbounce",
  soft_bounce: "softbounce",
  fbl: "complaint",
  fbl_complaint: "complaint",
  complaint: "complaint",
  feedback_loop: "complaint",
  open: "open",
  email_open: "open",
  click: "click",
  email_link_click: "click",
  delivered: "delivered",
  read: "read",
  undelivered: "undelivered",
  failed: "failed",
};

function emailRecipient(message: JSONObject): string | undefined {
  const info = object(message.email_info);
  const found = new Set<string>();
  let malformed = false;
  for (const field of [info?.to, info?.cc, info?.bcc]) {
    if (field === undefined) continue;
    if (!Array.isArray(field)) {
      malformed = true;
      continue;
    }
    for (const item of field) {
      const recipient = string(object(object(item)?.email_address)?.address);
      if (!recipient) {
        malformed = true;
        continue;
      }
      try {
        found.add(normalizeEmail(recipient));
      } catch {
        malformed = true;
      }
    }
  }
  return !malformed && found.size === 1 ? [...found][0] : undefined;
}

function hasWhatsappMarker(message: JSONObject, eventType: WebhookEventType): boolean {
  return (
    isObject(message.whatsapp_info) ||
    message.channel === "whatsapp" ||
    (["delivered", "read", "undelivered"].includes(eventType) &&
      (string(message.to) !== undefined ||
        string(message.recipient) !== undefined ||
        string(message.message_id) !== undefined ||
        string(message.client_reference) !== undefined))
  );
}

function first(value: unknown): JSONObject | null {
  return object(Array.isArray(value) ? value[0] : value);
}

// Epoch numbers below 1e12 are seconds: read as milliseconds they would predate September 2001.
const ZONED_ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
const SECONDS_EPOCH_LIMIT = 1e12;

function epochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return value < SECONDS_EPOCH_LIMIT ? value * 1000 : value;
  if (typeof value !== "string" || !ZONED_ISO_TIME.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function occurredAt(message: JSONObject): number | undefined {
  const detail = first(first(message.event_data)?.details);
  return epochMs(detail?.time) ?? epochMs(object(message.email_info)?.processed_time);
}

/** A parsed provider event whose `occurredAt` is absent when the body names no documented event time. */
export type ParsedWebhookEvent = Omit<NormalizedWebhookEvent, "occurredAt"> & {
  occurredAt: number | undefined;
};

export function parseWebhookBody(
  signedBody: string,
): { zohoEventId: string; events: ParsedWebhookEvent[] } | null {
  let value: unknown;
  try {
    value = JSON.parse((decodedBody(signedBody) ?? "").replace(/^\uFEFF/, "").trim());
  } catch {
    return null;
  }
  const payload = object(value);
  const zohoEventId = string(payload?.webhook_request_id);
  if (!payload || !zohoEventId || zohoEventId.length > 256) return null;
  const names = Array.isArray(payload.event_name) ? payload.event_name : [payload.event_name];
  const messages = Array.isArray(payload.event_message)
    ? payload.event_message
    : [payload.event_message];
  const events: ParsedWebhookEvent[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = object(messages[index]);
    if (!message) continue;
    const name = firstString(names[index] ?? names[0])
      ?.toLowerCase()
      .replace(/[\s-]+/g, "_");
    const type = name ? (eventTypes[name] ?? "unknown") : "unknown";
    const emailInfo = object(message.email_info);
    const channel: Channel | "unknown" = emailInfo
      ? "email"
      : hasWhatsappMarker(message, type)
        ? "whatsapp"
        : "unknown";
    let recipient =
      channel === "email"
        ? (emailRecipient(message) ?? string(message.recipient) ?? string(message.to))
        : (string(message.to) ?? string(message.recipient));
    if (channel === "whatsapp" && recipient) {
      try {
        recipient = `+${normalizePhone(recipient)}`;
      } catch {
        recipient = undefined;
      }
    }
    const zohoRequestId = string(message.request_id) ?? string(payload.request_id);
    const zohoMessageId = string(emailInfo?.email_reference) ?? string(message.message_id);
    const clientReference = string(emailInfo?.client_reference) ?? string(message.client_reference);
    events.push({
      zohoEventId,
      type,
      channel,
      ...(recipient ? { recipient } : {}),
      ...(zohoRequestId ? { zohoRequestId } : {}),
      ...(zohoMessageId ? { zohoMessageId } : {}),
      ...(clientReference ? { clientReference } : {}),
      occurredAt: occurredAt(message),
      raw: { event_name: names[index] ?? names[0], event_message: message },
    });
  }
  return { zohoEventId, events };
}
