import { zohoCpaasError } from "./errors.js";
import { isRegion, normalizeToken, regionBaseUrl, regionFromBaseUrl } from "./provider.js";

/** Component env values the component reads; each stays an optional string until `readConfig` validates it. */
export type ComponentEnv = {
  readonly ZOHO_CPAAS_REGION?: string;
  readonly ZOHO_CPAAS_BASE_URL?: string;
  readonly ZOHO_CPAAS_TOKEN?: string;
  readonly ZOHO_CPAAS_EMAIL_TOKEN?: string;
  readonly ZOHO_CPAAS_SMS_TOKEN?: string;
  readonly ZOHO_CPAAS_WHATSAPP_TOKEN?: string;
  readonly ZOHO_CPAAS_WEBHOOK_SECRET?: string;
  readonly ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS?: string;
  readonly ZOHO_CPAAS_RETENTION_DAYS?: string;
  readonly ZOHO_CPAAS_TEST_MODE?: string;
};

/** Validates every component env value; throws `ZOHO_CPAAS_NOT_CONFIGURED` on any malformed value. */
export function readConfig(env: ComponentEnv) {
  if (env.ZOHO_CPAAS_REGION !== undefined && !isRegion(env.ZOHO_CPAAS_REGION))
    throw zohoCpaasError("ZOHO_CPAAS_NOT_CONFIGURED");
  if (env.ZOHO_CPAAS_BASE_URL !== undefined && !env.ZOHO_CPAAS_BASE_URL.trim())
    throw zohoCpaasError("ZOHO_CPAAS_NOT_CONFIGURED");
  if (
    env.ZOHO_CPAAS_TEST_MODE !== undefined &&
    env.ZOHO_CPAAS_TEST_MODE !== "true" &&
    env.ZOHO_CPAAS_TEST_MODE !== "false"
  )
    throw zohoCpaasError("ZOHO_CPAAS_NOT_CONFIGURED");
  const retentionDays =
    env.ZOHO_CPAAS_RETENTION_DAYS === undefined ? 30 : Number(env.ZOHO_CPAAS_RETENTION_DAYS);
  if (
    (env.ZOHO_CPAAS_RETENTION_DAYS !== undefined && !/^\d+$/.test(env.ZOHO_CPAAS_RETENTION_DAYS)) ||
    !Number.isSafeInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 3650
  )
    throw zohoCpaasError("ZOHO_CPAAS_NOT_CONFIGURED");
  const tokens = [
    env.ZOHO_CPAAS_TOKEN,
    env.ZOHO_CPAAS_EMAIL_TOKEN,
    env.ZOHO_CPAAS_SMS_TOKEN,
    env.ZOHO_CPAAS_WHATSAPP_TOKEN,
  ];
  for (const token of tokens) if (token !== undefined) normalizeToken(token);
  for (const secret of [env.ZOHO_CPAAS_WEBHOOK_SECRET, env.ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS])
    if (secret !== undefined && !secret.trim()) throw zohoCpaasError("ZOHO_CPAAS_NOT_CONFIGURED");
  const baseUrl = regionBaseUrl(env.ZOHO_CPAAS_REGION, env.ZOHO_CPAAS_BASE_URL);
  return {
    region: env.ZOHO_CPAAS_REGION ?? regionFromBaseUrl(baseUrl),
    baseUrl,
    token: env.ZOHO_CPAAS_TOKEN,
    emailToken: env.ZOHO_CPAAS_EMAIL_TOKEN,
    smsToken: env.ZOHO_CPAAS_SMS_TOKEN,
    whatsappToken: env.ZOHO_CPAAS_WHATSAPP_TOKEN,
    webhookSecret: env.ZOHO_CPAAS_WEBHOOK_SECRET,
    webhookSecretPrevious: env.ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS,
    retentionDays,
    testMode: resolveTestMode(undefined, env),
  };
}

// shared-block:begin
/** Returns true when the caller requests test mode or `ZOHO_CPAAS_TEST_MODE` is `"true"`; the request can enable test mode and cannot disable it. */
export function resolveTestMode(requested: boolean | undefined, env: ComponentEnv): boolean {
  return requested === true || env.ZOHO_CPAAS_TEST_MODE === "true";
}
// shared-block:end
