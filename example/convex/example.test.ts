import { register } from "@operatornest/convex-zoho-cpaas/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api.js";
import schema from "./schema.js";
import {
  atOrThrow,
  createEventTimeFields,
  drain,
  expectZohoCpaasError,
  signWebhook,
} from "../../src/test-helpers.js";

const modules = import.meta.glob("./**/*.ts");
const fresh = () => {
  const t = convexTest(schema, modules);
  register(t);
  return t;
};
const acceptedEmail = {
  data: [{ code: "EM_104", additional_info: [], message: "OK" }],
  message: "OK",
  request_id: "request-1",
};

function jsonRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
  return JSON.parse(init.body);
}

function payloadArray(payload: unknown, field: string): unknown[] {
  if (!payload || typeof payload !== "object" || !Object.hasOwn(payload, field))
    throw new Error(`Expected ${field} array in provider payload`);
  const value: unknown = Reflect.get(payload, field);
  if (!Array.isArray(value)) throw new Error(`Expected ${field} array in provider payload`);
  return value;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("app client reports configuration and no-token test mode", async () => {
  vi.stubEnv("ZOHO_CPAAS_TOKEN", undefined);
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  const t = fresh();
  expect(await t.query(internal.example.getConfig, {})).toEqual({
    configured: false,
    testMode: true,
    region: "us",
  });
});

test("example app sends in no-token test mode without fetching", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", undefined);
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(internal.example.sendEmail, {
    to: "alice@example.test",
    subject: "Hello",
    textbody: "Body",
  });
  expect(ids).toHaveLength(1);
  await drain(t);
  expect(await t.query(internal.example.get, { messageId: atOrThrow(ids, 0) })).toMatchObject({
    status: "accepted",
    to: "alice@example.test",
    zohoRequestId: expect.stringMatching(/^test-/),
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("missing credentials require explicit test mode", async () => {
  vi.stubEnv("ZOHO_CPAAS_TOKEN", undefined);
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "false");
  const t = fresh();
  await expectZohoCpaasError(
    t.mutation(components.zohoCpaas.email.send, {
      from: { address: "sender@example.test" },
      to: [{ address: "alice@example.test" }],
      subject: "Hello",
      textbody: "Body",
    }),
    "ZOHO_CPAAS_NOT_CONFIGURED",
  );
  const optedIn = await t.mutation(components.zohoCpaas.email.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "alice@example.test" }],
    subject: "Hello",
    textbody: "Body",
    testMode: true,
  });
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(optedIn, 0) }),
  ).toMatchObject({
    testMode: true,
  });
});

test("malformed provider configuration fails before fetch with a structured error", async () => {
  vi.stubEnv("ZOHO_CPAAS_TOKEN", " token with whitespace ");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  await expectZohoCpaasError(
    t.mutation(components.zohoCpaas.email.send, {
      from: { address: "sender@example.test" },
      to: [{ address: "alice@example.test" }],
      subject: "Hello",
      textbody: "Body",
    }),
    "ZOHO_CPAAS_NOT_CONFIGURED",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("example app sends through workpool and preserves provider request id", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(acceptedEmail), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(internal.example.sendEmail, {
    to: "alice@example.test",
    subject: "Hello",
    textbody: "Body",
    idempotencyKey: "send-1",
  });
  const same = await t.mutation(internal.example.sendEmail, {
    to: "alice@example.test",
    subject: "Hello",
    textbody: "Body",
    idempotencyKey: "send-1",
  });
  expect(same).toEqual(ids);
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://cpaas.zoho.com/v1.1/email");
  expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get("Authorization")).toBe(
    "Zoho-enczapikey test-token",
  );
  expect(jsonRequestBody(fetchMock.mock.calls[0]?.[1])).toMatchObject({
    from: { address: "notifications@example.test" },
    to: [{ email_address: { address: "alice@example.test" } }],
    subject: "Hello",
    textbody: "Body",
    client_reference: atOrThrow(ids, 0),
  });
  expect(await t.query(internal.example.get, { messageId: atOrThrow(ids, 0) })).toMatchObject({
    status: "accepted",
    zohoRequestId: "request-1",
  });
});

test("email sends preserve trimmed recipient casing while indexing rows in lowercase", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(acceptedEmail), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.email.send, {
    from: { address: " Sender@Example.test " },
    to: [{ address: " Alice@Example.test " }],
    cc: [{ address: " Copy@Example.test " }],
    subject: "Hello",
    textbody: "Body",
  });
  await drain(t);
  expect(jsonRequestBody(fetchMock.mock.calls[0]?.[1])).toMatchObject({
    from: { address: "Sender@Example.test" },
    to: [{ email_address: { address: "Alice@Example.test" } }],
    cc: [{ email_address: { address: "Copy@Example.test" } }],
  });
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({
    to: "alice@example.test",
  });
});

test("an odd 2xx response is accepted with a warning and is never retried", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) => new Response("<html>ok</html>", { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(internal.example.sendEmail, {
    to: "odd@example.test",
    subject: "Hello",
    textbody: "Body",
  });
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({
    status: "accepted",
    warning: "ZOHO_CPAAS_INVALID_RESPONSE",
    attempts: 1,
  });
});

