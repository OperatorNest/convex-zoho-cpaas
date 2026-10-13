import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";

import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { atOrThrow } from "../test-helpers.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("list uses the same normalized recipient key as send", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  const sent = await t.mutation(api.email.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "Alice@Example.test" }],
    subject: "Receipt",
    textbody: "Body",
    testMode: true,
  });
  const id = atOrThrow(sent, 0);
  const page = await t.query(api.messages.list, {
    recipient: " ALICE@EXAMPLE.TEST ",
    channel: "email",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.map((row) => row._id)).toEqual([id]);
  expect(page.page.map((row) => row.to)).toEqual(["alice@example.test"]);
});

test("list normalizes WhatsApp and SMS phone recipients", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    whatsapp: await ctx.db.insert("messages", {
      testMode: false,
      channel: "whatsapp",
      to: "+919876543210",
      from: "sender",
      status: "accepted",
      clientReference: "whatsapp-reference",
      attempts: 0,
      region: "us",
      createdAt: 1,
    }),
    sms: await ctx.db.insert("messages", {
      testMode: false,
      channel: "sms",
      to: "919876543210",
      from: "sender",
      status: "accepted",
      clientReference: "sms-reference",
      attempts: 0,
      region: "us",
      createdAt: 2,
    }),
  }));
  const paginationOpts = { numItems: 10, cursor: null };
  const whatsapp = await t.query(api.messages.list, {
    recipient: " +91 98765 43210 ",
    channel: "whatsapp",
    paginationOpts,
  });
  const sms = await t.query(api.messages.list, {
    recipient: "91 98765 43210",
    channel: "sms",
    paginationOpts,
  });

  const whatsappNoPlus = await t.query(api.messages.list, {
    recipient: "919876543210",
    channel: "whatsapp",
    paginationOpts,
  });
  const smsWithPlus = await t.query(api.messages.list, {
    recipient: "+919876543210",
    channel: "sms",
    paginationOpts,
  });
  expect(whatsappNoPlus.page.map((row) => row._id)).toEqual([ids.whatsapp]);
  expect(smsWithPlus.page.map((row) => row._id)).toEqual([ids.sms]);
  expect(whatsapp.page.map((row) => row._id)).toEqual([ids.whatsapp]);
  expect(sms.page.map((row) => row._id)).toEqual([ids.sms]);
});

test("list requires one filter and supports status pagination", async () => {
  const t = convexTest(schema, modules);
  const messageId = await t.run((ctx) =>
    ctx.db.insert("messages", {
      testMode: false,
      channel: "email",
      to: "status@example.test",
      from: "sender@example.test",
      status: "accepted",
      clientReference: "status-reference",
      attempts: 1,
      region: "us",
      createdAt: 1,
    }),
  );
  const paginationOpts = { numItems: 10, cursor: null };
  await expect(t.query(api.messages.list, { paginationOpts })).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" },
  });
  await expect(
    t.query(api.messages.list, {
      recipient: "status@example.test",
      status: "accepted",
      paginationOpts,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" } });
  await expect(
    t.query(api.messages.list, { recipient: "status@example.test", paginationOpts }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" } });
  await expect(
    t.query(api.messages.list, {
      channel: "email",
      status: "accepted",
      paginationOpts,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" } });
  await expect(
    t.query(api.messages.list, {
      recipient: "invalid phone",
      channel: "sms",
      paginationOpts,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" } });
  const page = await t.query(api.messages.list, { status: "accepted", paginationOpts });
  expect(page.page.map((row) => row._id)).toEqual([messageId]);
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

test("endCursor cannot expand a message page beyond its server read bound", async () => {
  const t = createComponentTest();
  await t.run(async (ctx) => {
    for (let i = 0; i < 20; i++) await ctx.db.insert("messages", storedMessage());
  });
  const result = await t.query(api.messages.list, {
    status: "accepted",
    paginationOpts: { numItems: 1, cursor: null, endCursor: "[]", maximumRowsRead: 10000 },
  });
  expect(result.page.length).toBeLessThanOrEqual(2);
});

test("canceling an uncertain email stops its retry and permits a later bounce", async () => {
  vi.useFakeTimers();
  const t = createComponentTest();
  const ids = await t.mutation(api.email.send, {
    ...emailRequest,
    to: [...emailRequest.to, { address: "b@example.test" }],
  });
  const id = atOrThrow(ids, 0);
  const message = await t.query(api.messages.get, { messageId: id });
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
  expect(await t.query(api.messages.get, { messageId: id })).toMatchObject({
    status: "unknown",
  });
  expect(await t.mutation(internal.sends.begin, { jobId, attempt: 2 })).toMatchObject({
    active: ["b@example.test"],
  });
  await t.mutation(internal.webhooks.commit, {
    zohoEventId: "canceled-bounce",
    bodyHash: "canceled-bounce-hash",
    events: [
      {
        zohoEventId: "canceled-bounce",
        channel: "email",
        type: "hardbounce",
        occurredAt: 2,
        clientReference: message.clientReference,
        recipient: message.to,
        raw: {},
      },
    ],
  });
  expect(await t.query(api.messages.get, { messageId: id })).toMatchObject({
    status: "bounced",
  });
});

test.each(["broken", "{}", "[{}]"])(
  "malformed cursor %s returns the fixed validation error",
  async (cursor) => {
    const t = createComponentTest();
    await expect(
      t.query(api.messages.list, {
        status: "accepted",
        paginationOpts: { numItems: 10, cursor },
      }),
    ).rejects.toMatchObject({
      data: {
        code: "ZOHO_CPAAS_INVALID_ARGUMENT",
        message: "An argument is invalid, missing or out of bounds.",
      },
    });
  },
);

test.each(["get", "listEvents", "cancel"])(
  "message method %s rejects malformed IDs with a package error",
  async (method) => {
    const t = createComponentTest();
    const args = { messageId: "not-an-id", paginationOpts: { cursor: null, numItems: 10 } };
    const result =
      method === "get"
        ? t.query(api.messages.get, { messageId: args.messageId })
        : method === "cancel"
          ? t.mutation(api.messages.cancel, { messageId: args.messageId })
          : t.query(api.messages.listEvents, args);
    await expect(result).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" } });
  },
);

test.each([0, 101, 1.5])("all list APIs reject numItems=%s", async (numItems) => {
  const t = createComponentTest();
  const id = await t.run((ctx) => ctx.db.insert("messages", storedMessage()));
  const paginationOpts = { numItems, cursor: null };
  for (const operation of [
    t.query(api.messages.list, { status: "accepted", paginationOpts }),
    t.query(api.messages.listEvents, { messageId: id, paginationOpts }),
    t.query(api.suppressions.list, { channel: "email", paginationOpts }),
  ])
    await expect(operation).rejects.toMatchObject({
      data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" },
    });
});

test.each(["get", "listEvents", "cancel"])(
  "message method %s rejects a deleted row with NOT_FOUND",
  async (method) => {
    const t = createComponentTest();
    const messageId = await t.run(async (ctx) => {
      const deletedMessageId = await ctx.db.insert("messages", storedMessage());
      await ctx.db.delete("messages", deletedMessageId);
      return deletedMessageId;
    });
    const result =
      method === "get"
        ? t.query(api.messages.get, { messageId })
        : method === "cancel"
          ? t.mutation(api.messages.cancel, { messageId })
          : t.query(api.messages.listEvents, {
              messageId,
              paginationOpts: { numItems: 10, cursor: null },
            });
    await expect(result).rejects.toMatchObject({
      data: { code: "ZOHO_CPAAS_NOT_FOUND", message: "The referenced row does not exist." },
    });
  },
);
