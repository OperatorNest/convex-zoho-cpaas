# Working in this repository

## Scope

Read `README.md`, `CONTRIBUTING.md`, and the ADRs in `docs/adr/` for supported behavior and decisions.

Read `example/convex/_generated/ai/guidelines.md` for official Convex API guidance. The runtime and dependency rules below apply to this package.

The component records one message per recipient, queues durable workpool sends, verifies signed webhooks inside the component, and retains delivery events and suppressions. Email is the stable API; template-only SMS and WhatsApp are experimental. Trace a change through app client, component function, shared validator, schema, example, tests, and smoke.

| Path              | Responsibility                                                       |
| ----------------- | -------------------------------------------------------------------- |
| `src/component/`  | Component config, schema, functions, and generated bindings.         |
| `src/client/`     | Typed app-side client and webhook route registration.                |
| `src/shared/`     | Runtime-neutral validation, provider mapping, crypto, and errors.    |
| `src/test.ts`     | `register(t)` for consumers using `convex-test`; registers workpool. |
| `example/convex/` | Minimal installed app and test harness.                              |
| `scripts/`        | Local lock, anonymous-backend smoke, and e2e-env loader.             |
| `docs/`           | Self-contained component decisions in ADRs.                          |

Read the contributor guides in `.agents/skills/` when relevant to the change.

## Runtime and security boundaries

- Component code runs in Convex's default V8 runtime. Use platform `fetch` and WebCrypto; do not use `"use node"`, Node built-ins, `Buffer`, or `process` in authored `src/` files.
- Keep `convex` and `convex-helpers` as peers. The only runtime dependency is `@convex-dev/workpool`; it provides durable sends.
- Declare credentials in component env and bind app env values by reference. Read through generated `env`, never caller arguments or database rows. Do not log credential values, provider response bodies, or recipient data.
- Verify the `producer-signature` over Zoho's URL-decoded body in the component with constant-time comparison. Fail closed when secrets are missing. Deduplicate by event ID and body hash before applying state or invoking the app callback in the same transaction.
- Test mode is opt-in (`testMode: true` or `ZOHO_CPAAS_TEST_MODE === "true"`). Missing credentials without opt-in raise `ZOHO_CPAAS_NOT_CONFIGURED`. Never use real credentials in tests or examples.
- Every public function, including example functions, declares `args` and `returns`. Keep provider-controlled `raw` passthrough unindexed.

Bad: pass a channel token in a public `send` argument or trust a webhook's status before signature verification. Good: bind the app env by reference, read generated component `env`, verify `producer-signature`, then apply the event transactionally.

## Query and validator patterns

Use indexes and bounded reads. For example, messages by recipient use `by_to_and_createdAt`; pages use `paginator` from `convex-helpers/server/pagination`. Do not call built-in `.paginate()` in a component or read `Date.now()` in a query. The schema's document validator is `schema.doc("messages")`; share validators and infer types from them instead of duplicating unions. Example:

```ts
export const getMessage = query({
  args: { messageId: v.id("messages") },
  returns: v.union(schema.doc("messages"), v.null()),
  handler: (ctx, { messageId }) => ctx.db.get("messages", messageId),
});
```

Avoid unbounded `.collect()`, large `Promise.all` fan-outs in mutations, non-null assertions, `v.any()` except named `raw*` provider passthrough, and plain `Error` on user-reachable paths. Errors use the `ZOHO_CPAAS_` code prefix and the factory in `src/shared/errors.ts`.

## Generated files

The `src/component/_generated/` and `example/convex/_generated/` bindings are generated output, excluded from authored-source lint rules. Edit their schema/function inputs, regenerate, review the diff, and commit changed tracked generated output with the source change. `dist/` remains ignored build output.

Never edit `src/component/_generated/` or `example/convex/_generated/` by hand. `pnpm build:codegen` runs component codegen, package build, then example codegen under the shared anonymous-backend lock. On a fresh checkout, initialize a local anonymous deployment when needed with `CONVEX_AGENT_MODE=anonymous pnpm exec convex init`. The generated guide may change after codegen; reread it before Convex edits.

## Environment and test behavior

The consuming app binds `ZOHO_CPAAS_REGION`, optional base URL, shared or channel tokens, current/previous webhook secrets, retention days, and test mode to the component. `convex-test` simulates component env from the test process; it does not prove `defineApp` bindings or a live Zoho account. Tests use dummy env via `vi.stubEnv`, stub `fetch`, and restore environment and fake timers after each test.

For a maintainer-run end-to-end test with their own provider test account and keys, never CI, copy `.env.e2e.example` to gitignored `.env.e2e`, fill in the deployment and `E2E_*` inputs, and run `pnpm e2e --dry-run` before `pnpm e2e`. The maintainer-only runner requires an existing anonymous local deployment, holds the shared lock, uses a quick tunnel, and prompts for dashboard configuration before real sends. It captures requests through the example's session-gated `/zoho-cpaas/e2e-webhook` route, saves redacted fixtures, and removes temporary raw captures; scheduled expiry is 30 minutes if interrupted. `pnpm e2e:env` still loads only accepted component env names and removes test mode. Do not read or edit `.env.e2e` during routine work or run `pnpm e2e` in CI. Report local simulation, local real runtime, and observed live-provider evidence separately.

## Toolchain

Use `.mise.toml` and `packageManager` versions; run `mise trust && mise install`, then `mise exec -- pnpm ...` if global pnpm differs. Node 26 and pnpm 12.9.1 are for development; consumer Node compatibility remains `>=22.19.0`. Preserve the TS 6/7 aliases, type-aware Oxlint with the Convex JS plugin, oxfmt, and the shared pnpm supply-chain settings. `.oxlintrc.json` only adds the documented `__onx_ref` exception.

## Verification by change type

Start with affected tests and formatting, then run the required gate. `pnpm build:codegen` and `pnpm smoke` start or use the anonymous local backend under the shared lock; they cost more than `pnpm test` or `pnpm fmt:check`. Do not run interactive `pnpm e2e` as a routine check; use its documented `--dry-run` first and require an attended maintainer-run session.

| Change                                         | Required checks                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Component functions, schema, or shared runtime | `pnpm build:codegen`, `pnpm test`, `pnpm typecheck`, `pnpm smoke`                            |
| Client behavior or exported package surface    | `pnpm build`, `pnpm typecheck`, affected client tests, `pnpm test`                           |
| Tooling or repository-wide rules               | `pnpm check` (includes `pnpm knip` and coverage)                                             |
| Prose-only Markdown                            | `pnpm fmt:check`                                                                             |
| Executable docs or API claims                  | `pnpm fmt:check`, affected example/client tests; `pnpm smoke` if runtime behavior is claimed |

`pnpm smoke` runs the example against an anonymous local Convex backend and covers sends, webhook status, suppression, pagination, and experimental channels. It holds the shared lock, discovers deployment endpoints, and can bootstrap in CI without a login. Report local simulation, real-runtime smoke, and live-provider evidence separately.

Coverage is a ratchet: the thresholds in `vitest.config.js` may hold or rise, never fall. `pnpm test` enforces the current floor; review threshold changes against the prior commit and add meaningful tests when coverage drops.

## Contribution boundaries

Keep changes scoped to this component and example. Public behavior changes require README updates; record significant decisions in an ADR. Never publish, push, deploy, or submit to the registry without explicit authorization. Preserve unrelated local work and report the checks actually run.
