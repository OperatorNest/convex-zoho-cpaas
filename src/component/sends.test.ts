import { atOrThrow, drain, required } from "../test-helpers.js";

import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { pool } from "./pool.js";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("completion callbacks count pre-begin crashes once and cap retries at five", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  const { jobId, messageId } = await t.run(async (ctx) => {
    const seededMessageId = await ctx.db.insert("messages", {
      testMode: false,
      channel: "email",
      to: "crash@example.test",
      from: "sender@example.test",
      status: "queued",
      clientReference: "crash",
      attempts: 0,
      region: "us",
      createdAt: Date.now(),
    });
    const seededJobId = await ctx.db.insert("sendJobs", {
      channel: "email",
      path: "/email",
      payload: JSON.stringify({ to: [{ email_address: { address: "crash@example.test" } }] }),
      requestHash: "seeded-hash",
      messageIds: [seededMessageId],
      attempts: 0,
      testMode: false,
      createdAt: Date.now(),
    });
    await ctx.db.patch("messages", seededMessageId, { jobId: seededJobId });
    return { jobId: seededJobId, messageId: seededMessageId };
  });

  const workId = await t.run((ctx) =>
    pool.enqueueAction(
      ctx,
      internal.sends.execute,
      { jobId, attempt: 1 },
      { onComplete: internal.sends.complete, context: { jobId, attempt: 1 }, retry: false },
    ),
  );
  for (let attempt = 1; attempt <= 5; attempt++)
    await t.mutation(internal.sends.complete, {
      workId,
      context: { jobId, attempt },
      result: { kind: "failed", error: "simulated crash before begin" },
    });

  expect(await t.run((ctx) => ctx.db.get("messages", messageId))).toMatchObject({
    status: "unknown",
    attempts: 5,
  });
  expect(await t.run((ctx) => ctx.db.get("sendJobs", jobId))).toMatchObject({
    attempts: 5,
    finishedAt: expect.any(Number),
    payload: "",
  });
});

test("a crash before begin keeps a canceled retry non-replayable", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  const args = {
    from: { address: "sender@example.test" },
    to: [{ address: "crash@example.test" }],
    subject: "Crash",
    textbody: "Body",
    idempotencyKey: "crash-before-begin",
    testMode: true,
  };
  const ids = await t.mutation(api.email.send, args);
  const messageId = required(ids.at(0), "sent message");
  const row = await t.query(api.messages.get, { messageId });
  const jobId = required(row.jobId, "send job for message");
  const job = await t.run((ctx) => ctx.db.get("sendJobs", jobId));
  const workId = required(job?.workId, "queued work ID");
  await t.mutation(internal.sends.complete, {
    workId,
    context: { jobId, attempt: 1 },
    result: { kind: "failed", error: "worker crashed before begin" },
  });
  expect(await t.query(api.messages.get, { messageId })).toMatchObject({
    status: "unknown",
    attempts: 1,
    failureDefinitive: false,
  });
  expect(await t.mutation(api.messages.cancel, { messageId })).toBe(true);
  expect(await t.mutation(api.email.send, args)).toEqual(ids);
});

test("a stale completion preserves a provider-confirmed definitive failure", async () => {
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  const { jobId, messageId } = await t.run(async (ctx) => {
    const seededMessageId = await ctx.db.insert("messages", {
      testMode: false,
      channel: "email",
      to: "rejected@example.test",
      from: "sender@example.test",
      status: "failed",
      failureDefinitive: true,
      clientReference: "rejected",
      attempts: 1,
      region: "us",
      createdAt: Date.now(),
      terminalAt: Date.now(),
    });
    const seededJobId = await ctx.db.insert("sendJobs", {
      channel: "email",
      path: "/email",
      payload: "",
      requestHash: "seeded-hash",
      messageIds: [seededMessageId],
      attempts: 1,
      testMode: false,
      createdAt: Date.now(),
    });
    await ctx.db.patch("messages", seededMessageId, { jobId: seededJobId });
    return { jobId: seededJobId, messageId: seededMessageId };
  });
  const workId = await t.run((ctx) =>
    pool.enqueueAction(
      ctx,
      internal.sends.execute,
      { jobId, attempt: 1 },
      { onComplete: internal.sends.complete, context: { jobId, attempt: 1 }, retry: false },
    ),
  );
  await t.mutation(internal.sends.complete, {
    workId,
    context: { jobId, attempt: 1 },
    result: {
      kind: "success",
      returnValue: {
        kind: "failed",
        failureDefinitive: false,
        error: {
          code: "ZOHO_CPAAS_NETWORK_ERROR",
          message: "stale network outcome",
        },
      },
    },
  });
  expect(await t.run((ctx) => ctx.db.get("messages", messageId))).toMatchObject({
    status: "failed",
    failureDefinitive: true,
  });
});

