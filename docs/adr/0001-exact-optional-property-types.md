# ADR 0001: Defer exact optional property types

`exactOptionalPropertyTypes` remains disabled because `convex-helpers` ships TypeScript source whose pagination and query-reflection types fail that check. `skipLibCheck` does not exclude imported `.ts` source. Keep `noImplicitOverride`, `noFallthroughCasesInSwitch`, and `noUncheckedIndexedAccess` enabled. Recheck the flag after upgrading `convex-helpers`; remove this ADR when typecheck passes.
