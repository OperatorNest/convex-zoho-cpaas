import { convexTest } from "convex-test";
import { httpRouter, type HttpRouter } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { ZohoCpaas, isZohoCpaasError, registerRoutes } from "../../src/client/index.js";
import { atOrThrow, signWebhook } from "../../src/test-helpers.js";
import { register } from "../../src/test.js";
import { components } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const page = { numItems: 10, cursor: null };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function fresh() {
  const t = convexTest(schema, modules);
  register(t);
  return t;
}

test("every public client method forwards to its component function", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  vi.stubEnv("ZOHO_CPAAS_REGION", "in");
  vi.stubEnv("ZOHO_CPAAS_TEST_MODE", "true");
  const t = fresh();
  const client = new ZohoCpaas(components.zohoCpaas, {
    testMode: true,
    defaultFrom: { address: "sender@example.test" },
  });

  expect(await t.query((ctx) => client.messages.status(ctx))).toMatchObject({
    testMode: true,
    region: "in",
  });
  const sent = await t.mutation((ctx) =>
    client.email.send(ctx, {
      to: [{ address: "Alice@Example.test" }],
      subject: "Hello",
      text: "Body",
    }),
  );
  const messageId = atOrThrow(sent, 0);
  expect(await t.query((ctx) => client.messages.get(ctx, { messageId }))).toMatchObject({
    to: "alice@example.test",
    testMode: true,
  });
  expect(
    (
      await t.query((ctx) =>
        client.messages.list(ctx, {
          recipient: " ALICE@Example.test ",
          channel: "email",
          paginationOpts: page,
        }),
      )
    ).page.map((row) => row._id),
  ).toContain(messageId);
  expect(
    (
      await t.query((ctx) =>
        client.messages.listEvents(ctx, {
          messageId,
          paginationOpts: page,
        }),
      )
    ).page,
  ).toEqual([]);

  expect(
    await t.mutation((ctx) =>
      client.email.sendTemplate(ctx, {
        to: [{ address: "template@example.test" }],
        templateKey: "welcome",
      }),
    ),
  ).toHaveLength(1);
  expect(
    await t.mutation((ctx) =>
      client.email.sendBatch(ctx, {
        to: [{ emailAddress: { address: "batch@example.test" } }],
        subject: "Batch",
        text: "Body",
      }),
    ),
  ).toHaveLength(1);
  expect(
    await t.mutation((ctx) =>
      client.email.sendTemplateBatch(ctx, {
        to: [{ emailAddress: { address: "template-batch@example.test" } }],
        templateKey: "welcome",
      }),
    ),
  ).toHaveLength(1);
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  expect(
    await t.action((ctx) =>
      client.email.uploadFile(ctx, {
        name: "fixture.bin",
        mimeType: "application/octet-stream",
        content: bytes,
      }),
    ),
  ).toMatch(/^test-/);
  expect(
    await t.mutation((ctx) =>
      client.experimental.sms.sendTemplate(ctx, {
        senderKey: "sender",
        to: "+919876543210",
        templateKey: "otp",
      }),
    ),
  ).toBeTruthy();
  expect(
    await t.mutation((ctx) =>
      client.experimental.whatsapp.sendTemplate(ctx, {
        from: "+14155550142",
        to: "+919876543210",
        templateKey: "otp",
      }),
    ),
  ).toBeTruthy();
  expect(
    (
      await t.query((ctx) =>
        client.suppressions.list(ctx, {
          channel: "email",
          paginationOpts: page,
        }),
      )
    ).page,
  ).toEqual([]);
  expect(
    await t.mutation((ctx) =>
      client.suppressions.remove(ctx, {
        channel: "email",
        address: "alice@example.test",
      }),
    ),
  ).toBe(false);
  expect(await t.mutation((ctx) => client.messages.cancel(ctx, { messageId }))).toBe(true);

  const classRouter = httpRouter();
  client.registerRoutes(classRouter, { path: "/client-hook" });
  expect(classRouter.lookup("/client-hook", "POST")).not.toBeNull();
  const router = httpRouter();
  registerRoutes(router, components.zohoCpaas, { path: "/standalone-hook" });
  expect(router.lookup("/standalone-hook", "POST")).not.toBeNull();
});

test("client reports a structured error for a missing from address", async () => {
  const t = fresh();
  const client = new ZohoCpaas(components.zohoCpaas);
  try {
    await t.mutation((ctx) =>
      client.email.send(ctx, {
        to: [{ address: "alice@example.test" }],
        subject: "Hello",
        text: "Body",
      }),
    );
    throw new Error("Expected missing from to fail");
  } catch (error) {
    expect(isZohoCpaasError(error)).toBe(true);
    if (isZohoCpaasError(error)) expect(error.data.code).toBe("ZOHO_CPAAS_VALIDATION_FAILED");
  }
});

async function invokeRoute(
  t: ReturnType<typeof fresh>,
  router: HttpRouter,
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: string }> {
  const match = router.lookup(path, "POST");
  if (match === null) throw new Error(`Missing route ${path}`);
  return t.action(async (ctx) => {
    const routeHandler: unknown = Reflect.get(match[0], "_handler");
    if (typeof routeHandler !== "function") throw new Error(`Missing handler for ${path}`);
    const response: unknown = await routeHandler(
      ctx,
      new Request(`https://example.test${path}`, { method: "POST", ...init }),
    );
    if (!(response instanceof Response)) throw new Error(`Invalid response for ${path}`);
    return { status: response.status, body: await response.text() };
  });
}

test("source client route verifies signed bodies and maps boundary failures", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = fresh();
  const router = httpRouter();
  registerRoutes(router, components.zohoCpaas, { path: "/direct-webhook" });
  const path = "/direct-webhook";
  const body = JSON.stringify({
    webhook_request_id: "client-route-1",
    event_name: ["open"],
    event_message: [{}],
  });
  const signature = await signWebhook(body);
  const signed = { headers: { "producer-signature": signature }, body };

  expect((await invokeRoute(t, router, path, signed)).status).toBe(500);
  vi.stubEnv("ZOHO_CPAAS_WEBHOOK_SECRET", "test-key");
  expect((await invokeRoute(t, router, path, { body })).status).toBe(401);
  expect((await invokeRoute(t, router, path, {})).status).toBe(401);
  expect((await invokeRoute(t, router, path, signed)).status).toBe(200);
  const duplicate = await invokeRoute(t, router, path, signed);
  expect(duplicate.status).toBe(200);
  expect(duplicate.body).toBe("Duplicate");
  expect(
    (
      await invokeRoute(t, router, path, {
        headers: { "content-length": "invalid" },
        body,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await invokeRoute(t, router, path, {
        headers: { "content-length": String(512 * 1024 + 1) },
        body,
      })
    ).status,
  ).toBe(413);
  expect(
    (
      await invokeRoute(t, router, path, {
        body: new Uint8Array([0xff, 0xfe]),
      })
    ).status,
  ).toBe(400);
});
