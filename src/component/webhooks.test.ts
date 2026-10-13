import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { internal } from "./_generated/api.js";
import { commit } from "./webhooks.js";
import type { Doc } from "./_generated/dataModel.js";
import { atOrThrow, drain, expectZohoCpaasError } from "../test-helpers.js";

import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { createEventTimeFields, signWebhook } from "../test-helpers.js";
import schema from "./schema.js";
import { reconcileRequestEvents } from "./webhooks.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("events received before send completion reconcile by recipient, client reference and provider ID", async () => {
  const t = convexTest(schema, modules);
  const fixtures = await t.run(async (ctx) => {
    const messageIds = [];
    for (const [to, reference, zohoMessageId] of [
      ["a@example.test", "ref-a", "provider-a"],
      ["b@example.test", "ref-b", "provider-b"],
      ["c@example.test", "ref-c", "provider-c"],
    ]) {
      if (to === undefined || reference === undefined || zohoMessageId === undefined)
        throw new Error("Missing message fixture field");
      const id = await ctx.db.insert("messages", {
        testMode: false,
        channel: "email",
        to,
        from: "sender@example.test",
        status: "accepted",
        clientReference: reference,
        zohoMessageId,
        zohoRequestId: "request-1",
        attempts: 1,
        region: "us",
        createdAt: 1,
      });
      messageIds.push(id);
    }
    const eventIds = [];
    for (const [suffix, fields] of [
      ["recipient", { recipient: " A@EXAMPLE.TEST " }],
      ["reference", { clientReference: "ref-b" }],
      ["provider", { zohoMessageId: "provider-c" }],
    ] as const) {
      eventIds.push(
        await ctx.db.insert("events", {
          testMode: false,
          channel: "email",
          type: "hardbounce",
          occurredAt: 2,
          receivedAt: 2,
          zohoEventId: `event-${suffix}`,
          zohoRequestId: "request-1",
          raw: JSON.stringify({ event_message: { email_info: {} } }),
          ...fields,
        }),
      );
    }
    await reconcileRequestEvents(ctx, "request-1", messageIds);
    return { eventIds, messageIds };
  });
  for (let index = 0; index < fixtures.eventIds.length; index++) {
    const eventId = fixtures.eventIds.at(index);
    const messageId = fixtures.messageIds.at(index);
    if (eventId === undefined || messageId === undefined)
      throw new Error("Missing reconciliation fixture");
    const event = await t.run((ctx) => ctx.db.get("events", eventId));
    expect(event).toMatchObject({ messageId, ambiguous: false });
    expect(await t.run((ctx) => ctx.db.get("messages", messageId))).toMatchObject({
      status: "bounced",
    });
  }
});

test("reconciliation keeps a live message's test mode when env test mode is on", async () => {
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  const t = convexTest(schema, modules);
  const linked = await t.run(async (ctx) => {
    const messageId = await ctx.db.insert("messages", {
      testMode: false,
      channel: "email",
      to: "live@example.test",
      from: "sender@example.test",
      status: "accepted",
      clientReference: "ref-live",
      zohoRequestId: "request-live",
      attempts: 1,
      region: "us",
      createdAt: 1,
    });
    const eventId = await ctx.db.insert("events", {
      testMode: true,
      channel: "email",
      type: "hardbounce",
      occurredAt: 2,
      receivedAt: 2,
      zohoEventId: "event-live",
      zohoRequestId: "request-live",
      recipient: "live@example.test",
      raw: JSON.stringify({ event_message: { email_info: {} } }),
    });
    await reconcileRequestEvents(ctx, "request-live", [messageId]);
    return { eventId, messageId };
  });
  expect(await t.run((ctx) => ctx.db.get("events", linked.eventId))).toMatchObject({
    messageId: linked.messageId,
    testMode: false,
  });
  expect(await t.run((ctx) => ctx.db.query("suppressions").take(2))).toMatchObject([
    { address: "live@example.test", testMode: false },
  ]);
});

