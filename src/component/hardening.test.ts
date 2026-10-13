import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { commit, reconcileRequestEvents } from "./webhooks.js";
import type { Doc } from "./_generated/dataModel.js";
import { atOrThrow, signWebhook } from "../test-helpers.js";
import { ZohoCpaas, type MutationContext } from "../client/index.js";
import type { ComponentApi } from "./_generated/component.js";
import { send } from "./messages.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const email = {
  from: { address: "sender@example.test" },
  to: [{ address: "a@example.test" }],
  subject: "Subject",
  text: "Body",
  testMode: true,
};
const fresh = () => {
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  return t;
};
const row = (fields: Partial<Doc<"messages">> = {}) => ({
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

test("an attempt excludes recipients suppressed after enqueue", async () => {
  vi.useFakeTimers();
  const t = fresh();
  const ids = await t.mutation(api.messages.send, {
    ...email,
    to: [...email.to, { address: "b@example.test" }],
  });
  const message = await t.query(api.messages.getMessage, { messageId: atOrThrow(ids, 0) });
  if (!message?.jobId) throw new Error("Missing job");
  await t.run((ctx) =>
    ctx.db.insert("suppressions", {
      channel: "email",
      address: "a@example.test",
      reason: "complaint",
      createdAt: 1,
    }),
  );
  expect(
    await t.mutation(internal.sends.begin, { jobId: message.jobId, attempt: 1 }),
  ).toMatchObject({ active: ["b@example.test"] });
  expect(await t.query(api.messages.getMessage, { messageId: atOrThrow(ids, 0) })).toMatchObject({
    status: "suppressed",
  });
});

test.each([false, true])(
  "transport completion preserves a delivered webhook before completion=%s",
  async (early) => {
    vi.useFakeTimers();
    const t = fresh();
    const id = await t.mutation(api.messages.sendWhatsappTemplate, {
      from: "+15550100001",
      to: "+15550100002",
      templateKey: "template",
      testMode: true,
    });
    const message = await t.query(api.messages.getMessage, { messageId: id });
    if (!message?.jobId) throw new Error("Missing job");
    const jobId = message.jobId;
    const job = await t.run((ctx) => ctx.db.get("sendJobs", jobId));
    if (!job?.workId) throw new Error("Missing work");
    await t.mutation(internal.sends.begin, { jobId: job._id, attempt: 1 });
    const deliver = () =>
      t.mutation(internal.webhooks.commit, {
        providerEventId: "delivery",
        bodyHash: "hash",
        events: [
          {
            providerEventId: "delivery",
            channel: "whatsapp",
            type: "delivered",
            occurredAt: 2,
            clientReference: message.clientReference,
            recipient: message.to,
            raw: {},
          },
        ],
      });
    if (early) await deliver();
    await t.mutation(internal.sends.complete, {
      workId: job.workId,
      context: { jobId: job._id, attempt: 1 },
      result: {
        kind: "success",
        returnValue: {
          kind: "failed",
          failureDefinitive: false,
          error: {
            code: "ZOHO_CPAAS_NETWORK_ERROR",
            message: "The send request outcome is unknown.",
          },
        },
      },
    });
    if (!early) {
      expect(await t.query(api.messages.getMessage, { messageId: id })).toMatchObject({
        status: "unknown",
      });
      await deliver();
    }
    expect(await t.query(api.messages.getMessage, { messageId: id })).toMatchObject({
      status: "delivered",
    });
  },
);

test("client reference matches a unique recipient beyond 501 older recipients", async () => {
  const t = fresh();
  const messageId = await t.run(async (ctx) => {
    for (let i = 0; i < 501; i++)
      await ctx.db.insert("messages", row({ to: `old${i}@example.test` }));
    return ctx.db.insert("messages", row());
  });
  await t.mutation(internal.webhooks.commit, {
    providerEventId: "bounce",
    bodyHash: "hash",
    events: [
      {
        providerEventId: "bounce",
        channel: "email",
        type: "hardbounce",
        occurredAt: 2,
        clientReference: "shared",
        recipient: "a@example.test",
        raw: {},
      },
    ],
  });
  expect(await t.query(api.messages.getMessage, { messageId })).toMatchObject({
    status: "bounced",
  });
});

test("reconciliation never assigns an explicit conflicting recipient", async () => {
  const t = fresh();
  const messageId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("messages", row({ providerRequestId: "request" }));
    await ctx.db.insert("events", {
      channel: "email",
      type: "hardbounce",
      occurredAt: 2,
      receivedAt: 2,
      providerEventId: "bounce",
      providerRequestId: "request",
      clientReference: "shared",
      recipient: "other@example.test",
      raw: "{}",
    });
    await reconcileRequestEvents(ctx, "request", [id]);
    return id;
  });
  expect(await t.query(api.messages.getMessage, { messageId })).toMatchObject({
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
  const t = fresh();
  const messageId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("messages", row({ providerRequestId: "request" }));
    for (let i = 0; i < 501; i++)
      await ctx.db.insert("events", {
        channel: "email",
        type: i === 500 ? "hardbounce" : "open",
        occurredAt: 2,
        receivedAt: 2,
        providerEventId: `event${i}`,
        providerRequestId: "request",
        recipient: "a@example.test",
        raw: "{}",
      });
    await reconcileRequestEvents(ctx, "request", [id]);
    return id;
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.messages.getMessage, { messageId })).toMatchObject({
    status: "bounced",
  });
});

