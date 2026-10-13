import { isRecord } from "./record.js";
import { ConvexError } from "convex/values";

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
  "ZOHO_CPAAS_WORKPOOL_ACTION_FAILED",
  "ZOHO_CPAAS_RETRY_AFTER_TOO_LONG",
  "ZOHO_CPAAS_STUCK",
  "ZOHO_CPAAS_INVALID_RESPONSE",
] as const;
/** A fixed error code identifying the action a Zoho CPaaS caller must take. */
export type ZohoCpaasErrorCode = (typeof ZOHO_CPAAS_ERROR_CODES)[number];
/** The fixed error payload returned by Zoho CPaaS operations. */
export type ZohoCpaasErrorData = {
  code: ZohoCpaasErrorCode;
  message: string;
  retryable?: boolean;
  providerStatus?: number;
  providerCode?: string;
};
const messages = {
  ZOHO_CPAAS_IDEMPOTENCY_CONFLICT: "The idempotency key identifies different request content.",
  ZOHO_CPAAS_ALL_SUPPRESSED: "All email recipients are suppressed.",
  ZOHO_CPAAS_NOT_FOUND: "The referenced row does not exist.",
  ZOHO_CPAAS_INVALID_WEBHOOK_SIGNATURE: "The webhook signature is missing or invalid.",
  ZOHO_CPAAS_INVALID_ARGUMENT: "An argument is invalid, missing or out of bounds.",
  ZOHO_CPAAS_NOT_CONFIGURED: "A required component setting is missing or malformed.",
  ZOHO_CPAAS_UNSUPPORTED_REGION: "The channel is unavailable at the configured endpoint.",
  ZOHO_CPAAS_PROVIDER_ERROR: "The provider rejected the request.",
  ZOHO_CPAAS_NETWORK_ERROR: "The provider request outcome is unknown.",
  ZOHO_CPAAS_WORKPOOL_ACTION_FAILED: "The send action ended without reporting an outcome.",
  ZOHO_CPAAS_RETRY_AFTER_TOO_LONG: "The provider requested a retry delay longer than 24 hours.",
  ZOHO_CPAAS_STUCK: "The send remained in progress for more than 24 hours.",
  ZOHO_CPAAS_INVALID_RESPONSE: "The provider returned an unusable success response.",
} as const satisfies Record<ZohoCpaasErrorCode, string>;

function errorData(
  code: ZohoCpaasErrorCode,
  provider: { retryable?: boolean; providerStatus?: number; providerCode?: string } = {},
): ZohoCpaasErrorData {
  return {
    code,
    message: messages[code],
    ...((code === "ZOHO_CPAAS_PROVIDER_ERROR" || code === "ZOHO_CPAAS_NETWORK_ERROR") &&
    provider.retryable !== undefined
      ? { retryable: provider.retryable }
      : {}),
    ...(provider.providerStatus === undefined ? {} : { providerStatus: provider.providerStatus }),
    ...(provider.providerCode === undefined ? {} : { providerCode: provider.providerCode }),
  };
}
export function zohoCpaasError(
  code: ZohoCpaasErrorCode,
  provider?: { retryable?: boolean; providerStatus?: number; providerCode?: string },
): ConvexError<ZohoCpaasErrorData> {
  return new ConvexError(errorData(code, provider));
}
/** Identify a Zoho CPaaS error with a catalog code, its exact message and valid optional metadata. */
export function isZohoCpaasError(error: unknown): error is ConvexError<ZohoCpaasErrorData> {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return (
    isRecord(data) &&
    ZOHO_CPAAS_ERROR_CODES.some((code) => code === data.code && data.message === messages[code]) &&
    (data.retryable === undefined ||
      ((data.code === "ZOHO_CPAAS_PROVIDER_ERROR" || data.code === "ZOHO_CPAAS_NETWORK_ERROR") &&
        typeof data.retryable === "boolean")) &&
    (data.providerStatus === undefined ||
      (typeof data.providerStatus === "number" &&
        Number.isInteger(data.providerStatus) &&
        data.providerStatus >= 100 &&
        data.providerStatus <= 599)) &&
    (data.providerCode === undefined ||
      (typeof data.providerCode === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(data.providerCode)))
  );
}
