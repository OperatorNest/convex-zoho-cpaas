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

test("listMessages uses the same normalized recipient key as send", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  const sent = await t.mutation(api.messages.send, {
    from: { address: "sender@example.test" },
    to: [{ address: "Alice@Example.test" }],
    subject: "Receipt",
    text: "Body",
    testMode: true,
  });
  const id = atOrThrow(sent, 0);
  const page = await t.query(api.messages.listMessages, {
    recipient: " ALICE@EXAMPLE.TEST ",
    channel: "email",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.map((row) => row._id)).toEqual([id]);
  expect(page.page.map((row) => row.to)).toEqual(["alice@example.test"]);
});

test("listMessages normalizes WhatsApp and SMS phone recipients", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    whatsapp: await ctx.db.insert("messages", {
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
  const whatsapp = await t.query(api.messages.listMessages, {
    recipient: " +91 98765 43210 ",
    channel: "whatsapp",
    paginationOpts,
  });
  const sms = await t.query(api.messages.listMessages, {
    recipient: "91 98765 43210",
    channel: "sms",
    paginationOpts,
  });
  // The channel decides normalization: no leading-plus inference.
  const whatsappNoPlus = await t.query(api.messages.listMessages, {
    recipient: "919876543210",
    channel: "whatsapp",
    paginationOpts,
  });
  const smsWithPlus = await t.query(api.messages.listMessages, {
    recipient: "+919876543210",
    channel: "sms",
    paginationOpts,
  });
  expect(whatsappNoPlus.page.map((row) => row._id)).toEqual([ids.whatsapp]);
  expect(smsWithPlus.page.map((row) => row._id)).toEqual([ids.sms]);
  expect(whatsapp.page.map((row) => row._id)).toEqual([ids.whatsapp]);
  expect(sms.page.map((row) => row._id)).toEqual([ids.sms]);
});

test("listMessages requires one filter and supports status pagination", async () => {
  const t = convexTest(schema, modules);
  const messageId = await t.run((ctx) =>
    ctx.db.insert("messages", {
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
  await expect(t.query(api.messages.listMessages, { paginationOpts })).rejects.toMatchObject({
    data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" },
  });
  await expect(
    t.query(api.messages.listMessages, {
      recipient: "status@example.test",
      status: "accepted",
      paginationOpts,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
  await expect(
    t.query(api.messages.listMessages, { recipient: "status@example.test", paginationOpts }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
  await expect(
    t.query(api.messages.listMessages, {
      channel: "email",
      status: "accepted",
      paginationOpts,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
  await expect(
    t.query(api.messages.listMessages, {
      recipient: "invalid phone",
      channel: "sms",
      paginationOpts,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
  const page = await t.query(api.messages.listMessages, { status: "accepted", paginationOpts });
  expect(page.page.map((row) => row._id)).toEqual([messageId]);
});
