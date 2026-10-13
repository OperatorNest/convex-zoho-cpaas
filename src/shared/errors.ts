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
  "ZOHO_CPAAS_PROVIDER_REJECTED",
  "ZOHO_CPAAS_NETWORK_ERROR",
  "ZOHO_CPAAS_WORKPOOL_ACTION_FAILED",
  "ZOHO_CPAAS_RETRY_AFTER_TOO_LONG",
  "ZOHO_CPAAS_STUCK",
  "ZOHO_CPAAS_UNRECOGNIZED_SUCCESS_BODY",
] as const;
export type ZohoCpaasErrorCode = (typeof zohoCpaasErrorCodes)[number];
export type ZohoCpaasMessageErrorCode = ZohoCpaasErrorCode;
export type ZohoCpaasErrorData = {
  code: ZohoCpaasErrorCode;
  message: string;
  providerStatus?: number;
  providerCode?: string;
};
const messages = {
  ZOHO_CPAAS_IDEMPOTENCY_CONFLICT: "The idempotency key identifies different request content.",
  ZOHO_CPAAS_ALL_SUPPRESSED: "All email recipients are suppressed.",
  ZOHO_CPAAS_VALIDATION_FAILED: "An argument is invalid, missing or out of bounds.",
  ZOHO_CPAAS_NOT_CONFIGURED: "The channel token is missing and test mode is disabled.",
  ZOHO_CPAAS_INVALID_CONFIG: "A component setting is invalid.",
  ZOHO_CPAAS_UNSUPPORTED_REGION: "The channel is unavailable at the configured endpoint.",
  ZOHO_CPAAS_UPLOAD_FAILED: "The provider did not return a usable file cache key.",
  ZOHO_CPAAS_PROVIDER_REJECTED: "The provider rejected the request.",
  ZOHO_CPAAS_NETWORK_ERROR: "The send request outcome is unknown.",
  ZOHO_CPAAS_WORKPOOL_ACTION_FAILED: "The send action ended without reporting an outcome.",
  ZOHO_CPAAS_RETRY_AFTER_TOO_LONG: "The provider requested a retry delay longer than 24 hours.",
  ZOHO_CPAAS_STUCK: "The send remained in progress for more than 24 hours.",
  ZOHO_CPAAS_UNRECOGNIZED_SUCCESS_BODY:
    "The provider accepted the request without usable identifiers.",
} as const satisfies Record<ZohoCpaasErrorCode, string>;

export function errorData(
  code: ZohoCpaasErrorCode,
  provider: { providerStatus?: number; providerCode?: string } = {},
): ZohoCpaasErrorData {
  return {
    code,
    message: messages[code],
    ...(provider.providerStatus === undefined ? {} : { providerStatus: provider.providerStatus }),
    ...(provider.providerCode === undefined ? {} : { providerCode: provider.providerCode }),
  };
}
export function zohoError(
  code: ZohoCpaasErrorCode,
  provider?: { providerStatus?: number; providerCode?: string },
): ConvexError<ZohoCpaasErrorData> {
  return new ConvexError(errorData(code, provider));
}
export function isZohoCpaasError(error: unknown): error is ConvexError<ZohoCpaasErrorData> {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return (
    isRecord(data) &&
    zohoCpaasErrorCodes.some((code) => code === data.code) &&
    typeof data.message === "string" &&
    (data.providerStatus === undefined ||
      (typeof data.providerStatus === "number" &&
        Number.isInteger(data.providerStatus) &&
        data.providerStatus >= 100 &&
        data.providerStatus <= 599)) &&
    (data.providerCode === undefined ||
      (typeof data.providerCode === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(data.providerCode)))
  );
}

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

export type ClassifiedError = {
  retryable: boolean;
  accountState: boolean;
  explicitZohoCode?: boolean;
  code: ZohoCpaasErrorCode;
  providerCode?: string;
  providerStatus?: number;
  subCode?: string;
  message: string;
  retryAfterMs?: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function parseProviderCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : undefined;
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
    .map((detail) => parseProviderCode(record(detail)?.code))
    .filter((item) => item !== undefined);
  const primaryCode =
    parseProviderCode(error?.code) ??
    parseProviderCode(data?.error_code) ??
    parseProviderCode(data?.code);
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
  const explicitZohoCode = zohoCpaasProviderErrorCodes.some(
    (code) => code === primaryCode || subCodes.includes(code),
  );
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
    explicitZohoCode,
    ...errorData(tooLong ? "ZOHO_CPAAS_RETRY_AFTER_TOO_LONG" : "ZOHO_CPAAS_PROVIDER_REJECTED", {
      providerStatus: httpStatus,
      providerCode: primaryCode ?? subCode,
    }),
    ...(subCode ? { subCode } : {}),
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
    ...errorData("ZOHO_CPAAS_NETWORK_ERROR"),
  };
}

export function retryBackoffMs(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
  return Math.min(1000 * 2 ** Math.min(attempt - 1, 16), 60_000);
}
