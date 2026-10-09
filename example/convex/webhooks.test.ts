import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { components } from "./_generated/api.js";
import schema from "./schema.js";
import { register } from "@operatornest/convex-zoho-cpaas/test";
import { parseWebhookBody } from "../../src/shared/webhook.js";
import { atOrThrow, signWebhook } from "../../src/test-helpers.js";

const modules = import.meta.glob("./**/*.ts");
const fresh = () => {
  const t = convexTest(schema, modules);
  register(t);
  return t;
};

function payload(eventId: string, name = "open", message: unknown = {}) {
  return JSON.stringify({
    webhook_request_id: eventId,
    event_name: [name],
    event_message: [message],
  });
}

async function post(
  t: ReturnType<typeof fresh>,
  body: string,
  options: {
    contentType?: string;
    signature?: string;
  } = {},
) {
  return t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      "producer-signature": options.signature ?? (await signWebhook(body)),
    },
    body,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("callback failure rolls back receipt and event, then provider redelivery commits", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const sentIds = await t.mutation(components.zohoCpaas.messages.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "callback@example.test" }],
    subject: "Callback retry",
    text: "Body",
  });
  const messageId = atOrThrow(sentIds, 0);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.run(async (ctx) => {
    await ctx.db.insert("webhookCallbackControl", { key: "webhook", fail: true });
  });
  const body = JSON.stringify({
    webhook_request_id: "callback-retry",
    event_name: ["hardbounce"],
    event_message: [
      {
        email_info: {
          client_reference: messageId,
          to: [{ email_address: { address: "callback@example.test" } }],
        },
      },
    ],
  });
  expect((await post(t, body)).status).toBe(500);
  expect(await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10))).toHaveLength(0);
  expect(await t.query(components.zohoCpaas.messages.getMessage, { messageId })).toMatchObject({
    status: "accepted",
  });
  expect(
    (
      await t.query(components.zohoCpaas.suppressions.list, {
        channel: "email",
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).page,
  ).toHaveLength(0);
  await t.run(async (ctx) => {
    const control = await ctx.db
      .query("webhookCallbackControl")
      .withIndex("by_key", (q) => q.eq("key", "webhook"))
      .unique();
    if (control) await ctx.db.patch("webhookCallbackControl", control._id, { fail: false });
  });
  expect((await post(t, body)).status).toBe(200);
  expect(await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10))).toHaveLength(1);
  expect(await t.query(components.zohoCpaas.messages.getMessage, { messageId })).toMatchObject({
    status: "bounced",
  });
  expect(
    (
      await t.query(components.zohoCpaas.suppressions.list, {
        channel: "email",
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).page,
  ).toMatchObject([{ address: "callback@example.test" }]);
});

test("verified malformed, unsupported, and over-event-limit bodies get hashed failed receipts", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const missingId = JSON.stringify({ event_name: ["open"], event_message: [{}] });
  const manyEvents = JSON.stringify({
    webhook_request_id: "too-many",
    event_name: Array(501).fill("open"),
    event_message: Array.from({ length: 501 }, () => ({ email_info: {} })),
  });
  const badContent = payload("bad-content", "open", { email_info: {} });
  const invalidPayloads: Array<[string, string]> = [
    [missingId, "application/json"],
    [manyEvents, "application/json"],
    [badContent, "text/plain"],
    ["{ broken", "application/json"],
    ["not-json", "application/json"],
    ["null", "application/json"],
  ];
  for (const [body, contentType] of invalidPayloads) {
    // Keep invalid receipt creation sequential so each repeated body tests dedupe.
    expect((await post(t, body, { contentType })).status).toBe(200);
  }
  for (const [body, contentType] of invalidPayloads) {
    const duplicate = await post(t, body, { contentType });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.text()).toBe("Duplicate");
  }
});

test("invalid signatures return 401 while missing secrets return 500", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", undefined);
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS", undefined);
  const t = fresh();
  const body = payload("signature-status");
  expect((await post(t, body, { signature: "broken" })).status).toBe(500);
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  expect((await post(t, body, { signature: "broken" })).status).toBe(401);
});

test("content-length guard caps webhook reads with 413", async () => {
  const t = fresh();
  const body = "x".repeat(512 * 1024 + 1);
  const response = await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
    },
    body,
  });
  expect(response.status).toBe(413);
  const streamInit: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(512 * 1024));
        controller.enqueue(new Uint8Array(2));
        controller.close();
      },
    }),
    // Fetch requires this marker when a streaming request body has no known length.
    duplex: "half",
  };
  const streamResponse = await t.fetch("/zoho-cpaas/webhook", streamInit);
  expect(streamResponse.status).toBe(413);
});

