import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDirectory = new URL("../tests/fixtures/e2e/", import.meta.url);
const allowedKeys = new Set([
  "webhook_request_id",
  "request_id",
  "event_name",
  "event_message",
  "email_info",
  "email_reference",
  "client_reference",
  "email_address",
  "address",
  "name",
  "to",
  "cc",
  "bcc",
  "from",
  "recipient",
  "message_id",
  "whatsapp_info",
  "channel",
  "occurred_at",
  "timestamp",
  "processed_time",
  "event_data",
  "details",
  "time",
  "modified_time",
  "object",
  "subject",
  "bounce_address",
  "is_smtp_trigger",
  "reason",
  "diagnostic_message",
  "email_client",
  "version",
  "mailagent_key",
]);
// Only literal names understood by src/shared/webhook.ts may survive a fixture.
const eventNames = new Set([
  "hardbounce",
  "hard_bounce",
  "softbounce",
  "soft_bounce",
  "fbl",
  "fbl_complaint",
  "complaint",
  "feedback_loop",
  "open",
  "email_open",
  "click",
  "email_link_click",
  "delivered",
  "read",
  "undelivered",
  "failed",
]);
const safeReasons = new Set([
  "accepted",
  "rejected",
  "invalid_signature",
  "malformed_payload",
  "unsupported_event",
  "timeout",
  "callback_failure",
  "delivery_failure",
  "duplicate",
  "invalid_payload",
  "missing_secret",
  "oversized_body",
  "undecodable_body",
  "processing_failed",
]);
const timeKeys = new Set(["occurred_at", "timestamp", "processed_time", "time", "modified_time"]);
const formFields = new Set(["data", "payload", "json", "body"]);
const maxDepth = 40;

function decodeBody(rawBody) {
  const trimmed = rawBody.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { encoding: "json", text: rawBody };
  }
  try {
    const decoded = decodeURIComponent(rawBody.replace(/\+/g, " "));
    const separator = decoded.indexOf("=");
    if (separator <= 0) return null;
    const originalField = decoded.slice(0, separator);
    const formField = formFields.has(originalField) ? originalField : "redacted_field";
    return { encoding: "form", text: decoded.slice(separator + 1), formField };
  } catch {
    return null;
  }
}

function normalizedContentType(value) {
  const type = typeof value === "string" ? value.split(";", 1)[0]?.trim().toLowerCase() : "";
  return type === "application/json" || type === "application/x-www-form-urlencoded"
    ? type
    : "unknown";
}

function expectedFromParsed(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.events)) return null;
  return {
    eventCount: parsed.events.length,
    events: parsed.events.map((event) => ({
      type: eventNames.has(event.type) || event.type === "unknown" ? event.type : "unknown",
      channel: ["email", "whatsapp", "unknown"].includes(event.channel) ? event.channel : "unknown",
      hasRecipient: typeof event.recipient === "string",
      hasProviderRequestId: typeof event.providerRequestId === "string",
      hasProviderMessageId: typeof event.providerMessageId === "string",
      hasClientReference: typeof event.clientReference === "string",
    })),
  };
}

function redactTree(value, state, key = "", ancestors = [], depth = 0) {
  if (depth > maxDepth) {
    state.truncated = true;
    return null;
  }
  if (Array.isArray(value))
    return value.map((item) => redactTree(item, state, key, ancestors, depth + 1));
  if (value && typeof value === "object") {
    const result = {};
    for (const [originalKey, originalValue] of Object.entries(value)) {
      const safeKey = allowedKeys.has(originalKey)
        ? originalKey
        : `redacted_key_${++state.unknownKeys}`;
      result[safeKey] = redactTree(
        originalValue,
        state,
        originalKey,
        [...ancestors, originalKey],
        depth + 1,
      );
    }
    return result;
  }
  if (typeof value === "string") {
    if (key === "event_name") {
      const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
      return eventNames.has(normalized) ? value : "redacted";
    }
    if (key === "channel" && value === "whatsapp") return value;
    if (timeKeys.has(key)) return "2024-01-01T00:00:00.000Z";
    const emailField =
      (key === "address" &&
        (ancestors.includes("email_address") || ancestors.includes("email_info"))) ||
      key === "bounce_address" ||
      (["to", "recipient"].includes(key) && value.includes("@"));
    const normalizedEmail = value.trim().toLowerCase();
    const validEmail =
      emailField &&
      normalizedEmail.length <= 320 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    const tokenKey = validEmail ? `email:${normalizedEmail}` : `literal:${value}`;
    let index = state.tokens.get(tokenKey);
    if (index === undefined) {
      index = state.tokens.size + 1;
      state.tokens.set(tokenKey, index);
    }
    if (validEmail) return `redacted${index}@example.invalid`;
    if (["to", "recipient"].includes(key) && /^\+?[\d\s().-]{7,}$/.test(value))
      return `+1555${String(index).padStart(7, "0")}`;
    if (
      [
        "webhook_request_id",
        "request_id",
        "email_reference",
        "client_reference",
        "message_id",
        "mailagent_key",
      ].includes(key)
    )
      return `id-${index}`;
    return `redacted-${index}`;
  }
  if (typeof value === "number") return timeKeys.has(key) ? 1704067200000 : 0;
  return value === null || typeof value === "boolean" ? value : null;
}

