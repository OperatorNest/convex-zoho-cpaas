import { env, query } from "./_generated/server.js";
import { zohoCpaasError } from "../shared/errors.js";
import { isIndiaBaseUrl, normalizeToken } from "../shared/provider.js";
import type { Channel } from "../shared/status.js";
import { readConfig, resolveTestMode } from "../shared/config.js";
import { configurationValidator } from "../shared/validators.js";

export function readTestMode(requested: boolean | undefined): boolean {
  readConfig(env);
  return resolveTestMode(requested, env);
}

export function tokenFor(channel: Channel): string | undefined {
  const config = readConfig(env);
  return (
    (channel === "email"
      ? config.emailToken
      : channel === "sms"
        ? config.smsToken
        : config.whatsappToken) ?? config.token
  );
}

export function providerBaseUrl(channel: Channel): string {
  const { baseUrl } = readConfig(env);
  if (channel === "sms" && !isIndiaBaseUrl(baseUrl))
    throw zohoCpaasError("ZOHO_CPAAS_UNSUPPORTED_REGION");
  return baseUrl;
}

export function providerConfiguration(channel: Channel): {
  baseUrl: string;
  authorization: string;
} {
  const token = tokenFor(channel);
  if (!token) throw zohoCpaasError("ZOHO_CPAAS_NOT_CONFIGURED");
  return { baseUrl: providerBaseUrl(channel), authorization: normalizeToken(token) };
}

export const get = query({
  args: {},
  returns: configurationValidator,
  handler: () => ({
    configured: {
      email: tokenFor("email") !== undefined,
      sms: tokenFor("sms") !== undefined,
      whatsapp: tokenFor("whatsapp") !== undefined,
    },
    testMode: readTestMode(undefined),
    region: readConfig(env).region,
  }),
});