test("email workpool retries are capped at five attempts and a definitive failure can replay", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ error: { code: "TM_4001" } }), { status: 400 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const args = {
    from: { address: "sender@example.test" },
    to: [{ address: "retry@example.test" }],
    subject: "Hello",
    textbody: "Body",
    idempotencyKey: "retry-after-failure",
  };
  const first = await t.mutation(components.zohoCpaas.email.send, args);
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const second = await t.mutation(components.zohoCpaas.email.send, args);
  expect(atOrThrow(second, 0)).not.toBe(atOrThrow(first, 0));

  fetchMock.mockImplementation(async () => new Response("failure", { status: 500 }));
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(second, 0) }),
  ).toMatchObject({
    status: "unknown",
    attempts: 5,
  });
});

test("an ambiguous email attempt keeps its idempotency key after a later rejection", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi
    .fn<(_url: string, _init: RequestInit) => Promise<Response>>()
    .mockRejectedValueOnce(new Error("network timeout"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "TM_4001" } }), { status: 400 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const args = {
    from: { address: "sender@example.test" },
    to: [{ address: "mixed-outcome@example.test" }],
    subject: "Mixed outcome",
    textbody: "Body",
    idempotencyKey: "ambiguous-then-rejected",
  };
  const first = await t.mutation(components.zohoCpaas.email.send, args);
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(first, 0) }),
  ).toMatchObject({ status: "unknown", attempts: 2, failureDefinitive: false });
  expect(await t.mutation(components.zohoCpaas.email.send, args)).toEqual(first);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("SMS permits a configured India host even when the region env is unset", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_BASE_URL", "https://api.zeptomail.in/v1.1");
  vi.stubEnv("ZOHO_CPAAS_SMS_TOKEN", "sms-token");
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ data: { code: "MSG_101", message_id: "m1", request_id: "r1" } }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const id = await t.mutation(components.zohoCpaas.sms.sendTemplate, {
    senderKey: "sender",
    to: "+919876543210",
    templateKey: "template",
  });
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await t.query(components.zohoCpaas.messages.get, { messageId: id })).toMatchObject({
    status: "accepted",
  });
});

test("the 500-recipient batch boundary includes cc and bcc", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(acceptedEmail), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.email.sendBatch, {
    from: { address: "sender@example.test" },
    to: Array.from({ length: 498 }, (_, i) => ({
      emailAddress: { address: `r${i}@example.test` },
    })),
    cc: [{ address: "copy@example.test" }],
    bcc: [{ address: "archive@example.test" }],
    subject: "Hello",
    textbody: "Body",
  });
  expect(ids).toHaveLength(500);
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const payload = jsonRequestBody(fetchMock.mock.calls[0]?.[1]);
  expect(payloadArray(payload, "to")).toHaveLength(498);
  expect(payloadArray(payload, "cc")).toHaveLength(1);
  expect(payloadArray(payload, "bcc")).toHaveLength(1);
  await expectZohoCpaasError(
    t.mutation(components.zohoCpaas.email.sendBatch, {
      from: { address: "sender@example.test" },
      to: Array.from({ length: 500 }, (_, i) => ({
        emailAddress: { address: `overflow${i}@example.test` },
      })),
      cc: [{ address: "overflow-copy@example.test" }],
      subject: "Hello",
      textbody: "Body",
    }),
    "ZOHO_CPAAS_INVALID_ARGUMENT",
  );
});

test("upload enforces Zoho's 15 MB boundary and classifies provider failures", async () => {
  const t = fresh();
  await expect(
    t.action(components.zohoCpaas.files.upload, {
      name: "small.bin",
      mimeType: "application/octet-stream",
      content: new Uint8Array([1, 2, 3]).buffer,
      testMode: true,
    }),
  ).resolves.toMatch(/^test-file-/);
  await expect(
    t.action(components.zohoCpaas.files.upload, {
      name: "max.bin",
      mimeType: "application/octet-stream",
      content: new Uint8Array(15 * 1024 * 1024).buffer,
      testMode: true,
    }),
  ).resolves.toMatch(/^test-file-/);
  await expectZohoCpaasError(
    t.action(components.zohoCpaas.files.upload, {
      name: "too-large.bin",
      mimeType: "application/octet-stream",
      content: new Uint8Array(15 * 1024 * 1024 + 1).buffer,
      testMode: true,
    }),
    "ZOHO_CPAAS_INVALID_ARGUMENT",
  );

  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "email-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ error: { code: "TM_8001" } }), { status: 422 }),
    ),
  );
  await expectZohoCpaasError(
    t.action(components.zohoCpaas.files.upload, {
      name: "file.bin",
      mimeType: "application/octet-stream",
      content: new Uint8Array([1, 2, 3]).buffer,
    }),
    "ZOHO_CPAAS_PROVIDER_ERROR",
  );
});

