import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

test("removing a suppression normalizes the address and rejects invalid input", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("suppressions", {
      channel: "email",
      address: "alice@example.test",
      reason: "hardbounce",
      createdAt: 1,
    }),
  );
  expect(
    await t.mutation(api.suppressions.remove, {
      channel: "email",
      address: " ALICE@EXAMPLE.TEST ",
    }),
  ).toBe(true);
  expect(
    (
      await t.query(api.suppressions.list, {
        channel: "email",
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).page,
  ).toEqual([]);
  expect(
    await t.mutation(api.suppressions.remove, {
      channel: "email",
      address: "alice@example.test",
    }),
  ).toBe(false);
  await expect(
    t.mutation(api.suppressions.remove, {
      channel: "email",
      address: "not-an-email",
    }),
  ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
});

test("suppressions are listed and removed per channel with channel-specific normalization", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const [channel, address] of [
      ["sms", "919876543210"],
      ["whatsapp", "+919876543210"],
      ["email", "a@example.test"],
    ] as const)
      await ctx.db.insert("suppressions", { channel, address, reason: "dnd", createdAt: 1 });
  });
  const list = (channel: "sms" | "whatsapp" | "email") =>
    t.query(api.suppressions.list, { channel, paginationOpts: { numItems: 1, cursor: null } });
  expect((await list("sms")).page.map((row) => row.address)).toEqual(["919876543210"]);
  expect((await list("whatsapp")).page.map((row) => row.address)).toEqual(["+919876543210"]);
  // A different channel's representation of the same number never matches.
  expect(
    await t.mutation(api.suppressions.remove, { channel: "whatsapp", address: "9198 7654 3210" }),
  ).toBe(true);
  expect(
    await t.mutation(api.suppressions.remove, { channel: "whatsapp", address: "+919876543210" }),
  ).toBe(false);
  expect(
    await t.mutation(api.suppressions.remove, { channel: "sms", address: "+91 98765-43210" }),
  ).toBe(true);
  expect((await list("email")).page).toHaveLength(1);
  for (const channel of ["sms", "whatsapp"] as const)
    await expect(
      t.mutation(api.suppressions.remove, { channel, address: "12" }),
    ).rejects.toMatchObject({ data: { code: "ZOHO_CPAAS_VALIDATION_FAILED" } });
});
