import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { readConfig } from "../shared/config.js";
import { expectZohoCpaasError } from "../test-helpers.js";

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
    await expectZohoCpaasError(
      t.mutation(api.email.send, {
        from: { address: "sender@example.test" },
        to: [{ address: "recipient@example.test" }],
        subject: "Receipt",
        textbody: "Body",
        testMode: true,
      }),
      "ZOHO_CPAAS_NOT_CONFIGURED",
    );
    expect(await t.run((ctx) => ctx.db.query("messages").take(1))).toEqual([]);
  },
);

test("get reports credentials per channel and derives the region from a base URL override", async () => {
  vi.stubEnv("ZOHO_CPAAS_BASE_URL", "https://cpaas.zoho.in/v1.1");
  vi.stubEnv("ZOHO_CPAAS_EMAIL_TOKEN", "dummy-token");
  vi.stubEnv("ZOHO_CPAAS_SMS_TOKEN", "dummy-token");
  const t = convexTest(schema, modules);
  expect(await t.query(api.config.get, {})).toEqual({
    configured: { email: true, sms: true, whatsapp: false },
    testMode: false,
    region: "in",
  });
});

test("get prefers an explicit region over the base URL host", async () => {
  vi.stubEnv("ZOHO_CPAAS_BASE_URL", "https://cpaas.zoho.in/v1.1");
  vi.stubEnv("ZOHO_CPAAS_REGION", "eu");
  const t = convexTest(schema, modules);
  expect(await t.query(api.config.get, {})).toEqual({
    configured: { email: false, sms: false, whatsapp: false },
    testMode: false,
    region: "eu",
  });
});

test.each([
  "ZOHO_CPAAS_TOKEN",
  "ZOHO_CPAAS_EMAIL_TOKEN",
  "ZOHO_CPAAS_SMS_TOKEN",
  "ZOHO_CPAAS_WHATSAPP_TOKEN",
])("get rejects padded %s before provider normalization", async (name) => {
  const t = convexTest(schema, modules);
  for (const value of [" dummy-token", "dummy-token ", "Zoho-enczapikey dummy-token "]) {
    vi.stubEnv(name, value);
    await expectZohoCpaasError(t.query(api.config.get, {}), "ZOHO_CPAAS_NOT_CONFIGURED");
  }
  vi.stubEnv(name, "Zoho-enczapikey dummy-token");
  const config = await t.query(api.config.get, {});
  expect(config.configured.email || config.configured.sms || config.configured.whatsapp).toBe(true);
});

test.each([
  "ZOHO_CPAAS_TOKEN",
  "ZOHO_CPAAS_EMAIL_TOKEN",
  "ZOHO_CPAAS_SMS_TOKEN",
  "ZOHO_CPAAS_WHATSAPP_TOKEN",
])("the configuration reader rejects malformed Unicode in %s", async (name) => {
  await expectZohoCpaasError(
    Promise.resolve().then(() => readConfig({ [name]: "dummy-\ud800" })),
    "ZOHO_CPAAS_NOT_CONFIGURED",
  );
});
