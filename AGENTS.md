# Repository rules

Read `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/adr/`, and the local `example/convex/_generated/ai/guidelines.md` before changing behavior. Keep private plans, reviews, credentials, and run state outside the repository. Preserve unrelated work. Publish, push, deploy, and registry submissions require explicit authorization.

## Boundaries

- Authored `src/` runs in Convex V8: use `fetch` and WebCrypto, with no Node built-ins, `Buffer`, `process`, or `"use node"`.
- Keep `convex` and `convex-helpers` as peers; workpool is the sole runtime dependency.
- Read credentials through generated component `env`, bound from app env by reference. Never accept credentials as arguments or store or log them.
- App functions own authentication and authorization. Example wrappers are internal.
- Verify `producer-signature` over Zoho's URL-decoded body before applying events. Missing signing keys fail closed. Deduplicate event IDs and body hashes in the transaction that applies events and invokes the callback.
- Recheck suppressions and the effective channel endpoint inside every attempt's `begin` mutation. Transport uncertainty is `unknown`; webhooks can resolve it. Never automatically resend unknown SMS or WhatsApp outcomes.
- Test mode requires `testMode: true` or `ZOHO_CPAAS_TEST_MODE === "true"`; missing credentials otherwise raise `ZOHO_CPAAS_NOT_CONFIGURED`.
- Public registered functions declare `args` and `returns`. Share validators and infer types; use `schema.doc("messages")` for documents. Only named provider `raw` passthrough may use `v.any()`; never index it.
- Use indexed bounded reads and `paginator` with `boundedPage`. No built-in component `.paginate()`, unbounded `.collect()`, query wall-clock reads, non-null assertions, or caller-object spreads into component arguments. Index names list every field in order joined by `_and_`.
- Caller errors and stored send errors use the fixed catalog in `src/shared/errors.ts`, without provider descriptions or bodies.

## Changes

Trace behavior through `src/client/`, `src/component/`, `src/shared/`, `example/convex/`, tests, and smoke. Update README for public behavior and an ADR for significant decisions. Comments may state only a non-obvious invariant, bound, or external constraint that names and types cannot express.

Never edit generated bindings by hand. After schema or function changes, run `pnpm build:codegen` and retain tracked generated changes. Reread the generated guide before further Convex changes. `dist/` stays ignored.

Use Node 24 and pnpm 12.9.1 from `.mise.toml`; run commands through `mise exec`. Coverage floors may hold or rise, never fall.

| Change                            | Required checks                                                        |
| --------------------------------- | ---------------------------------------------------------------------- |
| Component, schema, shared runtime | `pnpm build:codegen`, `pnpm test`, `pnpm typecheck`, `pnpm smoke`      |
| Client or exports                 | `pnpm build`, `pnpm typecheck`, affected tests, `pnpm test`            |
| Tooling or repository rules       | `pnpm check`                                                           |
| Markdown only                     | `pnpm fmt:check`                                                       |
| Executable docs                   | Formatting and affected example/client tests; smoke for runtime claims |

Tests use dummy env with `vi.stubEnv`, stub `fetch`, and restore env and timers. Report simulator, anonymous local runtime, and observed provider results separately. Simulator checks do not prove env bindings or live-account behavior. Smoke uses the shared local-backend lock and no login.

Never read or edit `.env.e2e` during routine work. Never run interactive `pnpm e2e` in CI or as a routine check. An attended maintainer session starts with the documented `--dry-run`. Report commands and exit codes; label checks not run.