const emailRequest = {
  from: { address: "sender@example.test" },
  to: [{ address: "a@example.test" }],
  subject: "Subject",
  textbody: "Body",
  testMode: true,
};
const createComponentTest = () => {
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  return t;
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("an attempt excludes recipients suppressed after enqueue", async () => {
  vi.useFakeTimers();
  const t = createComponentTest();
  const ids = await t.mutation(api.email.send, {
    ...emailRequest,
    to: [...emailRequest.to, { address: "b@example.test" }],
  });
  const message = await t.query(api.messages.get, { messageId: atOrThrow(ids, 0) });
  if (!message?.jobId) throw new Error("Missing job");
  await t.run((ctx) =>
    ctx.db.insert("suppressions", {
      testMode: false,
      channel: "email",
      address: "a@example.test",
      reason: "complaint",
      createdAt: 1,
    }),
  );
  expect(
    await t.mutation(internal.sends.begin, { jobId: message.jobId, attempt: 1 }),
  ).toMatchObject({ active: ["b@example.test"] });
  expect(await t.query(api.messages.get, { messageId: atOrThrow(ids, 0) })).toMatchObject({
    status: "suppressed",
  });
});

test("a repeated attempt does not resend a WhatsApp message left sending", async () => {
  vi.useFakeTimers();
  const t = createComponentTest();
  const messageId = await t.mutation(api.whatsapp.sendTemplate, {
    from: "+15550100001",
    to: "+15550100002",
    templateKey: "template",
    testMode: true,
  });
  const message = await t.query(api.messages.get, { messageId });
  if (!message?.jobId) throw new Error("Missing job");
  const jobId = message.jobId;
  expect(await t.mutation(internal.sends.begin, { jobId, attempt: 1 })).toMatchObject({
    active: ["+15550100002"],
  });
  expect(await t.mutation(internal.sends.begin, { jobId, attempt: 2 })).toBeNull();
  expect(await t.query(api.messages.get, { messageId })).toMatchObject({
    status: "unknown",
    failureDefinitive: false,
    attempts: 1,
  });
});

test.each([false, true])(
  "transport completion preserves a delivered webhook before completion=%s",
  async (early) => {
    vi.useFakeTimers();
    const t = createComponentTest();
    const id = await t.mutation(api.whatsapp.sendTemplate, {
      from: "+15550100001",
      to: "+15550100002",
      templateKey: "template",
      testMode: true,
    });
    const message = await t.query(api.messages.get, { messageId: id });
    if (!message?.jobId) throw new Error("Missing job");
    const jobId = message.jobId;
    const job = await t.run((ctx) => ctx.db.get("sendJobs", jobId));
    if (!job?.workId) throw new Error("Missing work");
    await t.mutation(internal.sends.begin, { jobId: job._id, attempt: 1 });
    const deliver = () =>
      t.mutation(internal.webhooks.commit, {
        zohoEventId: "delivery",
        bodyHash: "hash",
        events: [
          {
            zohoEventId: "delivery",
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
      expect(await t.query(api.messages.get, { messageId: id })).toMatchObject({
        status: "unknown",
      });
      await deliver();
    }
    expect(await t.query(api.messages.get, { messageId: id })).toMatchObject({
      status: "delivered",
    });
  },
);

test("an SMS action failure before fetch permits a new send with the same idempotency key", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZOHO_CPAAS_TOKEN", "dummy-token");
  vi.stubEnv("ZOHO_CPAAS_REGION", "in");
  const t = createComponentTest();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const args = {
    senderKey: "sender",
    to: "919876543210",
    templateKey: "template",
    idempotencyKey: "unsent",
  };
  const id = await t.mutation(api.sms.sendTemplate, args);
  const message = await t.query(api.messages.get, { messageId: id });
  if (!message?.jobId) throw new Error("Missing job");
  const jobId = message.jobId;
  await t.run((ctx) => ctx.db.patch("sendJobs", jobId, { payload: "{broken" }));
  await drain(t);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await t.query(api.messages.get, { messageId: id })).toMatchObject({
    status: "failed",
    failureDefinitive: true,
    error: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" },
  });
  expect(await t.mutation(api.sms.sendTemplate, args)).not.toBe(id);
});

test.each([false, true])(
  "SMS rechecks the India endpoint before sending with testMode=%s",
  async (testMode) => {
    vi.useFakeTimers();
    vi.stubEnv("ZOHO_CPAAS_SMS_TOKEN", "dummy-token");
    vi.stubEnv("ZOHO_CPAAS_REGION", "in");
    const t = createComponentTest();
    const id = await t.mutation(api.sms.sendTemplate, {
      senderKey: "sender",
      to: "919876543210",
      templateKey: "template",
      testMode,
    });
    const message = await t.query(api.messages.get, { messageId: id });
    if (!message?.jobId) throw new Error("Missing job");
    vi.stubEnv("ZOHO_CPAAS_REGION", "us");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await t.action(internal.sends.execute, { jobId: message.jobId, attempt: 1 });
    expect(result).toMatchObject({ kind: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.query(api.messages.get, { messageId: id })).toMatchObject({
      status: "failed",
      error: { code: "ZOHO_CPAAS_UNSUPPORTED_REGION" },
    });
  },
);

test.each(["sms", "whatsapp"] as const)(
  "%s never retries an unrecognized proxy 5xx code or releases its idempotency key",
  async (channel) => {
    vi.useFakeTimers();
    vi.stubEnv("ZOHO_CPAAS_TOKEN", "dummy-token");
    vi.stubEnv("ZOHO_CPAAS_REGION", "in");
    for (const status of [500, 503]) {
      const t = createComponentTest();
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE" } }), { status }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const sendMessage = () =>
        channel === "sms"
          ? t.mutation(api.sms.sendTemplate, {
              senderKey: "sender",
              to: "919876543210",
              templateKey: "template",
              idempotencyKey: "proxy-failure",
            })
          : t.mutation(api.whatsapp.sendTemplate, {
              from: "+15550100001",
              to: "+15550100002",
              templateKey: "template",
              idempotencyKey: "proxy-failure",
            });
      const id = await sendMessage();
      await drain(t);
      expect(await t.query(api.messages.get, { messageId: id })).toMatchObject({
        status: "unknown",
        failureDefinitive: false,
        attempts: 1,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await sendMessage()).toBe(id);
    }
  },
);
