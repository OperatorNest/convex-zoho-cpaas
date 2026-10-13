import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test.each([
  ["ZOHO_CPAAS_REGION", "invalid"],
  ["ZOHO_CPAAS_BASE_URL", "not-a-url"],
  ["ZOHO_CPAAS_BASE_URL", ""],
  ["ZOHO_CPAAS_TEST_MODE", "TRUE"],
  ["ZOHO_CPAAS_RETENTION_DAYS", "invalid"],
  ["ZOHO_CPAAS_EMAIL_TOKEN", " "],
  ["ZOHO_CPAAS_SMS_TOKEN", "has whitespace"],
  ["ZOHO_CPAAS_WHATSAPP_TOKEN", ""],
  ["ZOHO_CPAAS_TOKEN", "Zoho-enczapikey "],
  ["ZOHO_CPAAS_WEBHOOK_SECRET", ""],
  ["ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS", " "],
])(
  "email rejects malformed %s before enqueue even with explicit test mode",
  async (name, value) => {
    vi.stubEnv(name, value);
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.email.send, {
        from: { address: "sender@example.test" },
        to: [{ address: "recipient@example.test" }],
        subject: "Receipt",
        textbody: "Body",
        testMode: true,
      }),
    ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_NOT_CONFIGURED" } });
    expect(await t.run((ctx) => ctx.db.query("messages").take(1))).toEqual([]);
  },
);
