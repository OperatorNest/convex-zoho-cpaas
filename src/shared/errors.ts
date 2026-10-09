import { isRecord } from "./record.js";
import { ConvexError } from "convex/values";
import type { Channel } from "./status.js";

export const zohoCpaasErrorCodes = [
  "ZOHO_CPAAS_IDEMPOTENCY_CONFLICT",
  "ZOHO_CPAAS_ALL_SUPPRESSED",
  "ZOHO_CPAAS_VALIDATION_FAILED",
  "ZOHO_CPAAS_NOT_CONFIGURED",
  "ZOHO_CPAAS_INVALID_CONFIG",
  "ZOHO_CPAAS_UNSUPPORTED_REGION",
  "ZOHO_CPAAS_UPLOAD_FAILED",
] as const;
export type ZohoCpaasErrorCode = (typeof zohoCpaasErrorCodes)[number];

export function zohoError(errorCode: ZohoCpaasErrorCode, message: string, retryable?: boolean) {
  return new ConvexError({
    code: errorCode,
    message,
    ...(retryable === undefined ? {} : { retryable }),
  });
}

export function isZohoCpaasError(
  error: unknown,
): error is { data: { code: ZohoCpaasErrorCode; message: string; retryable?: boolean } } {
  if (error === null || typeof error !== "object" || !("data" in error)) return false;
  const data = error.data;
  return (
    data !== null &&
    typeof data === "object" &&
    "code" in data &&
    typeof data.code === "string" &&
    zohoCpaasErrorCodes.some((candidate) => candidate === data.code) &&
    "message" in data &&
    typeof data.message === "string" &&
    (!("retryable" in data) || typeof data.retryable === "boolean")
  );
}

/**
 * Codes the component itself stores in `message.error.code`. `UNRECOGNIZED_SUCCESS_BODY`
 * is recorded in `message.warning` on an accepted row; the others live on failed rows.
 */
export const zohoCpaasLocalMessageErrorCodes = [
  "ZOHO_CPAAS_STUCK",
  "ZOHO_CPAAS_WORKPOOL_ACTION_FAILED",
  "ZOHO_CPAAS_NETWORK_ERROR",
  "ZOHO_CPAAS_RETRY_AFTER_TOO_LONG",
  "ZOHO_CPAAS_UNRECOGNIZED_SUCCESS_BODY",
  "ZOHO_CPAAS_NOT_CONFIGURED",
  "ZOHO_CPAAS_INVALID_CONFIG",
  "ZOHO_CPAAS_UNSUPPORTED_REGION",
] as const;

/** Zoho error codes the classifier recognizes; other well-formed Zoho codes are stored verbatim. */
export const zohoCpaasProviderErrorCodes = [
  "SM_128",
  "SM_133",
  "LE_101",
  "LE_102",
  "SMI_115",
  "TM_3201",
  "TM_3301",
  "TM_3501",
  "TM_4001",
  "TM_3601",
  "TM_5001",
  "TM_8001",
  "SM_111",
  "SM_113",
  "SERR_157",
  "SMS_107",
  "SMS_108",
  "WA_103",
  "SERR_156",
  "AE_101",
  "WSE_107",
] as const;

/**
 * Stored per-message error and warning codes, separate from the codes thrown to callers
 * (`ZohoCpaasErrorCode`). Zoho may return codes beyond the listed provider ones, so
 * `message.error.code` is typed `string`; use this type to narrow known values.
 */
export type ZohoCpaasMessageErrorCode =
  | (typeof zohoCpaasLocalMessageErrorCodes)[number]
  | (typeof zohoCpaasProviderErrorCodes)[number];

export type ClassifiedError = {
  retryable: boolean;
  accountState: boolean;
  code?: string;
  subCode?: string;
  message: string;
  retryAfterMs?: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function code(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,30}$/.test(value) ? value : undefined;
}

export function parseRetryAfter(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const delay = Number(trimmed) * 1000;
    return Number.isSafeInteger(delay) ? delay : undefined;
  }
  const time = Date.parse(trimmed);
  if (!Number.isFinite(time)) return undefined;
  const delay = Math.max(0, time - nowMs);
  return Number.isSafeInteger(delay) ? delay : undefined;
}