test("reconciliation leaves ambiguous, malformed-recipient and already linked events unresolved", async () => {
  const t = convexTest(schema, modules);
  const fixtures = await t.run(async (ctx) => {
    const messageId = await ctx.db.insert("messages", {
      testMode: false,
      channel: "email",
      to: "first@example.test",
      from: "sender@example.test",
      status: "accepted",
      clientReference: "shared",
      attempts: 1,
      region: "us",
      createdAt: 1,
    });
    const secondId = await ctx.db.insert("messages", {
      testMode: false,
      channel: "email",
      to: "second@example.test",
      from: "sender@example.test",
      status: "accepted",
      clientReference: "shared",
      attempts: 1,
      region: "us",
      createdAt: 1,
    });
    const ambiguousId = await ctx.db.insert("events", {
      testMode: false,
      channel: "email",
      type: "complaint",
      occurredAt: 2,
      receivedAt: 2,
      zohoEventId: "ambiguous",
      zohoRequestId: "request-2",
      clientReference: "shared",
      raw: "not-json",
    });
    const invalidId = await ctx.db.insert("events", {
      testMode: false,
      channel: "email",
      type: "hardbounce",
      occurredAt: 2,
      receivedAt: 2,
      zohoEventId: "invalid-recipient",
      zohoRequestId: "request-2",
      recipient: "not-an-email",
      raw: "{}",
    });
    const linkedId = await ctx.db.insert("events", {
      testMode: false,
      messageId,
      channel: "email",
      type: "open",
      occurredAt: 2,
      receivedAt: 2,
      zohoEventId: "already-linked",
      zohoRequestId: "request-2",
      raw: "{}",
    });
    await reconcileRequestEvents(ctx, "request-2", [messageId, secondId]);
    return { ambiguousId, invalidId, linkedId, messageId };
  });
  expect(await t.run((ctx) => ctx.db.get("events", fixtures.ambiguousId))).toMatchObject({
    ambiguous: true,
  });
  expect(await t.run((ctx) => ctx.db.get("events", fixtures.invalidId))).not.toHaveProperty(
    "messageId",
  );
  expect(await t.run((ctx) => ctx.db.get("events", fixtures.linkedId))).toMatchObject({
    messageId: fixtures.messageId,
  });
});

test("receive verifies signatures and only committed bodies deduplicate", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = convexTest(schema, modules);
  const body = "{broken";
  const signature = await signWebhook(body);
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: body,
      contentType: "application/json",
      signature: "invalid",
    }),
  ).toMatchObject({ reason: "invalid_signature" });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: body,
      contentType: "application/json",
      signature,
    }),
  ).toMatchObject({ reason: "invalid_payload" });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: body,
      contentType: "application/json",
      signature,
    }),
  ).toMatchObject({ reason: "invalid_payload" });
  const wrongContent = JSON.stringify({
    webhook_request_id: "wrong-content",
    event_name: ["open"],
    event_message: [{}],
  });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: wrongContent,
      contentType: "text/plain",
      signature: await signWebhook(wrongContent),
    }),
  ).toMatchObject({ reason: "invalid_payload" });
  const valid = JSON.stringify({
    webhook_request_id: "valid-direct",
    event_name: ["open"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: { to: [{ email_address: { address: "valid@example.test" } }] },
      },
    ],
  });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: valid,
      contentType: "application/json",
      signature: await signWebhook(valid),
    }),
  ).toMatchObject({ reason: "accepted" });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: valid,
      contentType: "application/json",
      signature: await signWebhook(valid),
    }),
  ).toMatchObject({ reason: "duplicate" });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: "x".repeat(512 * 1024 + 1),
      contentType: "application/json",
    }),
  ).toMatchObject({ reason: "oversized_body" });
});

