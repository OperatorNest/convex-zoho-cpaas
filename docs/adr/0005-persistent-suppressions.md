# ADR 0005: Persist suppression records

## Context

Retention must preserve recipient suppressions. Deleting a bounce or complaint suppression by age could resume sending to an address that the provider rejected or a recipient complained about.

## Decision

Keep suppression records until an authorized app operation explicitly removes them. The daily retention sweep handles messages, jobs, events, and receipts.

## Consequences

Suppression storage grows with distinct suppressed addresses. Apps must expose an authorized support path to inspect and remove a suppression where justified.