const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const accountStateCodes = new Set(["SM_128", "SM_133", "LE_101", "LE_102"]);
const permanentClasses = new Set([
  "TM_3201",
  "TM_3301",
  "TM_3501",
  "TM_4001",
  "TM_3601",
  "TM_5001",
  "TM_8001",
]);
const permanentSubCodes = new Set([
  "SM_111",
  "SM_113",
  "SERR_157",
  "SMS_107",
  "SMS_108",
  "WA_103",
  "SERR_156",
  "AE_101",
  "WSE_107",
]);

export function classifyProviderError(
  httpStatus: number,
  body: unknown,
  retryAfter: string | null | undefined = null,
  nowMs = Date.now(),
  channel: Channel = "email",
): ClassifiedError {
  const payload = record(body);
  const error = record(payload?.error);
  const data = record(payload?.data);
  const details = Array.isArray(error?.details) ? error.details : [];
  const subCodes = details
    .map((detail) => code(record(detail)?.code))
    .filter((item) => item !== undefined);
  const primaryCode = code(error?.code) ?? code(data?.error_code) ?? code(data?.code);
  const subCode = subCodes[0];
  const accountState = Boolean(
    subCodes.some((item) => accountStateCodes.has(item)) ||
    (primaryCode && accountStateCodes.has(primaryCode)),
  );
  const permanentDetail = subCodes.some((item) => permanentSubCodes.has(item));
  const permanentClass = Boolean(primaryCode && permanentClasses.has(primaryCode));
  const retryAfterMs = parseRetryAfter(retryAfter, nowMs);
  const numericRetryAfter =
    retryAfter?.trim() && /^\d+$/.test(retryAfter.trim())
      ? Number(retryAfter.trim()) * 1000
      : undefined;
  const tooLong =
    (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) ||
    (numericRetryAfter !== undefined && numericRetryAfter > MAX_RETRY_AFTER_MS);
  const explicitZohoCode = primaryCode !== undefined || subCode !== undefined;
  const dailyLimit = subCodes.includes("SMI_115") || primaryCode === "SMI_115";
  const dailyOverride =
    channel === "email" &&
    dailyLimit &&
    (primaryCode === undefined || primaryCode === "TM_3601" || primaryCode === "SMI_115");
  const retryStatus =
    channel === "email"
      ? httpStatus === 429 || httpStatus >= 500
      : httpStatus === 429 || (httpStatus === 503 && explicitZohoCode);
  const retryable =
    !tooLong &&
    !accountState &&
    !permanentDetail &&
    (!permanentClass || dailyOverride) &&
    (retryStatus || dailyOverride);
  return {
    retryable,
    accountState,
    ...(tooLong
      ? { code: "ZOHO_CPAAS_RETRY_AFTER_TOO_LONG" satisfies ZohoCpaasMessageErrorCode }
      : primaryCode
        ? { code: primaryCode }
        : {}),
    ...(subCode ? { subCode } : {}),
    message: tooLong
      ? "Zoho CPaaS requested a retry delay longer than 24 hours"
      : accountState
        ? "Zoho CPaaS account requires operator action"
        : retryable
          ? "Zoho CPaaS is temporarily unavailable"
          : "Zoho CPaaS rejected the request",
    ...(retryable && dailyOverride
      ? { retryAfterMs: Math.max(retryAfterMs ?? 0, MAX_RETRY_AFTER_MS) }
      : retryable && retryAfterMs !== undefined
        ? { retryAfterMs }
        : {}),
  };
}

export function classifyNetworkError(channel: Channel): ClassifiedError {
  return {
    retryable: channel === "email",
    accountState: false,
    code: "ZOHO_CPAAS_NETWORK_ERROR" satisfies ZohoCpaasMessageErrorCode,
    message: "Zoho CPaaS request outcome is unknown",
  };
}

/** Deterministic exponential backoff; attempt one is the first retry. */
export function retryBackoffMs(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Invalid retry attempt");
  return Math.min(1000 * 2 ** Math.min(attempt - 1, 16), 60_000);
}