test("endCursor cannot expand a message page beyond its server read bound", async () => {
  const t = fresh();
  await t.run(async (ctx) => {
    for (let i = 0; i < 20; i++) await ctx.db.insert("messages", row());
  });
  const result = await t.query(api.messages.listMessages, {
    status: "accepted",
    paginationOpts: { numItems: 1, cursor: null, endCursor: "[]", maximumRowsRead: 10000 },
  });
  expect(result.page.length).toBeLessThanOrEqual(2);
});

test.each(["broken", "{}", "[{}]"])(
  "malformed cursor %s returns the fixed validation error",
  async (cursor) => {
    const t = fresh();
    await expect(
      t.query(api.messages.listMessages, {
        status: "accepted",
        paginationOpts: { numItems: 10, cursor },
      }),
    ).rejects.toMatchObject({
      data: {
        code: "ZOHO_CPAAS_VALIDATION_FAILED",
        message: "An argument is invalid, missing or out of bounds.",
      },
    });
  },
);

test.each(["getMessage", "listEvents", "cancel"])(
  "message method %s rejects malformed IDs with a package error",
  async (method) => {
    const t = fresh();
    const args = { messageId: "not-an-id", paginationOpts: { cursor: null, numItems: 10 } };
    const result =
      method === "getMessage"
        ? t.query(api.messages.getMessage, { messageId: args.messageId })
        : method === "cancel"
          ? t.mutation(api.messages.cancel, { messageId: args.messageId })
          : t.query(api.messages.listEvents, args);
    await expect(result).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
  },
);

test("the client never forwards undeclared testMode", async () => {
  const calls: unknown[] = [];
  const component = {
    messages: { send: "send" },
    files: { uploadFile: "upload" },
  } as unknown as ComponentApi;
  const client = new ZohoCpaas(component);
  const ctx = {
    runMutation: vi.fn(async (_fn: unknown, args: unknown) => {
      calls.push(args);
      return [];
    }),
  } as unknown as MutationContext;
  await client.email.send(ctx, email);
  expect(calls).toEqual([expect.not.objectContaining({ testMode: true })]);
});

test.each(["email", "sms", "whatsapp"])(
  "%s rejects a complete encoded request exceeding 256 KiB",
  async (channel) => {
    vi.useFakeTimers();
    const t = fresh();
    const huge = "\u0001".repeat(180000);
    const result =
      channel === "email"
        ? t.mutation(api.messages.send, { ...email, text: huge })
        : channel === "sms"
          ? t.mutation(api.messages.sendSmsTemplate, {
              senderKey: "sender",
              to: "919876543210",
              templateKey: "template",
              mergeInfo: { huge },
              testMode: true,
            })
          : t.mutation(api.messages.sendWhatsappTemplate, {
              from: "+15550100001",
              to: "+15550100002",
              templateKey: "template",
              mergeInfo: { huge },
              testMode: true,
            });
    await expect(result).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
  },
);

