# Contributing

Read [README](README.md), [AGENTS.md](AGENTS.md), and [ADRs](docs/adr/) before changing behavior.

## Setup and checks

```sh
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
CONVEX_AGENT_MODE=anonymous mise exec -- pnpm exec convex init
mise exec -- pnpm build:codegen
mise exec -- pnpm check
mise exec -- pnpm smoke
```

Node 24 and pnpm 12.9.1 are pinned in `.mise.toml`. Codegen and smoke use an anonymous local deployment under a shared lock; no Convex login is needed. Do not edit generated bindings. `check` runs formatting, build, lint, typecheck, Knip, source invariants, and coverage floors. Component and shared runtime changes also require codegen and smoke.

## Change requirements

- Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
  (`feat:`, `fix:`, `docs:`, `test:`, `chore:`); a breaking change adds `!` after the type.
- Until 1.0.0, a breaking change ships without compatibility code, deprecation periods or data
  migrations; its changeset is a `minor` bump that states what breaks.

## Provider qualification

A maintainer prepares ignored `.env.e2e` from `.env.e2e.example` using their own account, verified sender domain, and recipient inbox. Run `pnpm e2e --dry-run` first; it reports input names without network calls. Optional inputs enable templates, batch recipients, hard bounce, WhatsApp, and India-only SMS. Use an existing anonymous local deployment.

`pnpm e2e` holds the shared lock, builds, starts local Convex and a quick tunnel, and loads component env without test mode. In Zoho's Agent webhook settings, configure the printed URL, select the tested events, and set the Authentication Key to the configured webhook secret. Press Enter after saving both settings. Open the email and click its link during capture. Dashboard **Send Test** does not prove tracked delivery.

The runner checks acceptance, signed events, mapping, callback correlation, replay deduplication, and optional suppression. It saves redacted fixtures and a dated report in `tests/fixtures/e2e/`; review them before committing. The session-gated capture route accepts at most 64 attempts. Raw captures are removed on exit or expire after 30 minutes. Do not run e2e in CI. `pnpm e2e:env` loads accepted env names without provider calls.

## Reports and releases

Bug reports include package, Convex, and Node versions, deployment type, operation, channel, reproduction, expected result, and actual result. Remove credentials, recipients, message content, and personal data. Send vulnerabilities through [private reporting](https://github.com/OperatorNest/convex-zoho-cpaas/security/advisories/new). Follow the [Code of Conduct](https://github.com/OperatorNest/.github/blob/main/CODE_OF_CONDUCT.md) and [support guidance](https://github.com/OperatorNest/.github/blob/main/SUPPORT.md).

Add one changeset for a user-visible change. A maintainer runs `pnpm changeset version` on a version branch and merges it through a PR. Release publishes an unpublished package version through npm trusted publishing after CI and smoke pass on that commit. Pushing, publishing, deploying, and registry submissions require explicit authorization.
