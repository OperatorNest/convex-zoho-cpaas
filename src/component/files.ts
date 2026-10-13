import { isRecord } from "../shared/record.js";
import { v } from "convex/values";
import { classifyProviderError } from "../shared/retry.js";
import { zohoCpaasError } from "../shared/errors.js";
import { readBoundedText } from "../shared/bounds.js";
import { maxProviderBodyBytes, validateUploadFile } from "../shared/provider.js";
import { action } from "./_generated/server.js";
import { providerConfiguration, readTestMode, tokenFor } from "./config.js";

export const upload = action({
  args: {
    name: v.string(),
    mimeType: v.string(),
    content: v.bytes(),
    testMode: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    validateUploadFile(args.name, args.mimeType, args.content.byteLength);
    const testMode = readTestMode(args.testMode);
    if (testMode) return `test-file-${crypto.randomUUID()}`;
    if (!tokenFor("email")) throw zohoCpaasError("ZOHO_CPAAS_NOT_CONFIGURED");
    const { baseUrl, authorization } = providerConfiguration("email");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    let raw: string | undefined;
    try {
      try {
        response = await fetch(`${baseUrl}/files?name=${encodeURIComponent(args.name)}`, {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": args.mimeType,
            Accept: "application/json",
          },
          body: args.content,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        console.warn("ZOHO_CPAAS_NETWORK_ERROR");
        throw zohoCpaasError("ZOHO_CPAAS_NETWORK_ERROR", { retryable: true });
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw zohoCpaasError("ZOHO_CPAAS_INVALID_RESPONSE");
      }
      try {
        raw = await readBoundedText(response, maxProviderBodyBytes);
      } catch {
        raw = undefined;
      }
    } finally {
      clearTimeout(timeout);
    }
    let parsed: unknown;
    try {
      parsed = raw === undefined ? null : JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const classified = classifyProviderError(
        response.status,
        parsed,
        response.headers.get("Retry-After"),
      );
      throw zohoCpaasError(classified.code, classified);
    }
    if (!parsed) throw zohoCpaasError("ZOHO_CPAAS_INVALID_RESPONSE");
    const value = isRecord(parsed) ? parsed : {};
    const data = isRecord(value.data) ? value.data : {};
    const key =
      typeof value.file_cache_key === "string" ? value.file_cache_key : data.file_cache_key;
    if (typeof key !== "string" || !key || key.length > 512)
      throw zohoCpaasError("ZOHO_CPAAS_INVALID_RESPONSE");
    return key;
  },
});
