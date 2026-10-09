/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cleanup from "../cleanup.js";
import type * as config from "../config.js";
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as messages from "../messages.js";
import type * as pool from "../pool.js";
import type * as sends from "../sends.js";
import type * as suppressions from "../suppressions.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  cleanup: typeof cleanup;
  config: typeof config;
  crons: typeof crons;
  files: typeof files;
  messages: typeof messages;
  pool: typeof pool;
  sends: typeof sends;
  suppressions: typeof suppressions;
  webhooks: typeof webhooks;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {
  workpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"workpool">;
};
