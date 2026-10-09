import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const DAY = 86_400_000;
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("cleanup marks stuck sends failed, blanks terminal jobs, and drains bounded sweeps", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  const old = Date.now() - 31 * DAY;
  const { pending, whatsapp, stuck, siblingStuck, terminal, recentTerminal, stuckJob, attached } =
    await t.run(async (ctx) => {
      const pendingId = await ctx.db.insert("messages", {
        channel: "email",
        to: "pending@example.test",
        from: "from@example.test",
        status: "queued",
        clientReference: "pending",
        attempts: 1,
        region: "us",
        createdAt: old,
      });
      const whatsappId = await ctx.db.insert("messages", {
        channel: "whatsapp",
        to: "+919876543210",
        from: "+14155550142",
        status: "accepted",
        clientReference: "wa",
        attempts: 1,
        region: "us",
        createdAt: old,
      });
      const stuckId = await ctx.db.insert("messages", {
        channel: "email",
        to: "stuck@example.test",
        from: "from@example.test",
        status: "sending",
        clientReference: "stuck",
        attempts: 2,
        region: "us",
        createdAt: old,
        sendingAt: old,
      });
      const siblingStuckId = await ctx.db.insert("messages", {
        channel: "email",
        to: "stuck-sibling@example.test",
        from: "from@example.test",
        status: "sending",
        clientReference: "stuck-sibling",
        attempts: 2,
        region: "us",
        createdAt: old,
        sendingAt: old,
      });
      const terminalId = await ctx.db.insert("messages", {
        channel: "email",
        to: "old@example.test",
        from: "from@example.test",
        status: "accepted",
        clientReference: "old",
        attempts: 1,
        region: "us",
        createdAt: old,
        terminalAt: old,
      });
      const recentTerminalId = await ctx.db.insert("messages", {
        channel: "email",
        to: "recent-terminal@example.test",
        from: "from@example.test",
        status: "failed",
        clientReference: "recent-terminal",
        attempts: 1,
        region: "us",
        createdAt: old,
        terminalAt: Date.now() - DAY,
      });
      const stuckJobId = await ctx.db.insert("sendJobs", {
        channel: "email",
        path: "/email",
        payload: "sensitive payload",
        requestHash: "seeded-hash",
        messageIds: [stuckId, siblingStuckId],
        attempts: 2,
        testMode: false,
        createdAt: old,
      });
      await ctx.db.patch("messages", stuckId, { jobId: stuckJobId });
      await ctx.db.patch("messages", siblingStuckId, { jobId: stuckJobId });
      const attachedId = await ctx.db.insert("events", {
        messageId: terminalId,
        channel: "email",
        type: "open",
        occurredAt: Date.now(),
        receivedAt: Date.now(),
        providerEventId: "attached",
        raw: "{}",
      });
      for (let i = 0; i < 205; i++)
        await ctx.db.insert("events", {
          channel: "email",
          type: "open",
          occurredAt: old,
          receivedAt: old,
          providerEventId: `old-${i}`,
          raw: "{}",
        });
      await ctx.db.insert("sendJobs", {
        channel: "email",
        path: "/email",
        payload: "{}",
        requestHash: "pending-hash",
        messageIds: [pendingId],
        attempts: 1,
        testMode: false,
        createdAt: old,
      });
      return {
        pending: pendingId,
        whatsapp: whatsappId,
        stuck: stuckId,
        siblingStuck: siblingStuckId,
        terminal: terminalId,
        recentTerminal: recentTerminalId,
        stuckJob: stuckJobId,
        attached: attachedId,
      };
    });
  const first = await t.mutation(internal.cleanup.run, {});
  expect(first).toMatchObject({ hasMore: true });
  const failed = await t.run((ctx) => ctx.db.get("messages", stuck));
  expect(failed).toMatchObject({
    status: "failed",
    failureDefinitive: false,
    error: { code: "ZOHO_CPAAS_STUCK", retryable: false },
  });
  expect(await t.run((ctx) => ctx.db.get("messages", siblingStuck))).toMatchObject({
    status: "failed",
    error: { code: "ZOHO_CPAAS_STUCK" },
  });
  expect(await t.run((ctx) => ctx.db.get("sendJobs", stuckJob))).toMatchObject({
    finishedAt: expect.any(Number),
    payload: "",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run(async (ctx) => ctx.db.get("messages", pending))).not.toBeNull();
  expect(await t.run(async (ctx) => ctx.db.get("messages", whatsapp))).toBeNull();
  expect(await t.run(async (ctx) => ctx.db.get("messages", stuck))).not.toBeNull();
  expect(await t.run(async (ctx) => ctx.db.get("messages", terminal))).toBeNull();
  expect(await t.run(async (ctx) => ctx.db.get("messages", recentTerminal))).not.toBeNull();
  expect(await t.run(async (ctx) => ctx.db.get("events", attached))).toBeNull();
  expect(await t.run(async (ctx) => ctx.db.query("events").take(300))).toHaveLength(0);
});

