import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
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
    await expect(result).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_INVALID_ARGUMENT" } });
  },
);