test("batch and template batch each make one request and keep one row per recipient", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(acceptedEmail), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const common: {
    from: { address: string };
    mergeInfo: Record<string, string>;
    cc: { address: string }[];
    bcc: { address: string }[];
    to: { emailAddress: { address: string }; mergeInfo: Record<string, string> }[];
  } = {
    from: { address: "sender@example.test" },
    mergeInfo: { shared: "common", overridden: "shared" },
    cc: [{ address: "copy@example.test" }],
    bcc: [{ address: "archive@example.test" }],
    to: [
      {
        emailAddress: { address: "one@example.test" },
        mergeInfo: { name: "One", overridden: "local" },
      },
      { emailAddress: { address: "two@example.test" }, mergeInfo: { name: "Two" } },
    ],
  };
  const first = await t.mutation(components.zohoCpaas.email.sendBatch, {
    ...common,
    subject: "Hello {{name}}",
    textbody: "Hi {{name}}",
  });
  const second = await t.mutation(components.zohoCpaas.email.sendTemplateBatch, {
    ...common,
    templateKey: "template-1",
  });
  expect(first).toHaveLength(4);
  expect(second).toHaveLength(4);
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
    expect.arrayContaining([
      "https://cpaas.zoho.com/v1.1/email/batch",
      "https://cpaas.zoho.com/v1.1/email/template/batch",
    ]),
  );
  const payload = jsonRequestBody(
    fetchMock.mock.calls.find((call) => call[0].endsWith("/email/batch"))?.[1],
  );
  expect(payload).toMatchObject({
    client_reference: atOrThrow(first, 0),
    to: [
      { merge_info: { shared: "common", name: "One", overridden: "local" } },
      { merge_info: { shared: "common", name: "Two", overridden: "shared" } },
    ],
  });
  expect(payload).not.toHaveProperty("merge_info");
  expect(JSON.stringify(payload)).not.toContain("__onx_ref");
  expect(payload).toMatchObject({
    cc: [{ email_address: { address: "copy@example.test" } }],
    bcc: [{ email_address: { address: "archive@example.test" } }],
  });
  for (const messageId of first)
    expect(await t.query(components.zohoCpaas.messages.get, { messageId })).toMatchObject({
      clientReference: atOrThrow(first, 0),
    });
});

test("a batch bounce with the documented nested request ID updates only the bounced recipient's row", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "webhook-test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(acceptedEmail), { status: 200 })),
  );
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.email.sendBatch, {
    from: { address: "sender@example.test" },
    to: [
      { emailAddress: { address: "one@example.test" } },
      { emailAddress: { address: "two@example.test" } },
    ],
    subject: "Hello",
    textbody: "Body",
  });
  await drain(t);
  const body = JSON.stringify({
    webhook_request_id: "batch-bounce",
    event_name: ["hardbounce"],
    event_message: [
      {
        email_info: {
          client_reference: atOrThrow(ids, 0),
          to: [{ email_address: { address: "two@example.test" } }],
        },
        event_data: [{ object: "bounce", details: [{ time: new Date().toISOString() }] }],
        request_id: "request-1",
      },
    ],
  });
  const response = await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "producer-signature": await signWebhook(body, "webhook-test-key"),
    },
    body,
  });
  expect(response.status).toBe(200);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({ status: "accepted" });
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 1) }),
  ).toMatchObject({ status: "bounced" });
});

test("verified webhook dedupes, applies hard bounce, suppresses, and commits the app callback", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", undefined);
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "webhook-test-key");
  const t = fresh();
  const ids = await t.mutation(internal.example.sendEmail, {
    to: "bounce@example.test",
    subject: "Hello",
    textbody: "Body",
  });
  await drain(t);
  const sent = await t.query(internal.example.get, { messageId: atOrThrow(ids, 0) });
  const body = JSON.stringify({
    webhook_request_id: "wh-1",
    request_id: sent?.zohoRequestId,
    event_name: ["hardbounce"],
    event_message: [
      {
        email_info: {
          client_reference: atOrThrow(ids, 0),
          to: [{ email_address: { address: "bounce@example.test" } }],
        },
        event_data: [{ object: "bounce", details: [{ time: new Date().toISOString() }] }],
      },
    ],
  });
  const signature = await signWebhook(body, "webhook-test-key");
  const first = await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "producer-signature": signature },
    body,
  });
  expect(first.status).toBe(200);
  expect(await t.query(internal.example.get, { messageId: atOrThrow(ids, 0) })).toMatchObject({
    status: "bounced",
  });
  const suppressions = await t.query(components.zohoCpaas.suppressions.list, {
    channel: "email",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(suppressions.page).toMatchObject([
    { address: "bounce@example.test", reason: "hardbounce" },
  ]);
  const callbackEvents = await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10));
  expect(callbackEvents).toHaveLength(1);
  const second = await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "producer-signature": signature },
    body,
  });
  expect(second.status).toBe(200);
  await drain(t);
  expect(await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10))).toHaveLength(1);
  await expectZohoCpaasError(
    t.mutation(internal.example.sendEmail, {
      to: "bounce@example.test",
      subject: "Blocked",
      textbody: "Body",
    }),
    "ZOHO_CPAAS_ALL_SUPPRESSED",
  );
});

test("webhook fails closed for missing secret and tampering", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", undefined);
  const t = fresh();
  const body = JSON.stringify({
    webhook_request_id: "wh-2",
    event_name: ["open"],
    event_message: [{}],
  });
  const signature = await signWebhook(body, "webhook-test-key");
  const absent = await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "producer-signature": signature },
    body,
  });
  expect(absent.status).toBe(500);
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "webhook-test-key");
  const tampered = await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "producer-signature": signature },
    body: `${body} `,
  });
  expect(tampered.status).toBe(401);
});

test("suppression normalization errors have a stable public error code", async () => {
  const t = fresh();
  await expectZohoCpaasError(
    t.mutation(components.zohoCpaas.suppressions.remove, {
      channel: "email",
      address: "not-an-email",
    }),
    "ZOHO_CPAAS_INVALID_ARGUMENT",
  );
});

