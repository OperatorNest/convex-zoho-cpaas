import { isRecord } from "../shared/record.js";
import { v } from "convex/values";
import { classifyProviderError } from "../shared/retry.js";
import { zohoCpaasError } from "../shared/errors.js";
import { validateUploadFile } from "../shared/provider.js";
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
          signal: controller.signal,
        });
      } catch {
        console.warn("ZOHO_CPAAS_NETWORK_ERROR");
        throw zohoCpaasError("ZOHO_CPAAS_NETWORK_ERROR", { retryable: true });
      }
      try {
        raw = await response.text();
      } catch {
        raw = undefined;
      }
    } finally {
      clearTimeout(timeout);
    }
    let parsed: unknown;
    try {
      parsed = raw !== undefined && raw.length <= 65536 ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const classified = classifyProviderError(
        response.status,
        parsed,
        response.headers.get("Retry-After"),
      );
      const zohoCode = classified.code;
      console.warn(zohoCode);
      throw zohoCpaasError("ZOHO_CPAAS_PROVIDER_ERROR", {
        retryable: classified.retryable,
        providerStatus: response.status,
        providerCode: classified.providerCode,
      });
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
