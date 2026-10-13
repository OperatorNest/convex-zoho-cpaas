import { env } from "./_generated/server.js";
import { isZohoCpaasError, zohoError } from "../shared/errors.js";
import { isIndiaBaseUrl, isRegion, normalizeToken, regionBaseUrl } from "../shared/provider.js";
import type { Channel } from "../shared/status.js";

export function resolveTestMode(option: boolean | undefined): boolean {
  return option === true || env.ZOHO_CPAAS_TEST_MODE === "true";
}

export function tokenFor(channel: Channel): string | undefined {
  return (
    (channel === "email"
      ? env.ZOHO_CPAAS_EMAIL_TOKEN
      : channel === "sms"
        ? env.ZOHO_CPAAS_SMS_TOKEN
        : env.ZOHO_CPAAS_WHATSAPP_TOKEN) || env.ZOHO_CPAAS_TOKEN
  );
}

export function providerBaseUrl(channel: Channel): string {
  try {
    const baseUrl = regionBaseUrl(env.ZOHO_CPAAS_REGION, env.ZOHO_CPAAS_BASE_URL);
    if (channel === "sms" && !isIndiaBaseUrl(baseUrl))
      throw zohoError("ZOHO_CPAAS_UNSUPPORTED_REGION");
    return baseUrl;
  } catch (error) {
    if (isZohoCpaasError(error)) throw error;
    const code =
      env.ZOHO_CPAAS_REGION && !isRegion(env.ZOHO_CPAAS_REGION)
        ? "ZOHO_CPAAS_UNSUPPORTED_REGION"
        : "ZOHO_CPAAS_INVALID_CONFIG";
    throw zohoError(code);
  }
}

export function providerConfiguration(channel: Channel): {
  baseUrl: string;
  authorization: string;
} {
  const token = tokenFor(channel);
  if (!token) throw zohoError("ZOHO_CPAAS_NOT_CONFIGURED");
  return { baseUrl: providerBaseUrl(channel), authorization: normalizeToken(token) };
}
