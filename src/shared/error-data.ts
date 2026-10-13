import { zohoCpaasError, type ZohoCpaasErrorCode, type ZohoCpaasErrorData } from "./errors.js";

export function createErrorData(
  code: ZohoCpaasErrorCode,
  details?: { retryable?: boolean; providerStatus?: number; providerCode?: string },
): ZohoCpaasErrorData {
  return zohoCpaasError(code, details).data;
}
