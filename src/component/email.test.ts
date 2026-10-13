import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

import { send } from "./email.js";
import { atOrThrow, drain, expectZohoCpaasError, stubFetch } from "../test-helpers.js";

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
  await expectZohoCpaasError(
    t.mutation(api.email.send, { ...emailRequest, idempotencyKey: "k".repeat(201) }),
    "ZOHO_CPAAS_INVALID_ARGUMENT",
  );
  await expectZohoCpaasError(
    t.mutation(api.email.sendTemplate, {
      from: emailRequest.from,
      to: emailRequest.to,
      templateKey: "k".repeat(201),
      testMode: true,
    }),
    "ZOHO_CPAAS_INVALID_ARGUMENT",
  );
  await expectZohoCpaasError(
    t.mutation(api.whatsapp.sendTemplate, {
      from: "+15550100001",
      to: "+15550100002",
      templateKey: "key",
      zohoAgentId: "a".repeat(201),
      testMode: true,
    }),
    "ZOHO_CPAAS_INVALID_ARGUMENT",
  );
  expect(await t.run((ctx) => ctx.db.query("messages").take(1))).toEqual([]);
});

test.each(["send", "sendTemplate", "sendBatch", "sendTemplateBatch"] as const)(
  "%s records an uncertain network failure without retrying even with an idempotency key",
  async (method) => {
    vi.useFakeTimers();
    vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
    const t = createComponentTest();
    const calls = stubFetch(() => {
      throw new Error("response lost");
    });
    const from = emailRequest.from;
    const idempotencyKey = `uncertain-${method}`;
    const batchTo = [{ emailAddress: { address: "a@example.test" } }];
    const args = { from, idempotencyKey, testMode: false };
    const ids =
      method === "send"
        ? await t.mutation(api.email.send, {
            ...args,
            to: emailRequest.to,
            subject: "Subject",
            textbody: "Body",
          })
        : method === "sendTemplate"
          ? await t.mutation(api.email.sendTemplate, {
              ...args,
              to: emailRequest.to,
              templateKey: "template",
            })
          : method === "sendBatch"
            ? await t.mutation(api.email.sendBatch, {
                ...args,
                to: batchTo,
                subject: "Subject",
                textbody: "Body",
              })
            : await t.mutation(api.email.sendTemplateBatch, {
                ...args,
                to: batchTo,
                templateKey: "template",
              });
    await drain(t);
    expect(calls).toHaveLength(1);
    expect(await t.query(api.messages.get, { messageId: atOrThrow(ids, 0) })).toMatchObject({
      status: "unknown",
      attempts: 1,
      error: { code: "ZOHO_CPAAS_NETWORK_ERROR", retryable: false },
    });
  },
);