test("email retries 429 using Retry-After and stops after five attempts", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const times: number[] = [];
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
    times.push(Date.now());
    return new Response(JSON.stringify({ error: { code: "TM_9999", message: "busy" } }), {
      status: 429,
      headers: { "Retry-After": "2" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(internal.example.sendEmail, {
    to: "retry@example.test",
    subject: "Retry",
    textbody: "Body",
  });
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(5);
  for (let i = 1; i < times.length; i++)
    expect(atOrThrow(times, i) - atOrThrow(times, i - 1)).toBeGreaterThanOrEqual(2000);
  const row = await t.query(components.zohoCpaas.messages.get, {
    messageId: atOrThrow(ids, 0),
  });
  expect(row).toMatchObject({
    status: "failed",
    attempts: 5,
    error: { code: "ZOHO_CPAAS_PROVIDER_ERROR", providerStatus: 429 },
  });
});

test("WhatsApp network failure does not retry, while a known Zoho 503 rejection does", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_WHATSAPP_TOKEN", "wa-token");
  const fetchMock = vi
    .fn<(_url: string, _init: RequestInit) => Promise<Response>>()
    .mockRejectedValueOnce(new Error("timeout"));
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const first = await t.mutation(components.zohoCpaas.whatsapp.sendTemplate, {
    from: "+14155550142",
    to: "+919876543210",
    templateKey: "template-1",
    idempotencyKey: "ambiguous-wa-timeout",
  });
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await t.query(components.zohoCpaas.messages.get, { messageId: first })).toMatchObject({
    status: "unknown",
    attempts: 1,
  });
  expect(
    await t.mutation(components.zohoCpaas.whatsapp.sendTemplate, {
      from: "+14155550142",
      to: "+919876543210",
      templateKey: "template-1",
      idempotencyKey: "ambiguous-wa-timeout",
    }),
  ).toBe(first);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock
    .mockReset()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "SMI_115" } }), { status: 503 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { code: "MSG_101", message_id: "provider-wa-1", request_id: "provider-request-1" },
          status: "success",
        }),
        { status: 200 },
      ),
    );
  const second = await t.mutation(components.zohoCpaas.whatsapp.sendTemplate, {
    from: "+14155550142",
    to: "+919876543211",
    templateKey: "template-1",
  });
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await t.query(components.zohoCpaas.messages.get, { messageId: second })).toMatchObject({
    status: "accepted",
    attempts: 2,
    zohoMessageId: "provider-wa-1",
  });
});

test("queued cancellation prevents fetch and does not cancel an uncanceled batch sibling", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(acceptedEmail), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.email.sendBatch, {
    from: { address: "sender@example.test" },
    to: [
      { emailAddress: { address: "one@example.test" } },
      { emailAddress: { address: "two@example.test" } },
    ],
    subject: "Hello",
    textbody: "Body",
  });
  expect(
    await t.mutation(components.zohoCpaas.messages.cancel, { messageId: atOrThrow(ids, 0) }),
  ).toBe(true);
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const payload = jsonRequestBody(fetchMock.mock.calls[0]?.[1]);
  expect(payload).toMatchObject({ to: [{ email_address: { address: "two@example.test" } }] });
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({ status: "canceled" });
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 1) }),
  ).toMatchObject({ status: "accepted" });
});

test("idempotency key collision with changed payload is rejected", async () => {
  vi.stubEnv("ZOHO_CPAAS_TOKEN", undefined);
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  const t = fresh();
  await t.mutation(internal.example.sendEmail, {
    to: "same@example.test",
    subject: "One",
    textbody: "Body",
    idempotencyKey: "key-1",
  });
  await expect(
    t.mutation(internal.example.sendEmail, {
      to: "same@example.test",
      subject: "Two",
      textbody: "Body",
      idempotencyKey: "key-1",
    }),
  ).rejects.toThrow(/ZOHO_CPAAS_IDEMPOTENCY_CONFLICT/);
});

test("idempotency digest ignores argument key order at every depth", async () => {
  vi.stubEnv("ZOHO_CPAAS_TOKEN", undefined);
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  const t = fresh();
  const first = await t.mutation(components.zohoCpaas.email.send, {
    from: { address: "sender@example.test", name: "Sender" },
    to: [{ address: "order@example.test", name: "Order" }],
    subject: "Order",
    textbody: "Body",
    mimeHeaders: { "X-A": "1", "X-B": "2" },
    idempotencyKey: "reordered",
  });
  const reordered = await t.mutation(components.zohoCpaas.email.send, {
    idempotencyKey: "reordered",
    mimeHeaders: { "X-B": "2", "X-A": "1" },
    textbody: "Body",
    subject: "Order",
    to: [{ name: "Order", address: "order@example.test" }],
    from: { name: "Sender", address: "sender@example.test" },
  });
  expect(reordered).toEqual(first);
  await expectZohoCpaasError(
    t.mutation(components.zohoCpaas.email.send, {
      idempotencyKey: "reordered",
      mimeHeaders: { "X-B": "3", "X-A": "1" },
      textbody: "Body",
      subject: "Order",
      to: [{ name: "Order", address: "order@example.test" }],
      from: { name: "Sender", address: "sender@example.test" },
    }),
    "ZOHO_CPAAS_IDEMPOTENCY_CONFLICT",
  );
});

