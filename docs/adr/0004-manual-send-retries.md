# ADR 0004: Channel-aware retries outside workpool

## Context

Workpool's automatic retry cannot distinguish a definitive rejection from an ambiguous provider outcome. Retrying an accepted SMS or WhatsApp request may send a duplicate to a person.

## Decision

Enqueue with `retry: false`. The completion handler classifies failures and re-enqueues email retryable errors with backoff, up to five attempts. SMS and WhatsApp retry only explicit 429 or recognized Zoho 503 errors; ambiguous network outcomes remain deduplicated and are not resent automatically.

## Consequences

The completion handler is declared with workpool's `defineOnComplete`, with the job reference and attempt as typed context. The component owns retry state and classification. Unknown outcomes require operator investigation rather than an automatic duplicate-risk send.
