import type { PaginationOptions } from "convex/server";
import { jsonToConvex } from "convex/values";
import { zohoCpaasError } from "./errors.js";

export function boundedPage(options: PaginationOptions): PaginationOptions {
  if (!Number.isSafeInteger(options.numItems) || options.numItems < 1 || options.numItems > 100)
    throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
  for (const cursor of [options.cursor, options.endCursor]) {
    if (cursor === null || cursor === undefined) continue;
    try {
      if (cursor.length > 4096) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
      const value = jsonToConvex(JSON.parse(cursor));
      if (
        !Array.isArray(value) ||
        value.some(
          (item) =>
            item !== null &&
            typeof item !== "string" &&
            typeof item !== "number" &&
            typeof item !== "boolean" &&
            typeof item !== "bigint" &&
            !(item instanceof ArrayBuffer),
        )
      )
        throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
    } catch {
      throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
    }
  }
  return {
    numItems: options.numItems,
    cursor: options.cursor,
    endCursor: options.endCursor,
    maximumRowsRead: options.numItems + 1,
  };
}

export function boundedString(value: string | undefined, max: number): void {
  if (value !== undefined && (value.length === 0 || value.length > max))
    throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
}
export function boundedPayload(payload: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 256 * 1024)
    throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
}
