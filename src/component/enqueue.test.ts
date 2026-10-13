import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { expectZohoCpaasError } from "../test-helpers.js";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const emailRequest = {
  from: { address: "sender@example.test" },
  to: [{ address: "recipient@example.test" }],
  subject: "Receipt",
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

test.each(["email", "sms", "whatsapp"])(
  "%s rejects a complete encoded request exceeding 256 KiB",
  async (channel) => {
    vi.useFakeTimers();
    const t = createComponentTest();
    const huge = "\u0001".repeat(180000);
    const result =
      channel === "email"
        ? t.mutation(api.email.send, { ...emailRequest, textbody: huge })
        : channel === "sms"
          ? t.mutation(api.sms.sendTemplate, {
              senderKey: "sender",
              to: "919876543210",
              templateKey: "template",
              mergeInfo: { huge },
              testMode: true,
            })
          : t.mutation(api.whatsapp.sendTemplate, {
              from: "+15550100001",
              to: "+15550100002",
              templateKey: "template",
              mergeInfo: { huge },
              testMode: true,
            });
    await expectZohoCpaasError(result, "ZOHO_CPAAS_INVALID_ARGUMENT");
  },
);

test.each(["email", "whatsapp"])(
  "%s replays an idempotent send after its token is removed",
  async (channel) => {
    vi.useFakeTimers();
    vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
    vi.stubEnv("ZOHO_CPAAS_WHATSAPP_TOKEN", "dummy-token");
    const t = createComponentTest();
    const send = async () =>
      channel === "email"
        ? await t.mutation(api.email.send, {
            ...emailRequest,
            testMode: false,
            idempotencyKey: "replay-after-token-removal",
          })
        : [
            await t.mutation(api.whatsapp.sendTemplate, {
              from: "+15550100001",
              to: "+15550100002",
              templateKey: "template",
              idempotencyKey: "replay-after-token-removal",
            }),
          ];
    const ids = await send();
    vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", undefined);
    vi.stubEnv("ZOHO_CPAAS_WHATSAPP_TOKEN", undefined);
    expect(await send()).toEqual(ids);
  },
);