test("arrays are recorded as separate events and signed form and JSON decoding preserve plus", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  let json = JSON.stringify({
    webhook_request_id: "array-plus",
    marker: "raw space + encoded %2B",
    event_name: ["open", "click"],
    event_message: [
      { email_info: { to: [{ email_address: { address: "a+b@example.test" } }] } },
      { email_info: { to: [{ email_address: { address: "c@example.test" } }] } },
    ],
  });
  let signature = decodeURIComponent(await signWebhook(json));
  for (let index = 0; !signature.includes("+") && index < 100; index++) {
    json = json.replace("array-plus", `array-plus-${index}`);
    signature = decodeURIComponent(await signWebhook(json));
  }
  expect(signature).toContain("+");
  const form = `data=${encodeURIComponent(json).replace(/%20/g, "+")}`;
  // Base64 signatures may contain '+'. A literal plus in this header remains a plus.
  const literalPlus = signature.replace(/%2B/gi, "+");
  expect(
    (
      await post(t, form, {
        contentType: "application/x-www-form-urlencoded",
        signature: literalPlus,
      })
    ).status,
  ).toBe(200);
  const events = await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10));
  expect(events.map((event) => event.type)).toEqual(["open", "click"]);
  expect(events[0]?.recipient).toBe("a+b@example.test");
});

test("BOM and leading whitespace JSON verifies; concurrent duplicate deliveries commit once", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const body = `\uFEFF  ${payload("concurrent", "open", { email_info: {} })}`;
  const signature = await signWebhook(body);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => post(t, body, { signature })),
  );
  expect(responses.map((response) => response.status)).toEqual(Array(8).fill(200));
  expect(await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10))).toHaveLength(1);
});

test("open and click preserve message status while complaints suppress and mark complained", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const id = await t.mutation(components.zohoCpaas.messages.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "person@example.test" }],
    subject: "Hi",
    text: "Body",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const message = await t.query(components.zohoCpaas.messages.getMessage, {
    messageId: atOrThrow(id, 0),
  });
  for (const type of ["open", "click"]) {
    const body = JSON.stringify({
      webhook_request_id: `event-${type}`,
      event_name: [type],
      event_message: [
        {
          email_info: {
            client_reference: atOrThrow(id, 0),
            to: [{ email_address: { address: "person@example.test" } }],
          },
        },
      ],
    });
    expect((await post(t, body)).status).toBe(200);
  }
  expect(
    await t.query(components.zohoCpaas.messages.getMessage, { messageId: atOrThrow(id, 0) }),
  ).toMatchObject({ status: message?.status });
  const complaint = JSON.stringify({
    webhook_request_id: "event-complaint",
    event_name: ["complaint"],
    event_message: [
      {
        email_info: {
          client_reference: atOrThrow(id, 0),
          to: [{ email_address: { address: "person@example.test" } }],
        },
      },
    ],
  });
  expect((await post(t, complaint)).status).toBe(200);
  expect(
    await t.query(components.zohoCpaas.messages.getMessage, { messageId: atOrThrow(id, 0) }),
  ).toMatchObject({ status: "complained", testMode: true });
  const events = await t.query(components.zohoCpaas.messages.listEvents, {
    messageId: atOrThrow(id, 0),
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(events.page.every((event) => event.testMode === true)).toBe(true);
});

test("bounce received while the provider request is sending survives later accepted completion", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "review-token");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  let resolveProvider: ((response: Response) => void) | undefined;
  const providerResponse = new Promise<Response>((resolve) => {
    resolveProvider = resolve;
  });
  const fetchMock = vi.fn(() => providerResponse);
  vi.stubGlobal("fetch", fetchMock);
  const t = fresh();
  const sentIds = await t.mutation(components.zohoCpaas.messages.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "sending-bounce@example.test" }],
    subject: "In flight",
    text: "Body",
  });
  const messageId = atOrThrow(sentIds, 0);
  const completing = t.finishAllScheduledFunctions(vi.runAllTimers);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(await t.query(components.zohoCpaas.messages.getMessage, { messageId })).toMatchObject({
    status: "sending",
  });
  const body = JSON.stringify({
    webhook_request_id: "in-flight-bounce",
    event_name: ["hardbounce"],
    event_message: [
      {
        email_info: {
          client_reference: messageId,
          to: [{ email_address: { address: "sending-bounce@example.test" } }],
        },
      },
    ],
  });
  expect((await post(t, body)).status).toBe(200);
  expect(await t.query(components.zohoCpaas.messages.getMessage, { messageId })).toMatchObject({
    status: "bounced",
  });
  if (resolveProvider === undefined) throw new Error("Provider request was not started");
  resolveProvider(
    new Response(
      JSON.stringify({
        data: [{ code: "EM_104", additional_info: [], message: "OK" }],
        request_id: "request-in-flight",
      }),
      { status: 200 },
    ),
  );
  await completing;
  expect(await t.query(components.zohoCpaas.messages.getMessage, { messageId })).toMatchObject({
    status: "bounced",
    providerRequestId: "request-in-flight",
  });
});

