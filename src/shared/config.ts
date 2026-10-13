import { zohoCpaasError } from "./errors.js";
import { isRegion, normalizeToken, regionBaseUrl } from "./provider.js";

/** Optional component environment values parsed before Zoho operations. */
export type ComponentEnv = {
  ZOHO_CPAAS_REGION?: string;
  ZOHO_CPAAS_BASE_URL?: string;
  ZOHO_CPAAS_TOKEN?: string;
  ZOHO_CPAAS_EMAIL_TOKEN?: string;
  ZOHO_CPAAS_SMS_TOKEN?: string;
  ZOHO_CPAAS_WHATSAPP_TOKEN?: string;
  ZOHO_CPAAS_WEBHOOK_SECRET?: string;
  ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS?: string;
  ZOHO_CPAAS_RETENTION_DAYS?: string;
  ZOHO_CPAAS_TEST_MODE?: string;
};

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
  return {
    region: env.ZOHO_CPAAS_REGION ?? "us",
    baseUrl: regionBaseUrl(env.ZOHO_CPAAS_REGION, env.ZOHO_CPAAS_BASE_URL),
    token: env.ZOHO_CPAAS_TOKEN,
    emailToken: env.ZOHO_CPAAS_EMAIL_TOKEN,
    smsToken: env.ZOHO_CPAAS_SMS_TOKEN,
    whatsappToken: env.ZOHO_CPAAS_WHATSAPP_TOKEN,
    webhookSecret: env.ZOHO_CPAAS_WEBHOOK_SECRET,
    webhookSecretPrevious: env.ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS,
    retentionDays,
    testMode: env.ZOHO_CPAAS_TEST_MODE === "true",
  };
}