test("suppressed rows are neutral when deciding whether a failed send can replay", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "secret");
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ error: { code: "TM_4001" } }), { status: 400 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const body = JSON.stringify({
    webhook_request_id: "neutral-hardbounce",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: { to: [{ email_address: { address: "blocked@example.test" } }] },
      },
    ],
  });
  const signed = await signWebhook(body, "secret");
  await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "producer-signature": signed },
    body,
  });
  const args = {
    from: { address: "sender@example.test" },
    to: [{ address: "blocked@example.test" }, { address: "e2e@example.test" }],
    subject: "Hello",
    textbody: "Body",
    idempotencyKey: "suppressed-neutral",
  };
  const first = await t.mutation(components.zohoCpaas.email.send, args);
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const statuses = await Promise.all(
    first.map(
      async (messageId) =>
        (await t.query(components.zohoCpaas.messages.get, { messageId }))?.status,
    ),
  );
  expect(statuses).toEqual(["suppressed", "failed"]);
  const replay = await t.mutation(components.zohoCpaas.email.send, args);
  expect(replay).toHaveLength(2);
  expect(replay).not.toContain(atOrThrow(first, 0));
  expect(replay).not.toContain(atOrThrow(first, 1));
});

test("batch completion preserves an earlier webhook outcome", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "webhook-test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(acceptedEmail), { status: 200 }),
    ),
  );
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.email.sendBatch, {
    from: { address: "sender@example.test" },
    to: [
      { emailAddress: { address: "one@example.test" } },
      { emailAddress: { address: "two@example.test" } },
    ],
    subject: "Hello",
    textbody: "Body",
  });
  const body = JSON.stringify({
    webhook_request_id: "wh-early",
    request_id: "request-1",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: { to: [{ email_address: { address: "two@example.test" } }] },
      },
    ],
  });
  const signature = await signWebhook(body, "webhook-test-key");
  expect(
    (
      await t.fetch("/zoho-cpaas/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "producer-signature": signature },
        body,
      })
    ).status,
  ).toBe(200);
  await drain(t);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({ status: "accepted" });
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 1) }),
  ).toMatchObject({ status: "suppressed" });
  const events = await t.query(components.zohoCpaas.messages.listEvents, {
    messageId: atOrThrow(ids, 1),
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(events.page).toHaveLength(1);
});

test("explicit test mode with token records a template send without fetch", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.email.sendTemplate, {
    from: { address: "sender@example.test" },
    to: [{ address: "template@example.test" }],
    templateAlias: "welcome",
    testMode: true,
  });
  await drain(t);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({ status: "accepted", zohoRequestId: expect.stringMatching(/^test-/) });
});

test("single template uses its endpoint, and SMS uses India override and channel token", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_REGION", "in");
  vi.stubEnv("ZOHO_CPAAS_BASE_URL", "https://api.zeptomail.in/v1.1");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "email-token");
  vi.stubEnv("ZOHO_CPAAS_SMS_TOKEN", "sms-token");
  const fetchMock = vi.fn(
    async (url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify(
          url.endsWith("/sms")
            ? {
                data: { code: "MSG_101", message_id: "sms-1", request_id: "sms-req-1" },
                status: "success",
              }
            : acceptedEmail,
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const email = await t.mutation(internal.example.sendTemplate, {
    to: "template@example.test",
    templateKey: "email-template-1",
  });
  const sms = await t.mutation(components.zohoCpaas.sms.sendTemplate, {
    senderKey: "sender-key",
    to: "+91 98765 43210",
    templateKey: "sms-template-1",
    mergeInfo: { otp: "123456" },
  });
  await drain(t);
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
    expect.arrayContaining([
      "https://api.zeptomail.in/v1.1/email/template",
      "https://api.zeptomail.in/v1.1/sms",
    ]),
  );
  const smsCall = fetchMock.mock.calls.find((call) => call[0].endsWith("/sms"));
  if (smsCall === undefined) throw new Error("Expected SMS provider call");
  expect(new Headers(smsCall[1].headers).get("Authorization")).toBe("Zoho-enczapikey sms-token");
  expect(jsonRequestBody(smsCall[1])).toMatchObject({
    sender_key: "sender-key",
    to: [{ mobile_no: "919876543210" }],
    template_key: "sms-template-1",
    merge_info: { otp: "123456" },
    client_reference: sms,
  });
  expect(await t.query(components.zohoCpaas.messages.get, { messageId: sms })).toMatchObject({
    status: "accepted",
    zohoMessageId: "sms-1",
  });
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(email, 0) }),
  ).toMatchObject({ status: "accepted", zohoRequestId: "request-1" });
});

test("previous webhook secret verifies form data and an undated WhatsApp body leaves the message unchanged", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_WHATSAPP_TOKEN", "wa-token");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "new-secret");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS", "old-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            data: { code: "MSG_101", message_id: "wa-1", request_id: "wa-req-1" },
            status: "success",
          }),
          { status: 200 },
        ),
    ),
  );
  const t = fresh();
  const id = await t.mutation(components.zohoCpaas.whatsapp.sendTemplate, {
    from: "+14155550142",
    to: "+919876543210",
    templateAlias: "utility",
  });
  await drain(t);
  const json = JSON.stringify({
    webhook_request_id: "wa-wh-1",
    event_name: ["read"],
    event_message: [
      { request_id: "wa-req-1", to: "+919876543210", message_id: "wa-1", client_reference: id },
    ],
  });
  const post = async (secret: string) =>
    t.fetch("/zoho-cpaas/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "producer-signature": await signWebhook(json, secret),
      },
      body: `data=${encodeURIComponent(json)}`,
    });
  expect((await post("unknown-secret")).status).toBe(401);
  expect((await post("old-secret")).status).toBe(200);
  expect(await t.query(components.zohoCpaas.messages.get, { messageId: id })).toMatchObject({
    status: "accepted",
  });
  const events = await t.query(components.zohoCpaas.messages.listEvents, {
    messageId: id,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(events.page).toEqual([]);
});

