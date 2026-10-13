import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { components } from "./_generated/api.js";
import schema from "./schema.js";
import { register } from "@operatornest/convex-zoho-cpaas/test";
import { parseWebhookBody } from "../../src/shared/webhook.js";
import { atOrThrow, createEventTimeFields, drain, signWebhook } from "../../src/test-helpers.js";

const modules = import.meta.glob("./**/*.ts");
const fresh = () => {
  const t = convexTest(schema, modules);
  register(t);
  return t;
};

function payload(eventId: string, name = "open", message: Record<string, unknown> = {}) {
  return JSON.stringify({
    webhook_request_id: eventId,
    event_name: [name],
    event_message: [{ ...createEventTimeFields(Date.now()), ...message }],
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
  const sentIds = await t.mutation(components.zohoCpaas.email.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "callback@example.test" }],
    subject: "Callback retry",
    textbody: "Body",
  });
  const messageId = atOrThrow(sentIds, 0);
  await drain(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("webhookCallbackControl", { key: "webhook", fail: true });
  });
  const body = JSON.stringify({
    webhook_request_id: "callback-retry",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: {
          client_reference: messageId,
          to: [{ email_address: { address: "callback@example.test" } }],
        },
      },
    ],
  });
  expect((await post(t, body)).status).toBe(500);
  expect(await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10))).toHaveLength(0);
  expect(await t.query(components.zohoCpaas.messages.get, { messageId })).toMatchObject({
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
  expect(await t.query(components.zohoCpaas.messages.get, { messageId })).toMatchObject({
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
    event_message: Array.from({ length: 501 }, () => ({
      ...createEventTimeFields(Date.now()),
      email_info: {},
    })),
  });
  const badContent = payload("bad-content", "open", {
    ...createEventTimeFields(Date.now()),
    email_info: {},
  });
  const invalidPayloads: Array<[string, string]> = [
    [missingId, "application/json"],
    [manyEvents, "application/json"],
    [badContent, "text/plain"],
    ["{ broken", "application/json"],
    ["not-json", "application/json"],
    ["null", "application/json"],
  ];
  for (const [body, contentType] of invalidPayloads) {
    expect((await post(t, body, { contentType })).status).toBe(200);
  }
  for (const [body, contentType] of invalidPayloads) {
    const duplicate = await post(t, body, { contentType });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.text()).toBe("OK");
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
      {
        ...createEventTimeFields(Date.now()),
        email_info: { to: [{ email_address: { address: "a+b@example.test" } }] },
      },
      {
        ...createEventTimeFields(Date.now()),
        email_info: { to: [{ email_address: { address: "c@example.test" } }] },
      },
    ],
  });
  let signature = decodeURIComponent(await signWebhook(json));
  for (let index = 0; !signature.includes("+") && index < 100; index++) {
    json = json.replace("array-plus", `array-plus-${index}`);
    signature = decodeURIComponent(await signWebhook(json));
  }
  expect(signature).toContain("+");
  const form = `data=${encodeURIComponent(json).replace(/%20/g, "+")}`;

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
  const body = `\uFEFF  ${payload("concurrent", "open", { ...createEventTimeFields(Date.now()), email_info: {} })}`;
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
  const id = await t.mutation(components.zohoCpaas.email.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "person@example.test" }],
    subject: "Hi",
    textbody: "Body",
  });
  await drain(t);
  const message = await t.query(components.zohoCpaas.messages.get, {
    messageId: atOrThrow(id, 0),
  });
  for (const type of ["open", "click"]) {
    const body = JSON.stringify({
      webhook_request_id: `event-${type}`,
      event_name: [type],
      event_message: [
        {
          ...createEventTimeFields(Date.now()),
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
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(id, 0) }),
  ).toMatchObject({ status: message?.status });
  const complaint = JSON.stringify({
    webhook_request_id: "event-complaint",
    event_name: ["complaint"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: {
          client_reference: atOrThrow(id, 0),
          to: [{ email_address: { address: "person@example.test" } }],
        },
      },
    ],
  });
  expect((await post(t, complaint)).status).toBe(200);
  expect(
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(id, 0) }),
  ).toMatchObject({ status: "complained", testMode: true });
  const events = await t.query(components.zohoCpaas.messages.listEvents, {
    messageId: atOrThrow(id, 0),
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(events.page.every((event) => event.testMode)).toBe(true);
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
  const sentIds = await t.mutation(components.zohoCpaas.email.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "sending-bounce@example.test" }],
    subject: "In flight",
    textbody: "Body",
  });
  const messageId = atOrThrow(sentIds, 0);
  const completing = t.finishAllScheduledFunctions(vi.runAllTimers);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(await t.query(components.zohoCpaas.messages.get, { messageId })).toMatchObject({
    status: "sending",
  });
  const body = JSON.stringify({
    webhook_request_id: "in-flight-bounce",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: {
          client_reference: messageId,
          to: [{ email_address: { address: "sending-bounce@example.test" } }],
        },
      },
    ],
  });
  expect((await post(t, body)).status).toBe(200);
  expect(await t.query(components.zohoCpaas.messages.get, { messageId })).toMatchObject({
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
  expect(await t.query(components.zohoCpaas.messages.get, { messageId })).toMatchObject({
    status: "bounced",
    zohoRequestId: "request-in-flight",
  });
});

