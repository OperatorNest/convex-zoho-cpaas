# ADR 0002: No rate limiter

## Context

A configurable rate limiter needs a documented provider quota. Zoho has not published a send rate to configure against, and workpool already bounds sends.

## Decision

Do not mount a rate-limiter component. Use a fixed workpool parallelism of 10 and classify provider 429 responses with `Retry-After` for the retry policy.

## Consequences

Deployments cannot set a proactive provider quota through this component. Observed provider limits may require a later, evidence-based design change.