/** In-memory redaction; no raw body, headers, or parsed identifiers are returned. */
export function sanitizeE2eFixture({
  rawBody,
  contentType,
  signature,
  reason,
  receivedAt,
  parserResult,
}) {
  const decoded = typeof rawBody === "string" ? decodeBody(rawBody) : null;
  let original;
  try {
    original = decoded ? JSON.parse(decoded.text.replace(/^\uFEFF/, "").trim()) : undefined;
  } catch {
    original = undefined;
  }
  const validStructure =
    original !== undefined &&
    original !== null &&
    typeof original === "object" &&
    !Array.isArray(original);
  const state = { tokens: new Map(), unknownKeys: 0, truncated: false };
  const redacted = validStructure ? redactTree(original, state) : { redacted_malformed_body: true };
  const safeBody = state.truncated ? { redacted_malformed_body: true } : redacted;
  const encoding = decoded?.encoding ?? "unrecognized";
  const formField = decoded?.formField ?? null;
  const body =
    encoding === "form" && validStructure && !state.truncated
      ? `${formField}=${encodeURIComponent(JSON.stringify(safeBody))}`
      : JSON.stringify(safeBody);
  const signatureValue =
    typeof signature === "string"
      ? signature
          .split(";")
          .find((part) => part.trimStart().toLowerCase().startsWith("s="))
          ?.split("=")
          .slice(1)
          .join("=")
      : undefined;
  const safeDate =
    typeof receivedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(receivedAt) &&
    !Number.isNaN(Date.parse(receivedAt))
      ? receivedAt
      : new Date().toISOString();
  return {
    schemaVersion: 1,
    receivedAt: safeDate,
    reason: safeReasons.has(reason) ? reason : "redacted",
    contentType: normalizedContentType(contentType),
    bodyEncoding: encoding,
    formField,
    signature: signature ? "[redacted-signature]" : null,
    signatureUrlEncoded: typeof signatureValue === "string" && /%[\da-f]{2}/i.test(signatureValue),
    body,
    expected: state.truncated ? null : expectedFromParsed(parserResult),
  };
}

/** Persist a redacted provider observation under tests/fixtures/e2e/. */
export async function saveE2eFixture(input) {
  let parserResult = input.parserResult;
  if (parserResult === undefined) {
    // The e2e runner builds the package first. Parse before redaction so expected
    // mapping describes what the real payload exercised, without storing its IDs.
    const { parseWebhookBody } = await import("../dist/shared/webhook.js");
    parserResult = parseWebhookBody(input.rawBody);
  }
  const fixture = sanitizeE2eFixture({ ...input, parserResult });
  const ordinal =
    Number.isSafeInteger(input.eventOrdinal) && input.eventOrdinal > 0 ? input.eventOrdinal : 1;
  const filename = `${fixture.receivedAt.slice(0, 10)}-event-${String(ordinal).padStart(3, "0")}-${randomBytes(4).toString("hex")}.json`;
  await mkdir(fixtureDirectory, { recursive: true });
  const path = join(fileURLToPath(fixtureDirectory), filename);
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return {
    filename,
    path,
    expected: fixture.expected,
    observations: {
      contentType: fixture.contentType,
      bodyEncoding: fixture.bodyEncoding,
      formField: fixture.formField,
      signatureUrlEncoded: fixture.signatureUrlEncoded,
    },
  };
}
