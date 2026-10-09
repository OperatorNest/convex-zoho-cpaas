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
    status: "failed",
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
    text: "Body",
    idempotencyKey: "crash-before-begin",
    testMode: true,
  };
  const ids = await t.mutation(api.messages.send, args);
  const messageId = ids.at(0);
  if (messageId === undefined) throw new Error("Expected sent message");
  const row = await t.query(api.messages.getMessage, { messageId });
  if (!row?.jobId) throw new Error("Expected send job for message");
  const jobId = row.jobId;
  const job = await t.run((ctx) => ctx.db.get("sendJobs", jobId));
  if (!job?.workId) throw new Error("Expected queued work ID");
  await t.mutation(internal.sends.complete, {
    workId: job.workId,
    context: { jobId: row.jobId, attempt: 1 },
    result: { kind: "failed", error: "worker crashed before begin" },
  });
  expect(await t.query(api.messages.getMessage, { messageId })).toMatchObject({
    status: "queued",
    attempts: 1,
    failureDefinitive: false,
  });
  expect(await t.mutation(api.messages.cancel, { messageId })).toBe(true);
  expect(await t.mutation(api.messages.send, args)).toEqual(ids);
});

test("a stale completion preserves a provider-confirmed definitive failure", async () => {
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  const { jobId, messageId } = await t.run(async (ctx) => {
    const seededMessageId = await ctx.db.insert("messages", {
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
          class: "permanent",
          code: "ZOHO_CPAAS_NETWORK_ERROR",
          message: "stale network outcome",
          retryable: false,
        },
      },
    },
  });
  expect(await t.run((ctx) => ctx.db.get("messages", messageId))).toMatchObject({
    status: "failed",
    failureDefinitive: true,
  });
});
