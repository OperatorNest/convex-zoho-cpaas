# 0006: Measure executable simulator coverage

Exclude only `src/component/convex.config.ts` and `src/component/crons.ts` from simulator coverage: `convex-test` does not evaluate mounting or cron registration. Statements remain at least 90% and branches at least 85%. Codegen and smoke exercise the mounted component on an anonymous local backend; retention handlers are tested directly. Smoke does not prove the daily cron fires.
