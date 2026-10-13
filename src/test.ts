import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";
import { register as registerWorkpool } from "@convex-dev/workpool/test";

type Modules = Parameters<
  TestConvex<SchemaDefinition<GenericSchema, boolean>>["registerComponent"]
>[2];
type GlobImportMeta = ImportMeta & { glob(patterns: string[]): Modules };
const modules = (import.meta as GlobImportMeta).glob([
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
