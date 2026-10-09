# Contributing

This component sends Zoho CPaaS transactional email, records provider events, and offers experimental template-only SMS and WhatsApp. Read [README](README.md) and [ADRs](docs/adr/) before changing public behavior.

Use the versions in `.mise.toml` and `package.json`:

```sh
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
CONVEX_AGENT_MODE=anonymous mise exec -- pnpm exec convex init
mise exec -- pnpm build:codegen
mise exec -- pnpm check
mise exec -- pnpm smoke
```

The anonymous local deployment does not require Convex login. `build:codegen` generates the component API, builds the package for the example's config import, and generates the example API. Do not edit generated files by hand. `pnpm check` includes formatting, build, type-aware lint, typecheck, Knip, and coverage thresholds. `pnpm smoke` exercises the real local Convex runtime.

For a bug report, provide the package, Convex, and Node.js versions, runtime, operation and channel, a minimal reproduction, expected result, and actual result. Remove credentials, API or webhook tokens, recipient addresses, message contents, phone numbers, and personal information from reports and logs. Security reports go through [private vulnerability reporting](https://github.com/OperatorNest/convex-zoho-cpaas/security/advisories/new).

Follow the [OperatorNest Code of Conduct](https://github.com/OperatorNest/.github/blob/main/CODE_OF_CONDUCT.md) and [support guidance](https://github.com/OperatorNest/.github/blob/main/SUPPORT.md).

## End-to-end testing

A maintainer runs `pnpm e2e --dry-run` after preparing gitignored `.env.e2e` from `.env.e2e.example`. The dry run prints required missing names, optional groups present, the wait length, and the plan; it makes no network calls. Fill `E2E_EMAIL_FROM` with an address on their own Zoho-verified domain and `E2E_EMAIL_TO` with an inbox they control. Optional inputs enable template, second batch recipient, hard bounce, WhatsApp, and India-only SMS checks. The existing anonymous local Convex deployment must already be configured. Do not use a cloud deployment.

A maintainer runs `pnpm e2e` or `pnpm e2e -- --wait 15` from this repo. The runner holds the shared local lock, builds, starts local `convex dev`, replaces the component deployment env with values from `.env.e2e`, removes test mode, and starts a Cloudflare quick tunnel. It prints a boxed webhook URL. In Zoho CPaaS, go to **Agents (Mail Agent) → choose Agent → Webhooks → Configure Webhook**; enter the URL and a description, select **Soft bounced, Hard bounced, Open, Click, Feedback loop** (plus WhatsApp Delivered, Read, Undelivered when testing WhatsApp), and select **Add**. In the Webhooks tab, use the separate top-right **Authentication Key** control, enter the **value** of `ZOHO_CPAAS_WEBHOOK_SECRET` from `.env.e2e`, and select **Configure**. Press Enter in the runner only after both are saved. Open the tracked email and click its link while the countdown runs. The dashboard's **Send Test** is not evidence of a real tracked delivery.

The runner sends through the example app/client, then checks provider acceptance, signed webhook receipt, event mapping, callback correlation, local replay deduplication, and optional hard-bounce suppression. It writes redacted fixtures to `tests/fixtures/e2e/` and a dated observation report. On a fully verified email journey, it updates the README verification line with the observation report. Exact provider response envelopes remain unqualified because the component stores mapped results. The temporary example capture route is active only during the session, rejects requests after its 64-attempt quota, and reports quota exhaustion as a failed run. Raw attempts expire after 30 minutes and are cleared on normal exit. Do not run this maintainer workflow in CI, and never commit an unreviewed fixture or a `.env.e2e` file.

`pnpm e2e:env` remains available to load accepted component env names without making provider calls. It does not verify a live account. Keep provider results separate from local and simulated checks.

## Releasing

Add a changeset for a user-visible change with `pnpm changeset`. A maintainer runs `pnpm changeset version` on a version branch, then merges the version change through a PR. The Release workflow publishes an unpublished `package.json` version through npm trusted publishing after CI and smoke pass on that commit. Pushing, publishing, deploying, and registry submissions require explicit maintainer authorization.

The end-to-end test is a maintainer-run check with their own provider test account and keys. It is never run in CI.
