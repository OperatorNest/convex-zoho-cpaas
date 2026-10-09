import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";
import { register as registerWorkpool } from "@convex-dev/workpool/test";

const modules = import.meta.glob<Record<string, unknown>>([
  "./component/**/*.ts",
  "!./component/**/*.test.ts",
]);

export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name = "zohoCpaas",
) {
  t.registerComponent(name, schema, modules);
  registerWorkpool(t, `${name}/workpool`);
}