const createComponentTest = () => {
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  return t;
};
const storedMessage = (fields: Partial<Doc<"messages">> = {}) => ({
  testMode: false,
  channel: "email" as const,
  to: "a@example.test",
  from: "sender@example.test",
  status: "accepted" as const,
  clientReference: "shared",
  attempts: 1,
  region: "us",
  createdAt: 1,
  ...fields,
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("client reference matches a unique recipient beyond 501 older recipients", async () => {
  const t = createComponentTest();
  const messageId = await t.run(async (ctx) => {
    for (let i = 0; i < 501; i++)
      await ctx.db.insert("messages", storedMessage({ to: `old${i}@example.test` }));
    return ctx.db.insert("messages", storedMessage());
  });
  await t.mutation(internal.webhooks.commit, {
    zohoEventId: "bounce",
    bodyHash: "hash",
    events: [
      {
        zohoEventId: "bounce",
        channel: "email",
        type: "hardbounce",
        occurredAt: 2,
        clientReference: "shared",
        recipient: "a@example.test",
        raw: {},
      },
    ],
  });
  expect(await t.query(api.messages.get, { messageId })).toMatchObject({
    status: "bounced",
  });
});

test("reconciliation never assigns an explicit conflicting recipient", async () => {
  const t = createComponentTest();
  const messageId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("messages", storedMessage({ zohoRequestId: "request" }));
    await ctx.db.insert("events", {
      testMode: false,
      channel: "email",
      type: "hardbounce",
      occurredAt: 2,
      receivedAt: 2,
      zohoEventId: "bounce",
      zohoRequestId: "request",
      clientReference: "shared",
      recipient: "other@example.test",
      raw: "{}",
    });
    await reconcileRequestEvents(ctx, "request", [id]);
    return id;
  });
  expect(await t.query(api.messages.get, { messageId })).toMatchObject({
    status: "accepted",
  });
  expect(
    await t.query(api.suppressions.list, {
      channel: "email",
      paginationOpts: { cursor: null, numItems: 10 },
    }),
  ).toMatchObject({ page: [] });
});

test("reconciliation continues past 500 early events", async () => {
  vi.useFakeTimers();
  const t = createComponentTest();
  const messageId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("messages", storedMessage({ zohoRequestId: "request" }));
    for (let i = 0; i < 501; i++)
      await ctx.db.insert("events", {
        testMode: false,
        channel: "email",
        type: i === 500 ? "hardbounce" : "open",
        occurredAt: 2,
        receivedAt: 2,
        zohoEventId: `event${i}`,
        zohoRequestId: "request",
        recipient: "a@example.test",
        raw: "{}",
      });
    await reconcileRequestEvents(ctx, "request", [id]);
    return id;
  });
  await drain(t);
  expect(await t.query(api.messages.get, { messageId })).toMatchObject({
    status: "bounced",
  });
});

test("a 65-event receipt reads at most two shared-reference candidates", async () => {
  const t = createComponentTest();
  await t.run(async (ctx) => {
    for (let i = 0; i < 500; i++)
      await ctx.db.insert("messages", storedMessage({ to: `r${i}@example.test` }));
  });
  let messageReads = 0;
  await t.run(async (ctx) => {
    const query = ctx.db.query.bind(ctx.db);
    const db = new Proxy(ctx.db, {
      get(target, property) {
        if (property !== "query") return Reflect.get(target, property);
        return (table: "messages") => {
          const original = query(table);
          return new Proxy(original, {
            get(queryTarget, queryProperty) {
              if (queryProperty !== "withIndex") return Reflect.get(queryTarget, queryProperty);
              return (...args: unknown[]) => {
                const indexed = Reflect.apply(queryTarget.withIndex, queryTarget, args);
                return new Proxy(indexed, {
                  get(indexedTarget, indexedProperty) {
                    if (indexedProperty !== "take")
                      return Reflect.get(indexedTarget, indexedProperty);
                    return async (count: number) => {
                      const rows = await indexedTarget.take(count);
                      if (table === "messages") messageReads += rows.length;
                      return rows;
                    };
                  },
                });
              };
            },
          });
        };
      },
    });
    const handler = Reflect.get(commit, "_handler");
    await handler(
      { ...ctx, db },
      {
        zohoEventId: "many",
        bodyHash: "hash-many",
        events: Array.from({ length: 65 }, (_, i) => ({
          zohoEventId: "many",
          channel: "email",
          type: "open",
          occurredAt: i,
          clientReference: "shared",
          raw: {},
        })),
      },
    );
  });
  expect(messageReads).toBeLessThanOrEqual(2);
});