test("an explicit recipient conflicting with the envelope never changes the envelope recipient", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.email.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "primary@example.test" }],
    cc: [{ address: "copy@example.test" }],
    subject: "Hi",
    textbody: "Body",
  });
  await drain(t);
  const message = await t.query(components.zohoCpaas.messages.get, {
    messageId: atOrThrow(ids, 0),
  });
  const body = JSON.stringify({
    webhook_request_id: "cc-bounce",
    request_id: message?.zohoRequestId,
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
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
    await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) }),
  ).toMatchObject({ status: "accepted" });
  const suppressions = await t.query(components.zohoCpaas.suppressions.list, {
    channel: "email",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(suppressions.page.map((entry) => entry.address)).not.toContain("primary@example.test");
  expect(suppressions.page.map((entry) => entry.address)).toContain("wrong@example.test");
});

test("a multi-recipient batch envelope event stays unresolved and suppresses no address", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const ids = await t.mutation(components.zohoCpaas.email.sendBatch, {
    from: { address: "sender@example.test" },
    to: [
      { emailAddress: { address: "batch-one@example.test" } },
      { emailAddress: { address: "batch-two@example.test" } },
    ],
    cc: [{ address: "batch-copy@example.test" }],
    subject: "Batch identity",
    textbody: "Body",
  });
  await drain(t);
  const sent = await t.query(components.zohoCpaas.messages.get, { messageId: atOrThrow(ids, 0) });
  const body = JSON.stringify({
    webhook_request_id: "batch-envelope",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: {
          client_reference: sent?.clientReference,
          to: ["batch-one@example.test", "batch-two@example.test"].map((address) => ({
            email_address: { address },
          })),
          cc: [{ email_address: { address: "batch-copy@example.test" } }],
        },
        request_id: sent?.zohoRequestId,
      },
    ],
  });
  expect((await post(t, body)).status).toBe(200);
  for (const messageId of ids)
    expect(await t.query(components.zohoCpaas.messages.get, { messageId })).toMatchObject({
      status: "accepted",
    });
  expect(
    await t.query(components.zohoCpaas.suppressions.list, {
      channel: "email",
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).toMatchObject({ page: [] });
});

test("payload without email or WhatsApp markers is classified unknown and gets a failed receipt", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const body = payload("unknown-channel", "open", { payload: "opaque" });
  expect(parseWebhookBody(body)?.events[0]?.channel).toBe("unknown");
  expect((await post(t, body)).status).toBe(200);
  expect(await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10))).toHaveLength(0);
});

test("an undated WhatsApp delivery is acknowledged without reaching callback consumers", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const body = JSON.stringify({
    webhook_request_id: "undated-wa",
    event_name: ["delivered"],
    event_message: [{ to: "+919876543210", message_id: "provider-message-1" }],
  });
  expect(parseWebhookBody(body)?.events[0]).toMatchObject({
    channel: "whatsapp",
    recipient: "+919876543210",
    occurredAt: undefined,
  });
  expect((await post(t, body)).status).toBe(200);
  expect(await t.run(async (ctx) => ctx.db.query("webhookEvents").take(10))).toEqual([]);
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
