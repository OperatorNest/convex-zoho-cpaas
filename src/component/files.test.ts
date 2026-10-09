import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const file = {
  name: "fixture.bin",
  mimeType: "application/octet-stream",
  content: new Uint8Array([1, 2, 3]).buffer,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("uploadFile rejects invalid names, missing credentials, and invalid provider configuration", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "false");
  vi.stubEnv("ZOHO_CPAAS_TOKEN", undefined);
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", undefined);
  const t = convexTest(schema, modules);
  expect(await t.action(api.files.uploadFile, { ...file, testMode: true })).toMatch(/^test-file-/);
  await expect(t.action(api.files.uploadFile, { ...file, name: "" })).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" },
  });
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_NOT_CONFIGURED" },
  });
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
  vi.stubEnv("ZOHO_CPAAS_REGION", "invalid");
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_UNSUPPORTED_REGION" },
  });
  vi.stubEnv("ZOHO_CPAAS_REGION", "us");
  vi.stubEnv("ZOHO_CPAAS_BASE_URL", "http://insecure.example.test");
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_INVALID_CONFIG" },
  });
});

test("uploadFile classifies network and malformed successful responses", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "false");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("synthetic transport failure");
    }),
  );
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_UPLOAD_FAILED", retryable: true },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("not-json", { status: 200 })),
  );
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_UPLOAD_FAILED" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })),
  );
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_UPLOAD_FAILED" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ file_cache_key: "cache-top" }), { status: 200 }),
    ),
  );
  expect(await t.action(api.files.uploadFile, file)).toBe("cache-top");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { file_cache_key: "cache-nested" } }), { status: 200 }),
    ),
  );
  expect(await t.action(api.files.uploadFile, file)).toBe("cache-nested");
});

test("uploadFile reports provider rejection and unusable cache keys", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "false");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "THROTTLED" } }), {
          status: 429,
          headers: { "Retry-After": "1" },
        }),
    ),
  );
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_UPLOAD_FAILED", retryable: true },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("not-json", { status: 400 })),
  );
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_UPLOAD_FAILED", retryable: false },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ file_cache_key: "" }), { status: 200 })),
  );
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_UPLOAD_FAILED" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ file_cache_key: "x".repeat(513) }), { status: 200 }),
    ),
  );
  await expect(t.action(api.files.uploadFile, file)).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_UPLOAD_FAILED" },
  });
});
