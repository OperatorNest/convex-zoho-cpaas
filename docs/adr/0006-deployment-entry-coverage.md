# ADR 0006: Exclude declarative deployment entries from simulator coverage

## Context

`convex-test` loads component functions but does not evaluate component mounting through `defineComponent`/`component.use` or the daily cron registration through `cronJobs`. The declarative entry files `src/component/convex.config.ts` and `src/component/crons.ts` therefore show zero simulator coverage even when their configuration is used by a real deployment.

## Decision

Exclude exactly those two files from Vitest V8 coverage. Keep all component handlers, validators, and shared runtime code in scope, with thresholds of at least 90% statements and 85% branches. `pnpm build:codegen` and `pnpm smoke` deploy the example to an anonymous local Convex backend and exercise the mounted component, environment bindings, queueing, and webhook paths.

## Consequences

Coverage percentages measure executable implementation rather than declarations the simulator cannot run. The smoke test validates deployment and the active paths, but does not wait 24 hours to prove the cron fires; retention handlers remain covered by tests.