test("cleanup does not finalize a job with an active sibling beyond 500 rows", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  const old = Date.now() - 31 * DAY;
  const { jobId, queuedId } = await t.run(async (ctx) => {
    const insertedJobId = await ctx.db.insert("sendJobs", {
      channel: "email",
      path: "/email/batch",
      payload: "sensitive payload",
      requestHash: "seeded-hash",
      messageIds: [],
      attempts: 1,
      testMode: false,
      createdAt: old,
    });
    const messageIds: Id<"messages">[] = [];
    let insertedQueuedId: Id<"messages"> | undefined;
    for (let i = 0; i < 501; i++) {
      const isQueued = i === 500;
      const messageId = await ctx.db.insert("messages", {
        channel: "email",
        to: `recipient-${i}@example.test`,
        from: "from@example.test",
        status: i === 0 ? "sending" : isQueued ? "queued" : "failed",
        jobId: insertedJobId,
        clientReference: `ref-${i}`,
        attempts: 1,
        region: "us",
        createdAt: old,
      });
      messageIds.push(messageId);
      if (isQueued) insertedQueuedId = messageId;
    }
    if (insertedQueuedId === undefined) throw new Error("Queued sibling was not created");
    await ctx.db.patch("sendJobs", insertedJobId, { messageIds });
    return { jobId: insertedJobId, queuedId: insertedQueuedId };
  });

  await t.mutation(internal.cleanup.run, {});
  expect(await t.run((ctx) => ctx.db.get("messages", queuedId))).toMatchObject({
    status: "queued",
  });
  const job = await t.run((ctx) => ctx.db.get("sendJobs", jobId));
  expect(job).not.toHaveProperty("finishedAt");
  expect(job).toMatchObject({
    payload: "sensitive payload",
  });
});

test("cleanup removes expired completed jobs and webhook receipts", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  const old = Date.now() - 31 * DAY;
  const ids = await t.run(async (ctx) => ({
    job: await ctx.db.insert("sendJobs", {
      channel: "email",
      path: "/email",
      payload: "",
      requestHash: "completed-job-hash",
      messageIds: [],
      attempts: 1,
      testMode: false,
      createdAt: old,
      finishedAt: old,
    }),
    receipt: await ctx.db.insert("webhookReceipts", {
      providerEventId: "expired-receipt",
      bodyHash: "expired-body-hash",
      createdAt: old,
    }),
  }));
  expect(await t.mutation(internal.cleanup.run, {})).toMatchObject({ deleted: 2, hasMore: false });
  expect(await t.run((ctx) => ctx.db.get("sendJobs", ids.job))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("webhookReceipts", ids.receipt))).toBeNull();
});

test("cleanup ages current sends by sendingAt and keeps old jobs with fresh attempts active", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  const old = Date.now() - 31 * DAY;
  const currentAttempt = await t.run(async (ctx) => {
    const jobId = await ctx.db.insert("sendJobs", {
      channel: "email",
      path: "/email",
      payload: "sensitive payload",
      requestHash: "seeded-hash",
      messageIds: [],
      attempts: 2,
      testMode: false,
      createdAt: old,
    });
    const messageId = await ctx.db.insert("messages", {
      channel: "email",
      to: "delayed-retry@example.test",
      from: "from@example.test",
      status: "sending",
      clientReference: "delayed-retry",
      attempts: 2,
      region: "us",
      createdAt: old,
      sendingAt: Date.now() - 60 * 60 * 1000,
      jobId,
    });
    const freshLegacyId = await ctx.db.insert("messages", {
      channel: "email",
      to: "fresh-legacy@example.test",
      from: "from@example.test",
      status: "sending",
      clientReference: "fresh-legacy",
      attempts: 2,
      region: "us",
      createdAt: Date.now() - 60 * 60 * 1000,
    });
    await ctx.db.patch("sendJobs", jobId, { messageIds: [messageId] });
    return { jobId, messageId, freshLegacyId };
  });

  await t.mutation(internal.cleanup.run, {});
  expect(await t.run((ctx) => ctx.db.get("messages", currentAttempt.messageId))).toMatchObject({
    status: "sending",
    attempts: 2,
    sendingAt: Date.now() - 60 * 60 * 1000,
  });
  expect(await t.run((ctx) => ctx.db.get("messages", currentAttempt.freshLegacyId))).toMatchObject({
    status: "sending",
    attempts: 2,
  });
  expect(await t.run((ctx) => ctx.db.get("sendJobs", currentAttempt.jobId))).not.toHaveProperty(
    "finishedAt",
  );
});

test("webhook receipts outlive shorter retention windows for at least 30 days", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  vi.stubEnv("ZOHO_CPAAS_RETENTION_DAYS", "1");
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const receipt = (key: string, age: number) =>
      ctx.db.insert("webhookReceipts", {
        providerEventId: key,
        bodyHash: key,
        createdAt: Date.now() - age,
      });
    return {
      recent: await receipt("recent", 29 * DAY),
      expired: await receipt("expired", 31 * DAY),
    };
  });
  await t.mutation(internal.cleanup.run, {});
  expect(await t.run((ctx) => ctx.db.get("webhookReceipts", ids.recent))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get("webhookReceipts", ids.expired))).toBeNull();
});

