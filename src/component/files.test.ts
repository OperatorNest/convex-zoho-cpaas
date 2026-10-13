import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { expectZohoCpaasError, expectZohoCpaasErrorFields, stubFetch } from "../test-helpers.js";

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

function createUnreadableStream(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.error(new Error("connection reset"));
    },
  });
}

test("upload sends the raw file body with its MIME type and a name query and returns the cache key", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "false");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ data: { file_cache_key: "fc-123" } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);
  const content = new TextEncoder().encode("hello").buffer;
  expect(
    await t.action(api.files.upload, { name: "note one.txt", mimeType: "text/plain", content }),
  ).toBe("fc-123");
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(url).toBe("https://cpaas.zoho.com/v1.1/files?name=note%20one.txt");
  expect(init?.headers).toMatchObject({
    Authorization: "Zoho-enczapikey dummy-token",
    "Content-Type": "text/plain",
  });
  const body = init?.body;
  if (!(body instanceof ArrayBuffer)) throw new Error("Expected a raw file body");
  expect(new TextDecoder().decode(body)).toBe("hello");
});

test("upload rejects a MIME type that is not a single type/subtype token pair", async () => {
  const t = convexTest(schema, modules);
  for (const mimeType of ["", "text", "text/plain; charset=utf-8", "text/plain\r\nX-Injected: 1"])
    await expectZohoCpaasError(
      t.action(api.files.upload, { ...file, mimeType, testMode: true }),
      "ZOHO_CPAAS_INVALID_ARGUMENT",
    );
});

test("upload reports a failed body read on a rejected response as a provider error", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "false");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
  const t = convexTest(schema, modules);
  stubFetch(() => new Response(createUnreadableStream(), { status: 502 }));
  await expectZohoCpaasErrorFields(t.action(api.files.upload, file), "ZOHO_CPAAS_PROVIDER_ERROR", {
    providerStatus: 502,
  });
  stubFetch(() => new Response(createUnreadableStream(), { status: 200 }));
  await expectZohoCpaasError(t.action(api.files.upload, file), "ZOHO_CPAAS_INVALID_RESPONSE");
});

test("upload rejects invalid names, missing credentials, and invalid provider configuration", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "false");
  vi.stubEnv("ZOHO_CPAAS_TOKEN", undefined);
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", undefined);
  const t = convexTest(schema, modules);
  expect(await t.action(api.files.upload, { ...file, testMode: true })).toMatch(/^test-file-/);
  await expectZohoCpaasError(
    t.action(api.files.upload, { ...file, name: "" }),
    "ZOHO_CPAAS_INVALID_ARGUMENT",
  );
  await expectZohoCpaasError(t.action(api.files.upload, file), "ZOHO_CPAAS_NOT_CONFIGURED");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
  vi.stubEnv("ZOHO_CPAAS_REGION", "invalid");
  await expectZohoCpaasError(t.action(api.files.upload, file), "ZOHO_CPAAS_NOT_CONFIGURED");
  vi.stubEnv("ZOHO_CPAAS_REGION", "us");
  vi.stubEnv("ZOHO_CPAAS_BASE_URL", "http://insecure.example.test");
  await expectZohoCpaasError(t.action(api.files.upload, file), "ZOHO_CPAAS_NOT_CONFIGURED");
});

test("upload classifies network and malformed successful responses", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "false");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
  const t = convexTest(schema, modules);
  stubFetch(() => {
    throw new Error("transport failure");
  });
  await expectZohoCpaasErrorFields(t.action(api.files.upload, file), "ZOHO_CPAAS_NETWORK_ERROR", {
    retryable: true,
  });
  stubFetch(() => new Response("not-json", { status: 200 }));
  await expectZohoCpaasError(t.action(api.files.upload, file), "ZOHO_CPAAS_INVALID_RESPONSE");
  stubFetch(() => new Response(JSON.stringify({ data: {} }), { status: 200 }));
  await expectZohoCpaasError(t.action(api.files.upload, file), "ZOHO_CPAAS_INVALID_RESPONSE");
  stubFetch(() => new Response(JSON.stringify({ file_cache_key: "cache-top" }), { status: 200 }));
  expect(await t.action(api.files.upload, file)).toBe("cache-top");
  stubFetch(
    () =>
      new Response(JSON.stringify({ data: { file_cache_key: "cache-nested" } }), { status: 200 }),
  );
  expect(await t.action(api.files.upload, file)).toBe("cache-nested");
});

test("upload reports provider rejection and unusable cache keys", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "false");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
  const t = convexTest(schema, modules);
  stubFetch(
    () =>
      new Response(JSON.stringify({ error: { code: "THROTTLED" } }), {
        status: 429,
        headers: { "Retry-After": "1" },
      }),
  );
  await expectZohoCpaasErrorFields(t.action(api.files.upload, file), "ZOHO_CPAAS_PROVIDER_ERROR", {
    providerStatus: 429,
    providerCode: "THROTTLED",
  });
  stubFetch(() => new Response("not-json", { status: 400 }));
  await expectZohoCpaasError(t.action(api.files.upload, file), "ZOHO_CPAAS_PROVIDER_ERROR");
  stubFetch(() => new Response(JSON.stringify({ file_cache_key: "" }), { status: 200 }));
  await expectZohoCpaasError(t.action(api.files.upload, file), "ZOHO_CPAAS_INVALID_RESPONSE");
  stubFetch(
    () => new Response(JSON.stringify({ file_cache_key: "x".repeat(513) }), { status: 200 }),
  );
  await expectZohoCpaasError(t.action(api.files.upload, file), "ZOHO_CPAAS_INVALID_RESPONSE");
});
