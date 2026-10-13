import { isRecord } from "../shared/record.js";
import { v } from "convex/values";
import { classifyProviderError, zohoError } from "../shared/errors.js";
import { validateUploadFile } from "../shared/provider.js";
import { action } from "./_generated/server.js";
import { providerConfiguration, resolveTestMode, tokenFor } from "./config.js";

export const uploadFile = action({
  args: {
    name: v.string(),
    mimeType: v.string(),
    content: v.bytes(),
    testMode: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    validateUploadFile(args.name, args.mimeType, args.content.byteLength);
    const testMode = resolveTestMode(args.testMode);
    if (testMode) return `test-file-${crypto.randomUUID()}`;
    if (!tokenFor("email")) throw zohoError("ZOHO_CPAAS_NOT_CONFIGURED");
    const { baseUrl, authorization } = providerConfiguration("email");
    const body = new FormData();
    body.append("file", new Blob([args.content], { type: args.mimeType }), args.name);
    let response: Response;
    let raw: string;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      response = await fetch(`${baseUrl}/files`, {
        method: "POST",
        headers: { Authorization: authorization, Accept: "application/json" },
        body,
        signal: controller.signal,
      });
      raw = await response.text();
    } catch {
      console.warn("ZOHO_CPAAS_NETWORK_ERROR");
      throw zohoError("ZOHO_CPAAS_UPLOAD_FAILED");
    } finally {
      clearTimeout(timeout);
    }
    let parsed: unknown;
    try {
      parsed = raw.length <= 65536 ? JSON.parse(raw) : null;
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
      throw zohoError("ZOHO_CPAAS_UPLOAD_FAILED", {
        providerStatus: response.status,
        providerCode: classified.providerCode,
      });
    }
    if (!parsed) throw zohoError("ZOHO_CPAAS_UPLOAD_FAILED");
    const value = isRecord(parsed) ? parsed : {};
    const data = isRecord(value.data) ? value.data : {};
    const key =
      typeof value.file_cache_key === "string" ? value.file_cache_key : data.file_cache_key;
    if (typeof key !== "string" || !key || key.length > 512)
      throw zohoError("ZOHO_CPAAS_UPLOAD_FAILED");
    return key;
  },
});