const baseMessage = (suffix: string, createdAt: number) =>
  ({
    channel: "email",
    to: `${suffix}@example.test`,
    from: "from@example.test",
    clientReference: suffix,
    attempts: 1,
    region: "us",
    createdAt,
  }) as const;

const baseJob = (createdAt: number) => ({
  channel: "email" as const,
  path: "/email",
  payload: "payload",
  requestHash: "hash",
  messageIds: [] as Id<"messages">[],
  attempts: 1,
  testMode: false,
  createdAt,
});

test("stuck sends tolerate missing or finished jobs and leave jobs with fresh siblings open", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  const old = Date.now() - 2 * DAY;
  const ids = await t.run(async (ctx) => {
    const missingJob = await ctx.db.insert("sendJobs", baseJob(old));
    const finishedJob = await ctx.db.insert("sendJobs", { ...baseJob(old), finishedAt: old });
    const openJob = await ctx.db.insert("sendJobs", baseJob(old));
    const stuck = (suffix: string, jobId: Id<"sendJobs">, sendingAt: number) =>
      ctx.db.insert("messages", {
        ...baseMessage(suffix, old),
        status: "sending",
        sendingAt,
        jobId,
      });
    await stuck("missing", missingJob, old);
    await stuck("finished", finishedJob, old);
    await stuck("open-stuck", openJob, old);
    const fresh = await stuck("open-fresh", openJob, Date.now());
    await ctx.db.delete("sendJobs", missingJob);
    return { finishedJob, openJob, fresh };
  });
  await t.mutation(internal.cleanup.run, {});
  expect(await t.run((ctx) => ctx.db.get("sendJobs", ids.finishedJob))).toMatchObject({
    finishedAt: old,
    payload: "payload",
  });
  const openJob = await t.run((ctx) => ctx.db.get("sendJobs", ids.openJob));
  expect(openJob).not.toHaveProperty("finishedAt");
  expect(await t.run((ctx) => ctx.db.get("messages", ids.fresh))).toMatchObject({
    status: "sending",
  });
});

test("a message is deleted only after its events fit in the batch budget", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  const old = Date.now() - 31 * DAY;
  const insertEvents = (messageId: Id<"messages">, count: number) =>
    t.run(async (ctx) => {
      for (let i = 0; i < count; i++)
        await ctx.db.insert("events", {
          messageId,
          channel: "email",
          type: "open",
          occurredAt: Date.now() + i,
          receivedAt: Date.now(),
          providerEventId: `${messageId}-${i}`,
          raw: "{}",
        });
    });
  const { terminal, untimed } = await t.run(async (ctx) => ({
    terminal: await ctx.db.insert("messages", {
      ...baseMessage("terminal", old),
      status: "accepted",
      terminalAt: old,
    }),
    untimed: await ctx.db.insert("messages", {
      ...baseMessage("untimed", old),
      status: "delivered",
    }),
  }));
  await insertEvents(terminal, 250);
  await insertEvents(untimed, 250);
  const eventCount = () => t.run(async (ctx) => (await ctx.db.query("events").collect()).length);
  const exists = async (id: Id<"messages">) =>
    (await t.run((ctx) => ctx.db.get("messages", id))) !== null;

  expect(await t.mutation(internal.cleanup.run, {})).toEqual({ deleted: 200, hasMore: true });
  expect(await exists(terminal)).toBe(true);
  expect(await eventCount()).toBe(300);
  expect(await t.mutation(internal.cleanup.run, {})).toMatchObject({ hasMore: true });
  expect(await exists(terminal)).toBe(false);
  expect(await exists(untimed)).toBe(true);
  for (let i = 0; i < 3 && (await exists(untimed)); i++) await t.mutation(internal.cleanup.run, {});
  expect(await exists(untimed)).toBe(false);
  expect(await eventCount()).toBe(0);
});

test.each([
  ["abc", 30],
  ["0", 30],
  ["3651", 30],
  ["2.5", 30],
  ["", 30],
  ["3650", 3650],
  ["31", 31],
])("retention days %j resolves to %i days for terminal messages", async (configured, days) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  vi.stubEnv("ZOHO_CPAAS_RETENTION_DAYS", configured);
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const make = (suffix: string, age: number) =>
      ctx.db.insert("messages", {
        ...baseMessage(suffix, Date.now() - age),
        status: "accepted",
        terminalAt: Date.now() - age,
      });
    return {
      inside: await make("inside", (days - 1) * DAY),
      outside: await make("outside", (days + 1) * DAY),
    };
  });
  await t.mutation(internal.cleanup.run, {});
  expect(await t.run((ctx) => ctx.db.get("messages", ids.inside))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get("messages", ids.outside))).toBeNull();
});