test("all-suppressed sends return a branchable error and suppression removal permits a later send", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "secret");
  const t = fresh();
  const body = JSON.stringify({
    webhook_request_id: "orphan-hardbounce",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: { to: [{ email_address: { address: "blocked@example.test" } }] },
      },
    ],
  });
  const signature = await signWebhook(body, "secret");
  expect(
    (
      await t.fetch("/zoho-cpaas/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "producer-signature": signature },
        body,
      })
    ).status,
  ).toBe(200);
  const args = {
    from: { address: "sender@example.test" },
    to: [{ address: "blocked@example.test" }],
    subject: "Hello",
    textbody: "Body",
    idempotencyKey: "fully-suppressed",
  };
  await expectZohoCpaasError(
    t.mutation(components.zohoCpaas.email.send, args),
    "ZOHO_CPAAS_ALL_SUPPRESSED",
  );
  expect(
    await t.mutation(components.zohoCpaas.suppressions.remove, {
      channel: "email",
      address: "blocked@example.test",
    }),
  ).toBe(true);
  const allowed = await t.mutation(components.zohoCpaas.email.send, {
    ...args,
    idempotencyKey: "after-remove",
  });
  await drain(t);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(allowed, 0) }),
  ).toMatchObject({ status: "accepted" });
});

test("single email tracks to, cc and bcc once with documented recipient shapes", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(acceptedEmail), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.email.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "to@example.test" }],
    cc: [{ address: "cc@example.test" }],
    bcc: [{ address: "bcc@example.test" }],
    replyTo: [{ address: "reply@example.test" }],
    subject: "Hello",
    textbody: "Body",
  });
  expect(ids).toHaveLength(3);
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const payload = jsonRequestBody(fetchMock.mock.calls[0]?.[1]);
  expect(payload).toMatchObject({
    to: [{ email_address: { address: "to@example.test" } }],
    cc: [{ email_address: { address: "cc@example.test" } }],
    bcc: [{ email_address: { address: "bcc@example.test" } }],
    reply_to: [{ address: "reply@example.test" }],
  });
  for (const id of ids)
    expect(await t.query(components.zohoCpaas.messages.get, { messageId: id })).toMatchObject({
      status: "accepted",
      zohoRequestId: "request-1",
    });
});

test("synchronous permanent SMS recipient failure adds suppression", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_REGION", "in");
  vi.stubEnv("ZOHO_CPAAS_SMS_TOKEN", "sms-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({ error: { code: "TM_3501", details: [{ code: "dnd-number" }] } }),
          { status: 422 },
        ),
    ),
  );
  const t = fresh();
  const id = await t.mutation(components.zohoCpaas.sms.sendTemplate, {
    senderKey: "sender-key",
    to: "+919876543210",
    templateKey: "template-1",
  });
  await drain(t);
  expect(await t.query(components.zohoCpaas.messages.get, { messageId: id })).toMatchObject({
    status: "failed",
  });
  const list = await t.query(components.zohoCpaas.suppressions.list, {
    channel: "sms",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(list.page).toMatchObject([{ address: "919876543210", reason: "dnd-number" }]);
});

test("SMS timeout records unknown after one attempt", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_REGION", "in");
  vi.stubEnv("ZOHO_CPAAS_SMS_TOKEN", "sms-token");
  const fetchMock = vi
    .fn<(_url: string, _init: RequestInit) => Promise<Response>>()
    .mockRejectedValue(new Error("timeout"));
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const id = await t.mutation(components.zohoCpaas.sms.sendTemplate, {
    senderKey: "sender-key",
    to: "+919876543210",
    templateKey: "template-1",
  });
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await t.query(components.zohoCpaas.messages.get, { messageId: id })).toMatchObject({
    status: "unknown",
    attempts: 1,
  });
});