test("an expired receipt cannot be replayed by replacing the unsigned timestamp", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  vi.stubEnv("ZOHO_CPAAS_RETENTION_DAYS", "1");
  const t = createComponentTest();
  const body = JSON.stringify({
    webhook_request_id: "replayed",
    event_name: ["open"],
    event_message: [{ ...createEventTimeFields(Date.now()), email_info: {} }],
  });
  const signature = await signWebhook(body);
  const receive = (header: string) =>
    t.action(api.webhooks.receive, {
      rawBody: body,
      contentType: "application/json",
      signature: header,
    });
  expect(await receive(signature)).toMatchObject({ reason: "accepted" });
  vi.setSystemTime(Date.now() + 31 * 86_400_000);
  await t.mutation(internal.cleanup.run, {});
  expect(await t.run((ctx) => ctx.db.query("webhookReceipts").take(1))).toEqual([]);
  expect(await receive(signature.replace(/^ts=\d+/, `ts=${Date.now()}`))).toEqual({
    reason: "stale_event",
  });
  expect(await t.run((ctx) => ctx.db.query("webhookReceipts").take(2))).toMatchObject([
    { reason: "stale_event" },
  ]);
  expect(await t.run((ctx) => ctx.db.query("events").take(1))).toEqual([]);
});

test("an invalid content type cannot block a valid delivery of the same signed body", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = createComponentTest();
  const rawBody = JSON.stringify({
    webhook_request_id: "redelivered",
    event_name: ["open"],
    event_message: [{ ...createEventTimeFields(Date.now()), email_info: {} }],
  });
  const signature = await signWebhook(rawBody);
  expect(
    await t.action(api.webhooks.receive, { rawBody, signature, contentType: "text/plain" }),
  ).toEqual({ reason: "invalid_payload" });
  expect(
    await t.action(api.webhooks.receive, { rawBody, signature, contentType: "application/json" }),
  ).toEqual({ reason: "accepted" });
  expect(await t.run((ctx) => ctx.db.query("events").take(2))).toHaveLength(1);
  expect(
    await t.action(api.webhooks.receive, { rawBody, signature, contentType: "application/json" }),
  ).toEqual({ reason: "duplicate" });
});

test.each(["1", "60"])(
  "signed event freshness uses receipt retention minus one day for retention=%s",
  async (retention) => {
    vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
    vi.stubEnv("ZOHO_CPAAS_RETENTION_DAYS", retention);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
    const t = createComponentTest();
    const cutoff = Date.now() - (retention === "60" ? 59 : 29) * 86_400_000;
    for (const [suffix, times, reason] of [
      ["boundary", [cutoff], "accepted"],
      ["mixed", [Date.now(), cutoff - 1], "accepted"],
      ["expired", [cutoff - 1], "stale_event"],
    ] as const) {
      const rawBody = JSON.stringify({
        webhook_request_id: suffix,
        event_name: ["open"],
        event_message: times.map((time) =>
          Object.assign(createEventTimeFields(time), { email_info: {} }),
        ),
      });
      expect(
        await t.action(api.webhooks.receive, {
          rawBody,
          contentType: "application/json",
          signature: await signWebhook(rawBody),
        }),
      ).toEqual({ reason });
    }
    expect(
      (await t.run((ctx) => ctx.db.query("webhookReceipts").take(4))).map(
        (receipt) => receipt.reason,
      ),
    ).toEqual([undefined, undefined, "stale_event"]);
    expect(await t.run((ctx) => ctx.db.query("events").take(3))).toHaveLength(2);
  },
);

