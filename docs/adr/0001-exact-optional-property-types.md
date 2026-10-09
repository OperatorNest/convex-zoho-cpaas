# ADR 0001: Defer exact optional property types

## Context

`exactOptionalPropertyTypes` checks omitted optional properties. With this flag enabled, TypeScript checks imported `convex-helpers@0.1.126/server/stream.ts` source under `node_modules`; `skipLibCheck` does not suppress diagnostics in that `.ts` source. The test-project typecheck with `--exactOptionalPropertyTypes` reports these representative diagnostics from `convex-helpers@0.1.126` source (the full pnpm store path is abbreviated):

```text
convex-helpers/server/stream.ts(445,5): error TS2375: Type '{ page: T[]; isDone: boolean; continueCursor: string; pageStatus: "SplitRecommended" | "SplitRequired" | undefined; splitCursor: string | undefined; }' is not assignable to type 'PaginationResult<T>' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
  Types of property 'splitCursor' are incompatible.
    Type 'string | undefined' is not assignable to type 'string | null'.
      Type 'undefined' is not assignable to type 'string | null'.
convex-helpers/server/stream.ts(670,3): error TS2416: Property 'reflect' in type 'StreamQueryInitializer<Schema, T>' is not assignable to the same property in base type 'StreamableQuery<Schema, T, "by_creation_time">'.
convex-helpers/server/stream.ts(720,3): error TS2416: Property 'reflect' in type 'StreamQuery<Schema, T, IndexName>' is not assignable to the same property in base type 'StreamableQuery<Schema, T, IndexName>'.
convex-helpers/server/stream.ts(754,3): error TS2416: Property 'reflect' in type 'OrderedStreamQuery<Schema, T, IndexName>' is not assignable to the same property in base type 'StreamableQuery<Schema, T, IndexName>'.
```

The TS2416 details show `indexRange: function | undefined` where the base `QueryReflection` requires a function. The errors occur in `.ts` source, so `skipLibCheck` does not hide them.

## Decision

Leave `exactOptionalPropertyTypes` disabled until compatible upstream source is available. Keep `noImplicitOverride`, `noFallthroughCasesInSwitch`, and `noUncheckedIndexedAccess` enabled. Do not patch `node_modules` or suppress these diagnostics.

## Consequences

Optional-property omission is not checked with this one strictness flag. Re-run typecheck with the flag on when upgrading `convex-helpers`; remove this ADR once it passes.
