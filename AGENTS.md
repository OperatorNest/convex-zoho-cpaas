The package is `@operatornest/convex-zoho-cpaas`, component name `zohoCpaas`.

## Scope

Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [ADRs](docs/adr/), and `example/convex/_generated/ai/guidelines.md` before changing behavior. Public vocabulary and lifecycle states are defined in [Concepts](README.md#concepts). Preserve unrelated work and keep credentials and scratch files outside the repository. Publish, push, deploy and registry submissions require explicit authorization.

Trace behavior through `src/client/`, `src/component/`, `src/shared/`, `example/convex/`, tests and smoke. Update README for public behavior and an ADR for significant decisions. Before 1.0, breaking changes ship without compatibility aliases or migrations. Add one changeset line per consumer-visible change, with breaking changes first. Name tests for behavior and put them in the covered module’s test file.

## Runtime and security boundaries

Authored `src/` runs in Convex V8 with `fetch` and WebCrypto; no Node built-ins, `Buffer`, `process` or `"use node"`. Keep `convex` and `convex-helpers` as peers; workpool is the sole runtime dependency.

Read credentials through generated component `env`, bound from app env by reference, and parse configuration through `readConfig(env)`. Never accept credentials as arguments or store or log them. Any malformed env value raises `ZOHO_CPAAS_NOT_CONFIGURED`; unset retention uses 30 days. Test mode requires client `testMode: true` or env `ZOHO_CPAAS_TEST_MODE === "true"`. Missing live-channel credentials fail closed. App functions own authentication and authorization; example wrappers are internal.

Verify `producer-signature` over Zoho’s URL-decoded body before applying events. Missing signing keys fail closed. Deduplicate event IDs and body hashes in the transaction that applies events and invokes the callback. Signed event timestamps enforce the replay bound after receipt expiration; read them only from documented fields, and store a body without one as a `stale_event` failed receipt. Zoho documents no WhatsApp event-time field, so WhatsApp webhooks are rejected until a captured live payload names one; one attended live capture qualifies webhooks.

Recheck suppressions and the effective channel endpoint inside every attempt’s `begin` mutation. Transport uncertainty is `unknown`. WhatsApp delivered, read and failed events and email bounce and complaint events resolve it; nothing resolves an unknown SMS. Never automatically resend unknown or still-sending SMS or WhatsApp outcomes.

Caller errors and stored send errors use the fixed catalog in `src/shared/errors.ts`, without provider descriptions or bodies. Create errors only with `zohoCpaasError`; messages match their code exactly. Provider and network errors always pass `retryable` explicitly, and no other code carries it. Tests assert errors with `expectZohoCpaasError` from `src/test-helpers.ts`, never `rejects.toMatchObject`.

## Query and validator patterns

Public registered functions declare `args` and `returns`. Share validators, name each exported validator `<concept>Validator`, and infer types; use `schema.doc("messages")` for documents. Only named provider `raw` passthrough may use `v.any()`; never index it. Export each status union and document exported client methods and types with one domain sentence.

Use indexed bounded reads and `paginator` with the shared `boundedPage` and `paginationResultValidator` returns: 1–100 items, server `maximumRowsRead` and `maximumBytesRead` even with `endCursor`, malformed cursor raising `ZOHO_CPAAS_INVALID_ARGUMENT`. No built-in component `.paginate()`, unbounded `.collect()`, query wall-clock reads, non-null assertions or caller-object spreads into component arguments. Index names list every field in order joined by `_and_`. Provider-operation rows store `testMode`.

Methods belong to `email`, `sms`, `whatsapp`, `messages`, `suppressions`, `files` or `config` and call only the same-named component module. Group methods take `(ctx, args)`, except `config.get(ctx)`, which takes only `ctx`, and never repeat the group noun; uploads use `files.upload`. Only the constructor and `registerRoutes` are class methods; helpers without component calls are standalone named exports. Copy each declared argument explicitly. Component row IDs name their entity; Zoho IDs name their provider and entity. Durations name their unit and timestamps end in `At`.

Comments state only an invariant, bound or external constraint that code cannot express, except required public TSDoc.

## Generated files

Never edit generated bindings by hand. After schema or function changes run `pnpm build:codegen`, retain tracked generated changes, and reread the generated guide before further Convex changes. `dist/` stays ignored.

## Toolchain and verification

Use Node 24 and pnpm 12.9.1 from `.mise.toml`; run commands through `mise exec`. TypeScript enables `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`; `exactOptionalPropertyTypes` is off because `convex-helpers` ships incompatible TypeScript source, and must be rechecked on every upgrade. Coverage floors may hold or rise, never fall.

| Change                            | Required checks                                                        |
| --------------------------------- | ---------------------------------------------------------------------- |
| Component, schema, shared runtime | `pnpm build:codegen`, `pnpm test`, `pnpm typecheck`, `pnpm smoke`      |
| Client or exports                 | `pnpm build`, `pnpm typecheck`, affected tests, `pnpm test`            |
| Tooling or repository rules       | `pnpm check`                                                           |
| Markdown only                     | `pnpm fmt:check`                                                       |
| Executable docs                   | Formatting and affected example/client tests; smoke for runtime claims |

Tests use dummy env with `vi.stubEnv`, stub `fetch`, and restore env, globals and timers. Report simulator, anonymous local runtime and observed provider results separately. Simulator checks do not prove env bindings or live-account behavior. Smoke uses the shared local-backend lock and no login. `scripts/smoke-harness.mjs` is a shared byte-identical file that builds, copies the package into a temporary workspace and starts the backend; `scripts/smoke.mjs` holds only this component's domain steps.

Never read or edit `.env.e2e` during routine work. Never run interactive `pnpm e2e` in CI or as a routine check. An attended maintainer session starts with the documented `--dry-run`. Report commands and exit codes; label checks not run.
