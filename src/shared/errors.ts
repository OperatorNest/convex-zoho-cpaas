import { ConvexError } from "convex/values";
import { truncateText } from "./bounds.js";

// repository-codes:begin
/** Every error code the component raises or stores, each with one fixed message. */
export const ZOHO_CPAAS_ERROR_CODES = [
  "ZOHO_CPAAS_IDEMPOTENCY_CONFLICT",
  "ZOHO_CPAAS_ALL_SUPPRESSED",
  "ZOHO_CPAAS_INVALID_ARGUMENT",
  "ZOHO_CPAAS_NOT_FOUND",
  "ZOHO_CPAAS_INVALID_WEBHOOK_SIGNATURE",
  "ZOHO_CPAAS_NOT_CONFIGURED",
  "ZOHO_CPAAS_UNSUPPORTED_REGION",
  "ZOHO_CPAAS_PROVIDER_ERROR",
  "ZOHO_CPAAS_NETWORK_ERROR",
  "ZOHO_CPAAS_INVALID_RESPONSE",
] as const;

const ZOHO_CPAAS_PROVIDER_ERROR_CODES = [
  "ZOHO_CPAAS_PROVIDER_ERROR",
  "ZOHO_CPAAS_NETWORK_ERROR",
] as const satisfies readonly ZohoCpaasErrorCode[];

const ZOHO_CPAAS_ERROR_MESSAGES = {
  ZOHO_CPAAS_IDEMPOTENCY_CONFLICT: "The idempotency key identifies different request content.",
  ZOHO_CPAAS_ALL_SUPPRESSED: "All email recipients are suppressed.",
  ZOHO_CPAAS_NOT_FOUND: "The referenced row does not exist.",
  ZOHO_CPAAS_INVALID_WEBHOOK_SIGNATURE: "The webhook signature is missing or invalid.",
  ZOHO_CPAAS_INVALID_ARGUMENT: "An argument is invalid, missing or out of bounds.",
  ZOHO_CPAAS_NOT_CONFIGURED: "A required component setting is missing or malformed.",
  ZOHO_CPAAS_UNSUPPORTED_REGION: "The channel is unavailable at the configured endpoint.",
  ZOHO_CPAAS_PROVIDER_ERROR: "The provider rejected the request.",
  ZOHO_CPAAS_NETWORK_ERROR: "The provider request outcome is unknown.",
  ZOHO_CPAAS_INVALID_RESPONSE: "The provider returned an unusable success response.",
} as const satisfies Record<ZohoCpaasErrorCode, string>;
// repository-codes:end

const ERROR_DATA_KEYS: ReadonlySet<string> = new Set([
  "code",
  "message",
  "retryable",
  "providerStatus",
  "providerCode",
]);

/** One fixed caller-visible failure; `ZOHO_CPAAS_ERROR_CODES` lists every code. */
export type ZohoCpaasErrorCode = (typeof ZOHO_CPAAS_ERROR_CODES)[number];

/** Error data: the code, its fixed message and bounded provider failure details. `retryable` is present exactly on provider-originated codes. */
export type ZohoCpaasErrorData = {
  code: ZohoCpaasErrorCode;
  message: string;
  retryable?: boolean;
  providerStatus?: number;
  providerCode?: string;
};

type ProviderErrorCode = (typeof ZOHO_CPAAS_PROVIDER_ERROR_CODES)[number];

type ErrorDetails<Code extends ZohoCpaasErrorCode> = [Code] extends [
  Exclude<ZohoCpaasErrorCode, ProviderErrorCode>,
]
  ? [details?: { retryable?: never; providerStatus?: number; providerCode?: string }]
  : [details: { retryable: boolean; providerStatus?: number; providerCode?: string }];

function isProviderErrorCode(code: unknown): code is ProviderErrorCode {
  return ZOHO_CPAAS_PROVIDER_ERROR_CODES.some((candidate) => candidate === code);
}

/** Creates the error for `code` with its fixed message. Provider-originated codes require `details.retryable`; other codes forbid it. `providerCode` is truncated to 64 characters. */
export function zohoCpaasError<Code extends ZohoCpaasErrorCode>(
  code: Code,
  ...[details]: ErrorDetails<Code>
): ConvexError<ZohoCpaasErrorData> {
  return new ConvexError({
    code,
    message: ZOHO_CPAAS_ERROR_MESSAGES[code],
    ...(isProviderErrorCode(code) &&
      details?.retryable !== undefined && { retryable: details.retryable }),
    ...(details?.providerStatus !== undefined && { providerStatus: details.providerStatus }),
    ...(details?.providerCode !== undefined && {
      providerCode: truncateText(details.providerCode, 64),
    }),
  });
}

/** Returns true when `error` carries exactly a known code, its fixed message, `retryable` on provider-originated codes only, and well-formed provider details. */
export function isZohoCpaasError(error: unknown): error is ConvexError<ZohoCpaasErrorData> {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null || !("code" in data) || !("message" in data))
    return false;
  const { code, message } = data;
  return (
    Object.keys(data).every((key) => ERROR_DATA_KEYS.has(key)) &&
    ZOHO_CPAAS_ERROR_CODES.some(
      (candidate) => candidate === code && message === ZOHO_CPAAS_ERROR_MESSAGES[candidate],
    ) &&
    ("retryable" in data
      ? isProviderErrorCode(code) && typeof data.retryable === "boolean"
      : !isProviderErrorCode(code)) &&
    (!("providerStatus" in data) ||
      (typeof data.providerStatus === "number" &&
        Number.isInteger(data.providerStatus) &&
        data.providerStatus >= 100 &&
        data.providerStatus <= 599)) &&
    (!("providerCode" in data) ||
      (typeof data.providerCode === "string" &&
        data.providerCode.isWellFormed() &&
        data.providerCode.length <= 64))
  );
}