test("provider request and envelope addresses resolve a unique cc or bcc message row", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.messages.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "primary@example.test" }],
    cc: [{ address: "copy@example.test" }],
    subject: "Hi",
    text: "Body",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const message = await t.query(components.zohoCpaas.messages.getMessage, {
    messageId: atOrThrow(ids, 0),
  });
  const body = JSON.stringify({
    webhook_request_id: "cc-bounce",
    request_id: message?.providerRequestId,
    event_name: ["hardbounce"],
    event_message: [
      {
        email_info: {
          to: [{ email_address: { address: "external@example.test" } }],
          cc: [{ email_address: { address: "primary@example.test" } }],
        },
        recipient: "wrong@example.test",
      },
    ],
  });
  expect((await post(t, body)).status).toBe(200);
  expect(
    await t.query(components.zohoCpaas.messages.getMessage, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({ status: "bounced" });
  const suppressions = await t.query(components.zohoCpaas.suppressions.list, {
    channel: "email",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(suppressions.page.map((entry) => entry.address)).toContain("primary@example.test");
  expect(suppressions.page.map((entry) => entry.address)).not.toContain("wrong@example.test");
});

test("unique client reference resolves a multi-recipient batch envelope", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.messages.sendBatch, {
    from: { address: "sender@example.test" },
    to: [
      { emailAddress: { address: "batch-one@example.test" } },
      { emailAddress: { address: "batch-two@example.test" } },
    ],
    cc: [{ address: "batch-copy@example.test" }],
    bcc: [{ address: "batch-archive@example.test" }],
    subject: "Batch identity",
    text: "Body",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const envelope = {
    to: ["batch-one@example.test", "batch-two@example.test"].map((address) => ({
      email_address: { address },
    })),
    cc: [{ email_address: { address: "batch-copy@example.test" } }],
    bcc: [{ email_address: { address: "batch-archive@example.test" } }],
  };
  for (const [eventId, type, targetId] of [
    ["batch-hardbounce", "hardbounce", atOrThrow(ids, 1)],
    ["batch-complaint", "complaint", ids[2]],
  ] as const) {
    const body = JSON.stringify({
      webhook_request_id: eventId,
      event_name: [type],
      event_message: [
        {
          email_info: { ...envelope, client_reference: targetId },
        },
      ],
    });
    // Keep each signed delivery sequential so the expected row state is observable.
    expect((await post(t, body)).status).toBe(200);
  }
  expect(
    await t.query(components.zohoCpaas.messages.getMessage, { messageId: atOrThrow(ids, 1) }),
  ).toMatchObject({
    status: "bounced",
  });
  expect(
    await t.query(components.zohoCpaas.messages.getMessage, { messageId: atOrThrow(ids, 2) }),
  ).toMatchObject({
    status: "complained",
  });
  expect(
    await t.query(components.zohoCpaas.messages.getMessage, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({
    status: "accepted",
  });
  const suppressions = await t.query(components.zohoCpaas.suppressions.list, {
    channel: "email",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(suppressions.page.map((entry) => entry.address)).toEqual(
    expect.arrayContaining(["batch-two@example.test", "batch-copy@example.test"]),
  );
  expect(suppressions.page.map((entry) => entry.address)).not.toContain("batch-one@example.test");
});

test("payload without email or WhatsApp markers is classified unknown and gets a failed receipt", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const body = payload("unknown-channel", "open", { payload: "opaque" });
  expect(parseWebhookBody(body)?.events[0]?.channel).toBe("unknown");
  expect((await post(t, body)).status).toBe(200);
  expect(await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10))).toHaveLength(0);
});

test("unmatched WhatsApp delivery remains a typed event for callback consumers", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const body = payload("unmatched-wa", "delivered", {
    to: "+919876543210",
    message_id: "provider-message-1",
  });
  expect(parseWebhookBody(body)?.events[0]?.channel).toBe("whatsapp");
  expect((await post(t, body)).status).toBe(200);
  const callbackEvents = await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10));
  expect(callbackEvents[0]).toMatchObject({
    type: "delivered",
    channel: "whatsapp",
    recipient: "+919876543210",
  });
});

test("route rejects invalid length, oversized bodies, undecodable bytes, and unsigned requests", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const body = payload("route-boundaries");
  const invalidLength = await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: { "content-length": "not-a-number" },
    body,
  });
  expect(invalidLength.status).toBe(400);
  const tooLarge = await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    headers: { "content-length": String(512 * 1024 + 1) },
    body,
  });
  expect(tooLarge.status).toBe(413);
  const undecodable = await t.fetch("/zoho-cpaas/webhook", {
    method: "POST",
    body: new Uint8Array([0xff, 0xfe]),
  });
  expect(undecodable.status).toBe(400);
  const unsigned = await t.fetch("/zoho-cpaas/webhook", { method: "POST", body });
  expect(unsigned.status).toBe(401);
});
