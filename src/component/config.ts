import { env } from "./_generated/server.js";
import { zohoError } from "../shared/errors.js";
import { isRegion, normalizeToken, regionBaseUrl } from "../shared/provider.js";
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

export function providerConfiguration(channel: Channel): {
  baseUrl: string;
  authorization: string;
} {
  const token = tokenFor(channel);
  if (!token)
    throw zohoError("ZOHO_CPAAS_NOT_CONFIGURED", `Zoho CPaaS ${channel} is not configured`);
  try {
    return {
      baseUrl: regionBaseUrl(env.ZOHO_CPAAS_REGION, env.ZOHO_CPAAS_BASE_URL),
      authorization: normalizeToken(token),
    };
  } catch {
    const code =
      env.ZOHO_CPAAS_REGION && !isRegion(env.ZOHO_CPAAS_REGION)
        ? "ZOHO_CPAAS_UNSUPPORTED_REGION"
        : "ZOHO_CPAAS_INVALID_CONFIG";
    throw zohoError(code, "Zoho CPaaS region, base URL, or token configuration is invalid");
  }
}