test("a signed event without a body timestamp is rejected as stale with one failed receipt", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = createComponentTest();
  const rawBody = JSON.stringify({
    webhook_request_id: "missing-time",
    event_name: ["open"],
    event_message: [{ email_info: {} }],
  });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody,
      contentType: "application/json",
      signature: await signWebhook(rawBody),
    }),
  ).toEqual({ reason: "stale_event" });
  expect(await t.run((ctx) => ctx.db.query("webhookReceipts").take(2))).toMatchObject([
    { reason: "stale_event" },
  ]);
});

test("a future signed event is rejected as stale with one failed receipt", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = createComponentTest();
  const rawBody = JSON.stringify({
    webhook_request_id: "future-time",
    event_name: ["open"],
    event_message: [{ ...createEventTimeFields(Date.now() + 86_400_000), email_info: {} }],
  });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody,
      contentType: "application/json",
      signature: await signWebhook(rawBody),
    }),
  ).toEqual({ reason: "stale_event" });
  expect(await t.run((ctx) => ctx.db.query("webhookReceipts").take(2))).toMatchObject([
    { reason: "stale_event" },
  ]);
});

test("a signed body applies its fresh bounce and skips its untimed event", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = createComponentTest();
  const rawBody = JSON.stringify({
    webhook_request_id: "mixed-time",
    event_name: ["hardbounce"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: { to: [{ email_address: { address: "fresh@example.test" } }] },
      },
      { email_info: { to: [{ email_address: { address: "untimed@example.test" } }] } },
    ],
  });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody,
      contentType: "application/json",
      signature: await signWebhook(rawBody),
    }),
  ).toEqual({ reason: "accepted" });
  expect(
    (await t.run((ctx) => ctx.db.query("suppressions").take(3))).map((row) => row.address),
  ).toEqual(["fresh@example.test"]);
  expect(await t.run((ctx) => ctx.db.query("events").take(3))).toHaveLength(1);
});

test.each([false, true])(
  "a signed WhatsApp body with email timestamp fields=%s is stale and changes no message",
  async (dated) => {
    vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
    const t = createComponentTest();
    const messageId = await t.run((ctx) =>
      ctx.db.insert(
        "messages",
        storedMessage({
          channel: "whatsapp",
          to: "+919876543210",
          status: "unknown",
          zohoMessageId: "wa-1",
        }),
      ),
    );
    const rawBody = JSON.stringify({
      webhook_request_id: "whatsapp-undated",
      event_name: ["delivered"],
      event_message: [
        {
          channel: "whatsapp",
          to: "+919876543210",
          message_id: "wa-1",
          ...(dated ? createEventTimeFields(Date.now()) : {}),
        },
      ],
    });
    const receive = async () =>
      t.action(api.webhooks.receive, {
        rawBody,
        contentType: "application/json",
        signature: await signWebhook(rawBody),
      });
    expect(await receive()).toEqual({ reason: "stale_event" });
    expect(await receive()).toEqual({ reason: "stale_event" });
    expect(await t.run((ctx) => ctx.db.query("webhookReceipts").take(3))).toMatchObject([
      { reason: "stale_event" },
    ]);
    expect(await t.run((ctx) => ctx.db.query("events").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get("messages", messageId))).toMatchObject({
      status: "unknown",
    });
  },
);

test("a late WhatsApp undelivered event cannot overwrite delivered, and read cannot regress", async () => {
  const t = createComponentTest();
  const messageId = await t.run((ctx) =>
    ctx.db.insert(
      "messages",
      storedMessage({ channel: "whatsapp", to: "+919876543210", zohoMessageId: "wa-1" }),
    ),
  );
  const commitEvent = (type: "delivered" | "read" | "undelivered", zohoEventId: string) =>
    t.mutation(internal.webhooks.commit, {
      zohoEventId,
      bodyHash: zohoEventId,
      events: [
        {
          zohoEventId,
          channel: "whatsapp",
          type,
          occurredAt: 1,
          recipient: "+919876543210",
          zohoMessageId: "wa-1",
          raw: {},
        },
      ],
    });
  const status = async () => (await t.query(api.messages.get, { messageId }))?.status;
  await commitEvent("delivered", "wa-delivered");
  expect(await status()).toBe("delivered");
  await commitEvent("undelivered", "wa-undelivered");
  expect(await status()).toBe("delivered");
  await commitEvent("read", "wa-read");
  await commitEvent("delivered", "wa-delivered-late");
  expect(await status()).toBe("read");
});

