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
