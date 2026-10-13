import { httpRouter } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";

import { ZohoCpaas, type MutationContext } from "./index.js";
import type { ComponentApi } from "../component/_generated/component.js";

const emailRequest = {
  from: { address: "sender@example.test" },
  to: [{ address: "a@example.test" }],
  subject: "Subject",
  textbody: "Body",
  testMode: true,
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("the client never forwards undeclared testMode", async () => {
  const calls: unknown[] = [];
  const component = {
    email: { send: "send" },
    files: { upload: "upload" },
  } as unknown as ComponentApi;
  const client = new ZohoCpaas(component);
  const ctx = {
    runMutation: vi.fn(async (_fn: unknown, args: unknown) => {
      calls.push(args);
      return [];
    }),
  } as unknown as MutationContext;
  await client.email.send(ctx, emailRequest);
  expect(calls).toEqual([expect.not.objectContaining({ testMode: true })]);
});

test("the webhook route maps the component oversized_body reason to 400", async () => {
  const component = { webhooks: { receive: "receive" } } as unknown as ComponentApi;
  const client = new ZohoCpaas(component);
  const router = httpRouter();
  client.registerRoutes(router);
  const route = router.lookup("/zoho-cpaas/webhook", "POST");
  if (route === null) throw new Error("Missing webhook route");
  const handler: unknown = Reflect.get(route[0], "_handler");
  if (typeof handler !== "function") throw new Error("Missing webhook handler");
  const runAction = vi.fn(async () => ({ reason: "oversized_body" }));
  const response: unknown = await handler(
    { runAction },
    new Request("https://example.test/zoho-cpaas/webhook", { method: "POST", body: "{}" }),
  );
  expect(runAction).toHaveBeenCalledOnce();
  if (!(response instanceof Response)) throw new Error("Expected webhook response");
  expect(response.status).toBe(400);
});