test("events in one body match identifiers written by earlier events", async () => {
  const t = createComponentTest();
  const messageId = await t.run((ctx) => ctx.db.insert("messages", storedMessage()));
  await t.mutation(internal.webhooks.commit, {
    zohoEventId: "identifiers",
    bodyHash: "identifiers-hash",
    events: [
      {
        zohoEventId: "identifiers",
        channel: "email",
        type: "open",
        occurredAt: 1,
        clientReference: "shared",
        recipient: "a@example.test",
        zohoRequestId: "request-a",
        raw: {},
      },
      {
        zohoEventId: "identifiers",
        channel: "email",
        type: "hardbounce",
        occurredAt: 2,
        clientReference: "shared",
        recipient: "a@example.test",
        zohoRequestId: "request-b",
        raw: { conflict: true },
      },
      {
        zohoEventId: "identifiers",
        channel: "email",
        type: "click",
        occurredAt: 3,
        recipient: "a@example.test",
        zohoRequestId: "request-a",
        raw: {},
      },
    ],
  });
  expect(await t.query(api.messages.get, { messageId })).toMatchObject({
    status: "accepted",
    zohoRequestId: "request-a",
  });
  const events = await t.run((ctx) => ctx.db.query("events").take(3));
  expect(atOrThrow(events, 0).messageId).toBe(messageId);
  expect(atOrThrow(events, 1).messageId).toBeUndefined();
  expect(atOrThrow(events, 2).messageId).toBe(messageId);
});

test("a newly shared provider identifier invalidates a cached unique match", async () => {
  const t = createComponentTest();
  const otherId = await t.run(async (ctx) => {
    await ctx.db.insert("messages", storedMessage());
    return ctx.db.insert(
      "messages",
      storedMessage({ clientReference: "other", zohoRequestId: "shared-request" }),
    );
  });
  await t.mutation(internal.webhooks.commit, {
    zohoEventId: "shared-identifier",
    bodyHash: "shared-identifier-hash",
    events: [
      {
        zohoEventId: "shared-identifier",
        channel: "email",
        type: "open",
        occurredAt: 1,
        clientReference: "shared",
        recipient: "a@example.test",
        zohoRequestId: "shared-request",
        raw: {},
      },
      {
        zohoEventId: "shared-identifier",
        channel: "email",
        type: "hardbounce",
        occurredAt: 2,
        recipient: "a@example.test",
        zohoRequestId: "shared-request",
        raw: {},
      },
    ],
  });
  expect(await t.query(api.messages.get, { messageId: otherId })).toMatchObject({
    status: "accepted",
  });
  const events = await t.run((ctx) => ctx.db.query("events").take(2));
  expect(atOrThrow(events, 1)).toMatchObject({ ambiguous: true });
  expect(atOrThrow(events, 1).messageId).toBeUndefined();
});

test("a callback handle that is not a function handle rolls the event back", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = convexTest(schema, modules);
  const body = JSON.stringify({
    webhook_request_id: "invalid-handle",
    event_name: ["open"],
    event_message: [
      {
        ...createEventTimeFields(Date.now()),
        email_info: { to: [{ email_address: { address: "valid@example.test" } }] },
      },
    ],
  });
  await expectZohoCpaasError(
    t.action(api.webhooks.receive, {
      rawBody: body,
      contentType: "application/json",
      signature: await signWebhook(body),
      callbackHandle: "not-a-handle",
    }),
    "ZOHO_CPAAS_INVALID_ARGUMENT",
  );
  expect(await t.run((ctx) => ctx.db.query("events").take(1))).toEqual([]);
});
