import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

import { send } from "./email.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
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

test("send rethrows a non-package backend error unchanged", async () => {
  const t = createComponentTest();
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
        emailRequest,
      ),
    ),
  ).rejects.toBe(failure);
});

test("send rejects oversized identifiers independently of encoded payload size", async () => {
  vi.useFakeTimers();
  const t = createComponentTest();
  await expect(
    t.mutation(api.email.send, { ...emailRequest, idempotencyKey: "k".repeat(201) }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" } });
  await expect(
    t.mutation(api.email.sendTemplate, {
      from: emailRequest.from,
      to: emailRequest.to,
      templateKey: "k".repeat(201),
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" } });
  await expect(
    t.mutation(api.whatsapp.sendTemplate, {
      from: "+15550100001",
      to: "+15550100002",
      templateKey: "key",
      zohoAgentId: "a".repeat(201),
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" } });
  expect(await t.run((ctx) => ctx.db.query("messages").take(1))).toEqual([]);
});
