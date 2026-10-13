import { boundedPayload, boundedString } from "./bounds.js";
import { zohoError } from "./errors.js";
import { v, type Infer } from "convex/values";
import {
  attachmentValidator,
  emailAddressValidator,
  emailRecipientValidator,
  inlineImageValidator,
} from "./validators.js";
export const regionValidator = v.union(
  v.literal("us"),
  v.literal("eu"),
  v.literal("in"),
  v.literal("au"),
  v.literal("jp"),
  v.literal("cn"),
);
export type Region = Infer<typeof regionValidator>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const hosts: Record<Region, string> = {
  us: "https://cpaas.zoho.com/v1.1",
  eu: "https://cpaas.zoho.eu/v1.1",
  in: "https://cpaas.zoho.in/v1.1",
  au: "https://cpaas.zoho.com.au/v1.1",
  jp: "https://cpaas.zoho.jp/v1.1",
  cn: "https://cpaas.zoho.com.cn/v1.1",
};

export function isRegion(value: string): value is Region {
  return Object.hasOwn(hosts, value);
}

export function regionBaseUrl(region: string | undefined, override?: string): string {
  if (override) {
    const url = new URL(override);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw zohoError("ZOHO_CPAAS_INVALID_CONFIG");
    }
    return url.href.replace(/\/$/, "");
  }
  if (!region) return hosts.us;
  if (isRegion(region)) return hosts[region];
  throw zohoError("ZOHO_CPAAS_UNSUPPORTED_REGION");
}

export function normalizeToken(token: string): string {
  const stripped = token
    .trim()
    .replace(/^Zoho-enczapikey\s+/i, "")
    .trim();
  if (!stripped || /\s/.test(stripped)) throw zohoError("ZOHO_CPAAS_INVALID_CONFIG");
  return `Zoho-enczapikey ${stripped}`;
}

export function normalizeEmail(address: string): string {
  const normalized = address.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  }
  return normalized;
}

