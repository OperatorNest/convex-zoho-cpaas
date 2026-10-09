import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { signWebhook } from "../test-helpers.js";
import schema from "./schema.js";
import { reconcileRequestEvents } from "./webhooks.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("events received before send completion reconcile by recipient, client reference and provider ID", async () => {
  const t = convexTest(schema, modules);
  const fixtures = await t.run(async (ctx) => {
    const messageIds = [];
    for (const [to, reference, providerMessageId] of [
      ["a@example.test", "ref-a", "provider-a"],
      ["b@example.test", "ref-b", "provider-b"],
      ["c@example.test", "ref-c", "provider-c"],
    ]) {
      if (to === undefined || reference === undefined || providerMessageId === undefined)
        throw new Error("Missing message fixture field");
      const id = await ctx.db.insert("messages", {
        channel: "email",
        to,
        from: "sender@example.test",
        status: "accepted",
        clientReference: reference,
        providerMessageId,
        providerRequestId: "request-1",
        attempts: 1,
        region: "us",
        createdAt: 1,
      });
      messageIds.push(id);
    }
    const eventIds = [];
    for (const [suffix, fields] of [
      ["recipient", { recipient: " A@EXAMPLE.TEST " }],
      ["reference", { clientReference: "ref-b" }],
      ["provider", { providerMessageId: "provider-c" }],
    ] as const) {
      eventIds.push(
        await ctx.db.insert("events", {
          channel: "email",
          type: "hardbounce",
          occurredAt: 2,
          receivedAt: 2,
          providerEventId: `event-${suffix}`,
          providerRequestId: "request-1",
          raw: JSON.stringify({ event_message: { email_info: {} } }),
          ...fields,
        }),
      );
    }
    await reconcileRequestEvents(ctx, "request-1", messageIds);
    return { eventIds, messageIds };
  });
  for (let index = 0; index < fixtures.eventIds.length; index++) {
    const eventId = fixtures.eventIds.at(index);
    const messageId = fixtures.messageIds.at(index);
    if (eventId === undefined || messageId === undefined)
      throw new Error("Missing reconciliation fixture");
    const event = await t.run((ctx) => ctx.db.get("events", eventId));
    expect(event).toMatchObject({ messageId, ambiguous: false });
    expect(await t.run((ctx) => ctx.db.get("messages", messageId))).toMatchObject({
      status: "bounced",
    });
  }
});

test("reconciliation leaves ambiguous, malformed-recipient and already linked events unresolved", async () => {
  const t = convexTest(schema, modules);
  const fixtures = await t.run(async (ctx) => {
    const messageId = await ctx.db.insert("messages", {
      channel: "email",
      to: "first@example.test",
      from: "sender@example.test",
      status: "accepted",
      clientReference: "shared",
      attempts: 1,
      region: "us",
      createdAt: 1,
    });
    const secondId = await ctx.db.insert("messages", {
      channel: "email",
      to: "second@example.test",
      from: "sender@example.test",
      status: "accepted",
      clientReference: "shared",
      attempts: 1,
      region: "us",
      createdAt: 1,
    });
    const ambiguousId = await ctx.db.insert("events", {
      channel: "email",
      type: "complaint",
      occurredAt: 2,
      receivedAt: 2,
      providerEventId: "ambiguous",
      providerRequestId: "request-2",
      clientReference: "shared",
      raw: "not-json",
    });
    const invalidId = await ctx.db.insert("events", {
      channel: "email",
      type: "hardbounce",
      occurredAt: 2,
      receivedAt: 2,
      providerEventId: "invalid-recipient",
      providerRequestId: "request-2",
      recipient: "not-an-email",
      raw: "{}",
    });
    const linkedId = await ctx.db.insert("events", {
      messageId,
      channel: "email",
      type: "open",
      occurredAt: 2,
      receivedAt: 2,
      providerEventId: "already-linked",
      providerRequestId: "request-2",
      raw: "{}",
    });
    await reconcileRequestEvents(ctx, "request-2", [messageId, secondId]);
    return { ambiguousId, invalidId, linkedId, messageId };
  });
  expect(await t.run((ctx) => ctx.db.get("events", fixtures.ambiguousId))).toMatchObject({
    ambiguous: true,
  });
  expect(await t.run((ctx) => ctx.db.get("events", fixtures.invalidId))).not.toHaveProperty(
    "messageId",
  );
  expect(await t.run((ctx) => ctx.db.get("events", fixtures.linkedId))).toMatchObject({
    messageId: fixtures.messageId,
  });
});

test("receive verifies signatures and records unusable signed payloads once", async () => {
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  const t = convexTest(schema, modules);
  const body = "{broken";
  const signature = await signWebhook(body);
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: body,
      contentType: "application/json",
      signature: "invalid",
    }),
  ).toMatchObject({ reason: "invalid_signature" });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: body,
      contentType: "application/json",
      signature,
    }),
  ).toMatchObject({ reason: "invalid_payload", duplicate: false });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: body,
      contentType: "application/json",
      signature,
    }),
  ).toMatchObject({ reason: "invalid_payload", duplicate: true });
  const wrongContent = JSON.stringify({
    webhook_request_id: "wrong-content",
    event_name: ["open"],
    event_message: [{}],
  });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: wrongContent,
      contentType: "text/plain",
      signature: await signWebhook(wrongContent),
    }),
  ).toMatchObject({ reason: "invalid_payload" });
  const valid = JSON.stringify({
    webhook_request_id: "valid-direct",
    event_name: ["open"],
    event_message: [{ email_info: { to: [{ email_address: { address: "valid@example.test" } }] } }],
  });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: valid,
      contentType: "application/json",
      signature: await signWebhook(valid),
    }),
  ).toMatchObject({ reason: "accepted", duplicate: false });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: valid,
      contentType: "application/json",
      signature: await signWebhook(valid),
    }),
  ).toMatchObject({ reason: "duplicate", duplicate: true });
  expect(
    await t.action(api.webhooks.receive, {
      rawBody: "x".repeat(512 * 1024 + 1),
      contentType: "application/json",
    }),
  ).toMatchObject({ reason: "oversized_body" });
});
