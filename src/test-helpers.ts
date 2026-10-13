import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { expect, vi } from "vitest";
import schema from "./component/schema.js";
import {
  isZohoCpaasError,
  type ZohoCpaasErrorCode,
  type ZohoCpaasErrorData,
} from "./shared/errors.js";

// shared-block:begin
type GlobImportMeta = ImportMeta & {
  glob: (patterns: string[]) => Record<string, () => Promise<unknown>>;
};
const modules = (import.meta as GlobImportMeta).glob([
  "./component/**/*.ts",
  "!./component/**/*.test.ts",
]);

export function setupTest() {
  const t = convexTest(schema, modules);
  registerWorkpool(t, "workpool");
  return t;
}

export type TestCtx = ReturnType<typeof setupTest>;

export async function drain(t: Pick<TestCtx, "finishAllScheduledFunctions">): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to exist`);
  return value;
}

export type FetchCall = { url: string; init: RequestInit };

export function stubFetch(
  respond: (call: FetchCall, index: number) => Response | Promise<Response>,
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: input instanceof Request ? input.url : String(input), init };
    calls.push(call);
    return respond(call, calls.length - 1);
  });
  return calls;
}

export async function expectZohoCpaasError(
  promise: Promise<unknown>,
  code: ZohoCpaasErrorCode,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(isZohoCpaasError(error), String(error)).toBe(true);
  if (isZohoCpaasError(error)) expect(error.data.code).toBe(code);
}
// shared-block:end

export async function expectZohoCpaasErrorFields(
  promise: Promise<unknown>,
  code: ZohoCpaasErrorCode,
  fields: Partial<ZohoCpaasErrorData>,
): Promise<void> {
  await expectZohoCpaasError(promise, code);
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (isZohoCpaasError(error)) expect(error.data).toMatchObject(fields);
}

export async function signWebhook(
  body: string,
  secret = "test-key",
  timestamp = Date.now(),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  const signature = encodeURIComponent(btoa(String.fromCharCode(...bytes)));
  return `ts=${timestamp};s=${signature};s-algorithm=HmacSHA256`;
}

export function atOrThrow<T>(values: readonly T[], index: number): T {
  const value = values.at(index);
  if (value === undefined) throw new Error(`Missing test fixture at index ${index}`);
  return value;
}

// Documented: the event-time nesting follows the published email webhook payload; no field is captured from a live delivery.
export function createEventTimeFields(occurredAt: number) {
  return { event_data: [{ details: [{ time: new Date(occurredAt).toISOString() }] }] };
}