test("fetch abort timeouts retry email with a five-attempt cap but never retry SMS", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "email-token");
  vi.stubEnv("ZOHO_CPAAS_REGION", "in");
  vi.stubEnv("ZOHO_CPAAS_SMS_TOKEN", "sms-token");
  const fetchMock = vi.fn(
    (_url: string, init: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const emailIds = await t.mutation(internal.example.sendEmail, {
    to: "timeout@example.test",
    subject: "Timeout",
    textbody: "Body",
    idempotencyKey: "ambiguous-email-timeout",
  });
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(5);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(emailIds, 0) }),
  ).toMatchObject({
    status: "unknown",
    attempts: 5,
  });
  expect(
    await t.mutation(internal.example.sendEmail, {
      to: "timeout@example.test",
      subject: "Timeout",
      textbody: "Body",
      idempotencyKey: "ambiguous-email-timeout",
    }),
  ).toEqual(emailIds);
  expect(fetchMock).toHaveBeenCalledTimes(5);

  fetchMock.mockClear();
  const smsId = await t.mutation(components.zohoCpaas.sms.sendTemplate, {
    senderKey: "sender",
    to: "+919876543210",
    templateKey: "template",
    idempotencyKey: "ambiguous-sms-timeout",
  });
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await t.query(components.zohoCpaas.messages.get, { messageId: smsId })).toMatchObject({
    status: "unknown",
    attempts: 1,
  });
  expect(
    await t.mutation(components.zohoCpaas.sms.sendTemplate, {
      senderKey: "sender",
      to: "+919876543210",
      templateKey: "template",
      idempotencyKey: "ambiguous-sms-timeout",
    }),
  ).toBe(smsId);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("canceling an uncertain retry stops future requests and preserves unknown", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ error: { message: "gateway unavailable" } }), {
        status: 503,
        headers: { "Retry-After": "86400" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const ids = await t.mutation(internal.example.sendEmail, {
    to: "cancel-retry@example.test",
    subject: "Retry",
    textbody: "Body",
    idempotencyKey: "cancel-ambiguous-retry",
  });
  await vi.advanceTimersByTimeAsync(1);
  await t.finishInProgressScheduledFunctions();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    await t.mutation(components.zohoCpaas.messages.cancel, { messageId: atOrThrow(ids, 0) }),
  ).toBe(true);
  vi.runAllTimers();
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({
    status: "unknown",
  });
  expect(
    await t.mutation(internal.example.sendEmail, {
      to: "cancel-retry@example.test",
      subject: "Retry",
      textbody: "Body",
      idempotencyKey: "cancel-ambiguous-retry",
    }),
  ).toEqual(ids);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("account-state SMS errors and SMS_108 are terminal; email SMI_115 waits 24 hours", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_REGION", "in");
  vi.stubEnv("ZOHO_CPAAS_SMS_TOKEN", "sms-token");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "email-token");
  const timestamps: number[] = [];
  let responseIndex = 0;
  const responses = [
    { status: 503, body: { error: { code: "TM_9999", details: [{ code: "SM_128" }] } } },
    { status: 503, body: { error: { code: "SM_133" } } },
    { status: 400, body: { error: { code: "TM_4001", details: [{ code: "SMS_108" }] } } },
  ];
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
    timestamps.push(Date.now());
    const response = atOrThrow(responses, responseIndex++);
    return new Response(JSON.stringify(response.body), { status: response.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const smsIds: string[] = [];
  for (const i of [0, 1, 2]) {
    const id = await t.mutation(components.zohoCpaas.sms.sendTemplate, {
      senderKey: "sender",
      to: `+91987654321${i}`,
      templateKey: "template",
    });
    smsIds.push(id);
    await drain(t);
    const row = await t.query(components.zohoCpaas.messages.get, { messageId: id });
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row).toMatchObject({
      error: {
        code: "ZOHO_CPAAS_PROVIDER_ERROR",
        providerStatus: atOrThrow(responses, i).status,
        providerCode: atOrThrow(responses, i).body.error.code,
      },
    });
  }
  fetchMock.mockImplementationOnce(async (_url: string, _init: RequestInit) => {
    timestamps.push(Date.now());
    return new Response(
      JSON.stringify({ error: { code: "TM_3601", details: [{ code: "SMI_115" }] } }),
      { status: 403 },
    );
  });
  fetchMock.mockImplementationOnce(async (_url: string, _init: RequestInit) => {
    timestamps.push(Date.now());
    return new Response(JSON.stringify(acceptedEmail), { status: 200 });
  });
  const emailIds = await t.mutation(internal.example.sendEmail, {
    to: "daily-limit@example.test",
    subject: "Daily limit",
    textbody: "Body",
  });
  await drain(t);
  expect(fetchMock).toHaveBeenCalledTimes(5);
  const [beforeDailyRetry, afterDailyRetry] = timestamps.slice(-2);
  if (beforeDailyRetry === undefined || afterDailyRetry === undefined)
    throw new Error("Expected both daily-limit attempts");
  expect(afterDailyRetry - beforeDailyRetry).toBeGreaterThanOrEqual(86_400_000);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(emailIds, 0) }),
  ).toMatchObject({
    status: "accepted",
    attempts: 2,
  });
});

test("multi-recipient bounce stays unresolved without a unique reference", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "secret");
  const t = fresh();
  const body = JSON.stringify({
    webhook_request_id: "ambiguous-bounce",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: {
          to: [
            { email_address: { address: "one@example.test" } },
            { email_address: { address: "two@example.test" } },
          ],
        },
      },
    ],
  });
  const signature = await signWebhook(body, "secret");
  expect(
    (
      await t.fetch("/zoho-cpaas/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "producer-signature": signature },
        body,
      })
    ).status,
  ).toBe(200);
  const suppressions = await t.query(components.zohoCpaas.suppressions.list, {
    channel: "email",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(suppressions.page).toHaveLength(0);
  const events = await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10));
  expect(events).toHaveLength(1);
  expect(await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10))).toHaveLength(1);
  const ids = await t.mutation(internal.example.sendEmail, {
    to: "one@example.test",
    subject: "Hello",
    textbody: "Body",
  });
  await drain(t);
  const referenced = JSON.stringify({
    webhook_request_id: "referenced-bounce",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: {
          client_reference: atOrThrow(ids, 0),
          to: [
            { email_address: { address: "one@example.test" } },
            { email_address: { address: "two@example.test" } },
          ],
        },
      },
    ],
  });
  expect(
    (
      await t.fetch("/zoho-cpaas/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "producer-signature": await signWebhook(referenced, "secret"),
        },
        body: referenced,
      })
    ).status,
  ).toBe(200);
  expect(await t.query(internal.example.get, { messageId: atOrThrow(ids, 0) })).toMatchObject({
    status: "bounced",
  });
  const targeted = await t.query(components.zohoCpaas.suppressions.list, {
    channel: "email",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(targeted.page).toMatchObject([{ address: "one@example.test" }]);
});

