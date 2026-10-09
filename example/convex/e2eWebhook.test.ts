import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import { register } from "@operatornest/convex-zoho-cpaas/test";
import { signWebhook } from "../../src/test-helpers.js";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("e2e capture route is session gated and records signed delivery plus replay", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = convexTest(schema, modules);
  register(t);
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const body = JSON.stringify({
    webhook_request_id: "e2e-route-test",
    event_name: ["open"],
    event_message: [{ email_info: { to: [{ email_address: { address: "owner@example.test" } }] } }],
  });
  const headers = {
    "content-type": "application/json",
    "producer-signature": await signWebhook(body),
  };
  const post = () => t.fetch("/zoho-cpaas/e2e-webhook", { method: "POST", headers, body });
  expect((await post()).status).toBe(404);
  await t.mutation(internal.e2eWebhook.begin, { sessionId, durationMinutes: 15 });
  expect((await post()).status).toBe(200);
  expect((await post()).status).toBe(200);
  const attempts = await t.query(internal.e2eWebhook.pending, { sessionId });
  expect(attempts.map((attempt) => [attempt.reason, attempt.duplicate])).toEqual([
    ["accepted", false],
    ["duplicate", true],
  ]);
  expect(attempts[0]?.rawBody).toBe(body);
  expect(attempts[0]?.signature).toBe(headers["producer-signature"]);
  const callbacks = await t.query(internal.example.e2eCallbacksFor, {
    providerEventId: "e2e-route-test",
  });
  expect(callbacks).toMatchObject([{ type: "open" }]);
  const firstId = attempts[0]?._id;
  if (!firstId) throw new Error("Missing captured attempt");
  await t.mutation(internal.e2eWebhook.expire, { id: firstId });
  expect(await t.query(internal.e2eWebhook.pending, { sessionId })).toHaveLength(1);
  await t.mutation(internal.e2eWebhook.clear, {
    sessionId,
    ids: attempts.map((attempt) => attempt._id),
  });
  expect(await t.query(internal.e2eWebhook.pending, { sessionId })).toEqual([]);
  await t.mutation(internal.e2eWebhook.end, { sessionId });
  expect((await post()).status).toBe(404);
});

test("e2e capture quota rejects ingress before webhook processing", async () => {
  const t = convexTest(schema, modules);
  register(t);
  const sessionId = "22222222-2222-4222-8222-222222222222";
  await t.mutation(internal.e2eWebhook.begin, { sessionId, durationMinutes: 15 });
  for (let count = 0; count < 64; count++) {
    expect(await t.mutation(internal.e2eWebhook.reserve, { sessionId })).toBe("reserved");
  }
  await t.mutation(internal.e2eWebhook.begin, { sessionId, durationMinutes: 15 });
  expect(await t.query(internal.e2eWebhook.activeSession, {})).toMatchObject({
    attemptCount: 64,
    quotaExceeded: false,
  });
  const response = await t.fetch("/zoho-cpaas/e2e-webhook", {
    method: "POST",
    body: "unverified request",
  });
  expect(response.status).toBe(429);
  expect(await t.query(internal.e2eWebhook.pending, { sessionId })).toEqual([]);
  expect(await t.query(internal.e2eWebhook.activeSession, {})).toMatchObject({
    attemptCount: 64,
    quotaExceeded: true,
  });
});