export function normalizePhone(number: string): string {
  const digits = number.replace(/[\s()+-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  return digits;
}

export function normalizeRecipient(channel: "email" | "sms" | "whatsapp", address: string): string {
  return channel === "email"
    ? normalizeEmail(address)
    : channel === "whatsapp"
      ? `+${normalizePhone(address)}`
      : normalizePhone(address);
}

export type EmailAddress = Infer<typeof emailAddressValidator>;
export type EmailRecipient = Infer<typeof emailRecipientValidator>;
export type EmailAttachment = Infer<typeof attachmentValidator>;
export type InlineImage = Infer<typeof inlineImageValidator>;
export type EmailInput = {
  from: EmailAddress;
  subject?: string;
  html?: string;
  text?: string;
  templateKey?: string;
  templateAlias?: string;
  mergeInfo?: Record<string, string>;
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress[];
  trackOpens?: boolean;
  trackClicks?: boolean;
  clientReference?: string;
  mimeHeaders?: Record<string, string>;
  attachments?: EmailAttachment[];
  inlineImages?: InlineImage[];
};

const MAX_RECIPIENTS = 500;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function validateUploadFile(name: string, mimeType: string, byteLength: number): void {
  if (!name || name.length > 150 || !mimeType || byteLength > MAX_UPLOAD_BYTES)
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
}

function providerAddress(input: EmailAddress): EmailAddress {
  if (input.name && input.name.length > 250) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  const address = input.address.trim();
  normalizeEmail(address);
  return { address, ...(input.name ? { name: input.name } : {}) };
}

function recipients(input: EmailAddress[]) {
  if (input.length > MAX_RECIPIENTS) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  const unique = new Set(input.map((item) => normalizeEmail(item.address)));
  if (unique.size !== input.length) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  return input.map((item) => ({ email_address: providerAddress(item) }));
}

function isBatchRecipient(item: EmailAddress | EmailRecipient): item is EmailRecipient {
  return "emailAddress" in item;
}

function media(input: EmailAttachment[] | InlineImage[] | undefined) {
  if (!input) return undefined;
  return input.map((item) => {
    if (("name" in item && item.name.length > 150) || ("cid" in item && !item.cid))
      throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
    const content = item.content?.replace(/\s+/g, "");
    if (Boolean(content) === Boolean(item.fileCacheKey)) {
      throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
    }
    if (
      content &&
      (!item.mimeType ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content))
    ) {
      throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
    }
    const key = "name" in item ? { name: item.name } : { cid: item.cid };
    return {
      ...key,
      ...(item.mimeType ? { mime_type: item.mimeType } : {}),
      ...(content ? { content } : {}),
      ...(item.fileCacheKey ? { file_cache_key: item.fileCacheKey } : {}),
    };
  });
}

export function buildEmailPayload(
  input: EmailInput,
  to: EmailAddress[] | EmailRecipient[],
  clientReference: string,
): Record<string, unknown> {
  boundedString(input.templateKey, 200);
  boundedString(input.templateAlias, 100);
  const first = to[0];
  const batch = first !== undefined && isBatchRecipient(first);
  if (to.some((item) => isBatchRecipient(item) !== batch))
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  const normalizedTo = to.map((item) =>
    isBatchRecipient(item)
      ? {
          email_address: providerAddress(item.emailAddress),
          ...(input.mergeInfo || item.mergeInfo
            ? { merge_info: { ...input.mergeInfo, ...item.mergeInfo } }
            : {}),
        }
      : { email_address: providerAddress(item) },
  );
  if (
    new Set(normalizedTo.map((item) => normalizeEmail(item.email_address.address))).size !==
    normalizedTo.length
  )
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  if (normalizedTo.length > MAX_RECIPIENTS) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  if (normalizedTo.length === 0 && !input.cc?.length && !input.bcc?.length) {
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  }
  if (input.subject && input.subject.length > 500) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  if ((input.attachments?.length ?? 0) + (input.inlineImages?.length ?? 0) > 60)
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  if (input.templateKey && input.templateAlias) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  if ((input.templateKey || input.templateAlias) && (input.subject || input.html || input.text)) {
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  }
  if (
    !input.templateKey &&
    !input.templateAlias &&
    (!input.subject || (!input.html && !input.text))
  ) {
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  }
  const ref = input.clientReference ?? clientReference;
  if (!ref || ref.length > 100) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  const payload: Record<string, unknown> = {
    from: providerAddress(input.from),
    to: normalizedTo,
    client_reference: ref,
  };
  if (input.cc) payload.cc = recipients(input.cc);
  if (input.bcc) payload.bcc = recipients(input.bcc);
  if (input.replyTo) {
    recipients(input.replyTo);
    payload.reply_to = input.replyTo.map(providerAddress);
  }
  if (input.subject) payload.subject = input.subject;
  if (input.html) payload.htmlbody = input.html;
  if (input.text) payload.textbody = input.text;
  if (input.templateKey) payload.template_key = input.templateKey;
  if (input.templateAlias) payload.template_alias = input.templateAlias;
  if (input.mergeInfo) payload.merge_info = input.mergeInfo;
  if (input.trackOpens !== undefined) payload.track_opens = input.trackOpens;
  if (input.trackClicks !== undefined) payload.track_clicks = input.trackClicks;
  if (input.mimeHeaders) payload.mime_headers = input.mimeHeaders;
  if (input.attachments) payload.attachments = media(input.attachments);
  if (input.inlineImages) payload.inline_images = media(input.inlineImages);
  boundedPayload(payload);
  return payload;
}

export function isIndiaBaseUrl(override: string | undefined): boolean {
  if (!override) return false;
  try {
    return new URL(override).hostname.toLowerCase().endsWith(".in");
  } catch {
    return false;
  }
}

export type TemplateInput = {
  to: string;
  templateKey?: string;
  templateAlias?: string;
  mergeInfo?: Record<string, JsonValue>;
  clientReference?: string;
};

function assertJsonDepth(value: JsonValue, remaining: number): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value))
      throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
    return;
  }
  if (remaining === 0) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  if (Array.isArray(value)) {
    for (const item of value) assertJsonDepth(item, remaining - 1);
  } else {
    for (const item of Object.values(value)) assertJsonDepth(item, remaining - 1);
  }
}

function template(input: TemplateInput, clientReference: string) {
  boundedString(input.templateKey, 200);
  if (Boolean(input.templateKey) === Boolean(input.templateAlias)) {
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  }
  if (input.templateAlias && input.templateAlias.length > 100)
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  if (input.mergeInfo) {
    for (const value of Object.values(input.mergeInfo)) assertJsonDepth(value, 3);
  }
  const ref = input.clientReference ?? clientReference;
  if (!ref || ref.length > 100) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  return {
    ...(input.templateKey
      ? { template_key: input.templateKey }
      : { template_alias: input.templateAlias }),
    ...(input.mergeInfo ? { merge_info: input.mergeInfo } : {}),
    client_reference: ref,
  };
}

export function buildSmsPayload(
  input: TemplateInput & { senderKey: string },
  clientReference: string,
) {
  if (!input.senderKey || input.senderKey.length > 200)
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  const to = normalizePhone(input.to);
  if (!/^91\d{10}$/.test(to)) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  const payload = {
    sender_key: input.senderKey,
    to: [{ mobile_no: to }],
    ...template(input, clientReference),
  };
  boundedPayload(payload);
  return payload;
}

export function buildWhatsappPayload(
  input: TemplateInput & { from: string; agentId?: string },
  clientReference: string,
) {
  boundedString(input.agentId, 200);
  const from = `+${normalizePhone(input.from)}`;
  const to = `+${normalizePhone(input.to)}`;
  if (from.length > 20 || to.length > 20) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  const payload = {
    from,
    to,
    ...template(input, clientReference),
    ...(input.agentId ? { agent_id: input.agentId } : {}),
  };
  boundedPayload(payload);
  return payload;
}