test("all email variants require an original to recipient", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  const t = fresh();
  const from = { address: "sender@example.test" };
  const cc = [{ address: "cc@example.test" }];
  const base = { from, cc, to: [] };
  await expect(
    t.mutation(components.zohoCpaas.email.send, { ...base, subject: "Hi", textbody: "Body" }),
  ).rejects.toThrow(/ZOHO_CPAAS_INVALID_ARGUMENT/);
  await expect(
    t.mutation(components.zohoCpaas.email.sendTemplate, { ...base, templateKey: "template-1" }),
  ).rejects.toThrow(/ZOHO_CPAAS_INVALID_ARGUMENT/);
  await expect(
    t.mutation(components.zohoCpaas.email.sendBatch, { ...base, subject: "Hi", textbody: "Body" }),
  ).rejects.toThrow(/ZOHO_CPAAS_INVALID_ARGUMENT/);
  await expect(
    t.mutation(components.zohoCpaas.email.sendTemplateBatch, {
      ...base,
      templateKey: "template-1",
    }),
  ).rejects.toThrow(/ZOHO_CPAAS_INVALID_ARGUMENT/);
  const rows = await t.query(components.zohoCpaas.messages.list, {
    recipient: "cc@example.test",
    channel: "email",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(rows.page).toHaveLength(0);
});

test("suppressed final to with eligible cc rejects before recording or fetching", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "test-token");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "secret");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const body = JSON.stringify({
    webhook_request_id: "to-suppressed",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: { to: [{ email_address: { address: "blocked@example.test" } }] },
      },
    ],
  });
  expect(
    (
      await t.fetch("/zoho-cpaas/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "producer-signature": await signWebhook(body, "secret"),
        },
        body,
      })
    ).status,
  ).toBe(200);
  await expect(
    t.mutation(components.zohoCpaas.email.send, {
      from: { address: "sender@example.test" },
      to: [{ address: "blocked@example.test" }],
      cc: [{ address: "cc@example.test" }],
      subject: "Hi",
      textbody: "Body",
    }),
  ).rejects.toThrow(/ZOHO_CPAAS_INVALID_ARGUMENT/);
  await drain(t);
  expect(fetchMock).not.toHaveBeenCalled();
  for (const recipient of ["blocked@example.test", "cc@example.test"]) {
    const rows = await t.query(components.zohoCpaas.messages.list, {
      recipient,
      channel: "email",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(rows.page).toHaveLength(0);
  }
});

test("canceling final to locally fails cc without fetch in e2e and test mode", async () => {
  vi.useFakeTimers();
  for (const configured of [true, false]) {
    vi.stubEnv("ZOHO_CPAAS_TOKEN", configured ? "test-token" : undefined);
    vi.stubEnv("ZOHO_CPAAS_TEST_MODE", configured ? "false" : "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = fresh();
    const ids = await t.mutation(components.zohoCpaas.email.send, {
      from: { address: "sender@example.test" },
      to: [{ address: "to@example.test" }],
      cc: [{ address: "cc@example.test" }],
      subject: "Hi",
      textbody: "Body",
    });
    expect(
      await t.mutation(components.zohoCpaas.messages.cancel, { messageId: atOrThrow(ids, 0) }),
    ).toBe(true);
    await drain(t);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) }),
    ).toMatchObject({ status: "canceled" });
    expect(
      await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 1) }),
    ).toMatchObject({
      status: "failed",
      error: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" },
    });
  }
});

test("blank idempotency keys reject repeatedly across email, SMS and WhatsApp", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_REGION", "in");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  for (const key of ["", " \t "]) {
    await expect(
      t.mutation(components.zohoCpaas.email.send, {
        from: { address: "sender@example.test" },
        to: [{ address: "to@example.test" }],
        subject: "Hi",
        textbody: "Body",
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/ZOHO_CPAAS_INVALID_ARGUMENT/);
    await expect(
      t.mutation(components.zohoCpaas.sms.sendTemplate, {
        senderKey: "sender-key",
        to: "+919876543210",
        templateKey: "template-1",
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/ZOHO_CPAAS_INVALID_ARGUMENT/);
    await expect(
      t.mutation(components.zohoCpaas.whatsapp.sendTemplate, {
        from: "+14155550142",
        to: "+919876543210",
        templateKey: "template-1",
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/ZOHO_CPAAS_INVALID_ARGUMENT/);
  }
  expect(fetchMock).not.toHaveBeenCalled();
  for (const [recipient, channel] of [
    ["to@example.test", "email"],
    ["919876543210", "sms"],
    ["+919876543210", "whatsapp"],
  ] as const) {
    const rows = await t.query(components.zohoCpaas.messages.list, {
      recipient,
      channel,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(rows.page).toHaveLength(0);
  }
});