test.each([false, true])(
  "SMS rechecks the India endpoint before sending with testMode=%s",
  async (testMode) => {
    vi.useFakeTimers();
    vi.stubEnv("ZOHO_CPAAS_SMS_TOKEN", "dummy-token");
    vi.stubEnv("ZOHO_CPAAS_REGION", "in");
    const t = fresh();
    const id = await t.mutation(api.messages.sendSmsTemplate, {
      senderKey: "sender",
      to: "919876543210",
      templateKey: "template",
      testMode,
    });
    const message = await t.query(api.messages.getMessage, { messageId: id });
    if (!message?.jobId) throw new Error("Missing job");
    vi.stubEnv("ZOHO_CPAAS_REGION", "us");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await t.action(internal.sends.execute, { jobId: message.jobId, attempt: 1 });
    expect(result).toMatchObject({ kind: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.query(api.messages.getMessage, { messageId: id })).toMatchObject({
      status: "failed",
      error: { code: "ZOHO_CPAAS_UNSUPPORTED_REGION" },
    });
  },
);

test("send rethrows a non-package backend error unchanged", async () => {
  const t = fresh();
  const handler = Reflect.get(send, "_handler");
  const failure = new Error("backend unavailable");
  await expect(
    t.run((ctx) =>
      handler(
        {
          ...ctx,
          db: {
            ...ctx.db,
            insert: () => {
              throw failure;
            },
          },
        },
        email,
      ),
    ),
  ).rejects.toBe(failure);
});

test("a 65-event receipt reads at most two shared-reference candidates", async () => {
  const t = fresh();
  await t.run(async (ctx) => {
    for (let i = 0; i < 500; i++)
      await ctx.db.insert("messages", row({ to: `r${i}@example.test` }));
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
        providerEventId: "many",
        bodyHash: "hash-many",
        events: Array.from({ length: 65 }, (_, i) => ({
          providerEventId: "many",
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

test("canceling an uncertain email stops its retry and permits a later bounce", async () => {
  vi.useFakeTimers();
  const t = fresh();
  const ids = await t.mutation(api.messages.send, {
    ...email,
    to: [...email.to, { address: "b@example.test" }],
  });
  const id = atOrThrow(ids, 0);
  const message = await t.query(api.messages.getMessage, { messageId: id });
  if (!message?.jobId) throw new Error("Missing job");
  const jobId = message.jobId;
  const job = await t.run((ctx) => ctx.db.get("sendJobs", jobId));
  if (!job?.workId) throw new Error("Missing work");
  await t.mutation(internal.sends.begin, { jobId, attempt: 1 });
  await t.mutation(internal.sends.complete, {
    workId: job.workId,
    context: { jobId, attempt: 1 },
    result: {
      kind: "success",
      returnValue: {
        kind: "failed",
        retryable: true,
        failureDefinitive: false,
        error: {
          code: "ZOHO_CPAAS_NETWORK_ERROR",
          message: "The send request outcome is unknown.",
        },
      },
    },
  });
  expect(await t.mutation(api.messages.cancel, { messageId: id })).toBe(true);
  expect(await t.query(api.messages.getMessage, { messageId: id })).toMatchObject({
    status: "unknown",
  });
  expect(await t.mutation(internal.sends.begin, { jobId, attempt: 2 })).toMatchObject({
    active: ["b@example.test"],
  });
  await t.mutation(internal.webhooks.commit, {
    providerEventId: "canceled-bounce",
    bodyHash: "canceled-bounce-hash",
    events: [
      {
        providerEventId: "canceled-bounce",
        channel: "email",
        type: "hardbounce",
        occurredAt: 2,
        clientReference: message.clientReference,
        recipient: message.to,
        raw: {},
      },
    ],
  });
  expect(await t.query(api.messages.getMessage, { messageId: id })).toMatchObject({
    status: "bounced",
  });
});

test("send rejects oversized identifiers independently of encoded payload size", async () => {
  vi.useFakeTimers();
  const t = fresh();
  await expect(
    t.mutation(api.messages.send, { ...email, idempotencyKey: "k".repeat(201) }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
  await expect(
    t.mutation(api.messages.sendTemplate, {
      from: email.from,
      to: email.to,
      templateKey: "k".repeat(201),
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
  await expect(
    t.mutation(api.messages.sendWhatsappTemplate, {
      from: "+15550100001",
      to: "+15550100002",
      templateKey: "key",
      agentId: "a".repeat(201),
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
  expect(await t.run((ctx) => ctx.db.query("messages").take(1))).toEqual([]);
});

test.each([0, 101, 1.5])("all list APIs reject numItems=%s", async (numItems) => {
  const t = fresh();
  const id = await t.run((ctx) => ctx.db.insert("messages", row()));
  const paginationOpts = { numItems, cursor: null };
  for (const operation of [
    t.query(api.messages.listMessages, { status: "accepted", paginationOpts }),
    t.query(api.messages.listEvents, { messageId: id, paginationOpts }),
    t.query(api.suppressions.list, { channel: "email", paginationOpts }),
  ])
    await expect(operation).rejects.toMatchObject({
      data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" },
    });
});

test.each(["sms", "whatsapp"] as const)(
  "%s never retries an unrecognized proxy 5xx code or releases its idempotency key",
  async (channel) => {
    vi.useFakeTimers();
    vi.stubEnv("ZOHO_CPAAS_TOKEN", "dummy-token");
    vi.stubEnv("ZOHO_CPAAS_REGION", "in");
    for (const status of [500, 503]) {
      const t = fresh();
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE" } }), { status }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const sendMessage = () =>
        channel === "sms"
          ? t.mutation(api.messages.sendSmsTemplate, {
              senderKey: "sender",
              to: "919876543210",
              templateKey: "template",
              idempotencyKey: "proxy-failure",
            })
          : t.mutation(api.messages.sendWhatsappTemplate, {
              from: "+15550100001",
              to: "+15550100002",
              templateKey: "template",
              idempotencyKey: "proxy-failure",
            });
      const id = await sendMessage();
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.query(api.messages.getMessage, { messageId: id })).toMatchObject({
        status: "unknown",
        failureDefinitive: false,
        attempts: 1,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await sendMessage()).toBe(id);
    }
  },
);

test("an expired receipt cannot be replayed by replacing the unsigned timestamp", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  vi.stubEnv("ZOHO_CPAAS_RETENTION_DAYS", "1");
  const t = fresh();
  const body = JSON.stringify({
    webhook_request_id: "captured",
    event_name: ["open"],
    event_message: [{ occurred_at: Date.now(), email_info: {} }],
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
    reason: "invalid_signature",
    duplicate: false,
  });
  expect(await t.run((ctx) => ctx.db.query("webhookReceipts").take(1))).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("events").take(1))).toEqual([]);
});

test("an invalid content type cannot block a valid delivery of the same signed body", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const rawBody = JSON.stringify({
    webhook_request_id: "redelivered",
    event_name: ["open"],
    event_message: [{ occurred_at: Date.now(), email_info: {} }],
  });
  const signature = await signWebhook(rawBody);
  expect(
    await t.action(api.webhooks.receive, { rawBody, signature, contentType: "text/plain" }),
  ).toEqual({ reason: "invalid_payload", duplicate: false });
  expect(
    await t.action(api.webhooks.receive, { rawBody, signature, contentType: "application/json" }),
  ).toEqual({ reason: "accepted", duplicate: false });
  expect(await t.run((ctx) => ctx.db.query("events").take(2))).toHaveLength(1);
  expect(
    await t.action(api.webhooks.receive, { rawBody, signature, contentType: "application/json" }),
  ).toEqual({ reason: "duplicate", duplicate: true });
});

test.each(["1", "60", "invalid"])(
  "signed event freshness uses receipt retention minus one day for retention=%s",
  async (retention) => {
    vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
    vi.stubEnv("ZOHO_CPAAS_RETENTION_DAYS", retention);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
    const t = fresh();
    const cutoff = Date.now() - (retention === "60" ? 59 : 29) * 86_400_000;
    for (const [suffix, times, reason] of [
      ["boundary", [cutoff], "accepted"],
      ["mixed", [Date.now(), cutoff - 1], "invalid_signature"],
    ] as const) {
      const rawBody = JSON.stringify({
        webhook_request_id: suffix,
        event_name: ["open"],
        event_message: times.map((occurred_at) => ({ occurred_at, email_info: {} })),
      });
      expect(
        await t.action(api.webhooks.receive, {
          rawBody,
          contentType: "application/json",
          signature: await signWebhook(rawBody),
        }),
      ).toEqual({ reason, duplicate: false });
    }
    expect(await t.run((ctx) => ctx.db.query("webhookReceipts").take(2))).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("events").take(2))).toHaveLength(1);
  },
);

test("a signed event without a body timestamp cannot bypass the replay bound", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
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
  ).toEqual({ reason: "invalid_signature", duplicate: false });
  expect(await t.run((ctx) => ctx.db.query("webhookReceipts").take(1))).toEqual([]);
});

test("a future signed event cannot outlive its receipt's replay protection", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = fresh();
  const rawBody = JSON.stringify({
    webhook_request_id: "future-time",
    event_name: ["open"],
    event_message: [{ occurred_at: Date.now() + 86_400_000, email_info: {} }],
  });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody,
      contentType: "application/json",
      signature: await signWebhook(rawBody),
    }),
  ).toEqual({ reason: "invalid_signature", duplicate: false });
  expect(await t.run((ctx) => ctx.db.query("webhookReceipts").take(1))).toEqual([]);
});

test("events in one body match identifiers written by earlier events", async () => {
  const t = fresh();
  const messageId = await t.run((ctx) => ctx.db.insert("messages", row()));
  await t.mutation(internal.webhooks.commit, {
    providerEventId: "identifiers",
    bodyHash: "identifiers-hash",
    events: [
      {
        providerEventId: "identifiers",
        channel: "email",
        type: "open",
        occurredAt: 1,
        clientReference: "shared",
        recipient: "a@example.test",
        providerRequestId: "request-a",
        raw: {},
      },
      {
        providerEventId: "identifiers",
        channel: "email",
        type: "hardbounce",
        occurredAt: 2,
        clientReference: "shared",
        recipient: "a@example.test",
        providerRequestId: "request-b",
        raw: { conflict: true },
      },
      {
        providerEventId: "identifiers",
        channel: "email",
        type: "click",
        occurredAt: 3,
        recipient: "a@example.test",
        providerRequestId: "request-a",
        raw: {},
      },
    ],
  });
  expect(await t.query(api.messages.getMessage, { messageId })).toMatchObject({
    status: "accepted",
    providerRequestId: "request-a",
  });
  const events = await t.run((ctx) => ctx.db.query("events").take(3));
  expect(atOrThrow(events, 0).messageId).toBe(messageId);
  expect(atOrThrow(events, 1).messageId).toBeUndefined();
  expect(atOrThrow(events, 2).messageId).toBe(messageId);
});

test("an SMS action failure before fetch permits a new send with the same idempotency key", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "dummy-token");
  vi.stubEnv("ZOHO_CPAAS_REGION", "in");
  const t = fresh();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const args = {
    senderKey: "sender",
    to: "919876543210",
    templateKey: "template",
    idempotencyKey: "unsent",
  };
  const id = await t.mutation(api.messages.sendSmsTemplate, args);
  const message = await t.query(api.messages.getMessage, { messageId: id });
  if (!message?.jobId) throw new Error("Missing job");
  const jobId = message.jobId;
  await t.run((ctx) => ctx.db.patch("sendJobs", jobId, { payload: "{broken" }));
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await t.query(api.messages.getMessage, { messageId: id })).toMatchObject({
    status: "failed",
    failureDefinitive: true,
    error: { code: "ZOHO_CPAAS_WORKPOOL_ACTION_FAILED" },
  });
  expect(await t.mutation(api.messages.sendSmsTemplate, args)).not.toBe(id);
});

test("a newly shared provider identifier invalidates a cached unique match", async () => {
  const t = fresh();
  const otherId = await t.run(async (ctx) => {
    await ctx.db.insert("messages", row());
    return ctx.db.insert(
      "messages",
      row({ clientReference: "other", providerRequestId: "shared-request" }),
    );
  });
  await t.mutation(internal.webhooks.commit, {
    providerEventId: "shared-identifier",
    bodyHash: "shared-identifier-hash",
    events: [
      {
        providerEventId: "shared-identifier",
        channel: "email",
        type: "open",
        occurredAt: 1,
        clientReference: "shared",
        recipient: "a@example.test",
        providerRequestId: "shared-request",
        raw: {},
      },
      {
        providerEventId: "shared-identifier",
        channel: "email",
        type: "hardbounce",
        occurredAt: 2,
        recipient: "a@example.test",
        providerRequestId: "shared-request",
        raw: {},
      },
    ],
  });
  expect(await t.query(api.messages.getMessage, { messageId: otherId })).toMatchObject({
    status: "accepted",
  });
  const events = await t.run((ctx) => ctx.db.query("events").take(2));
  expect(atOrThrow(events, 1)).toMatchObject({ ambiguous: true });
  expect(atOrThrow(events, 1).messageId).toBeUndefined();
});
