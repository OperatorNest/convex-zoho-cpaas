---
"@operatornest/convex-zoho-cpaas": minor
---

- Breaking: require the `convex-helpers` peer at `^0.1.128`.
- Breaking: `ZOHO_CPAAS_PROVIDER_ERROR` and `ZOHO_CPAAS_NETWORK_ERROR` always carry `retryable`, including the stored error of a stuck send; `isZohoCpaasError` rejects those codes without `retryable`, rejects unknown fields, and accepts any well-formed `providerCode` of at most 64 characters.
- Breaking: reject a cursor or end cursor longer than its paginated index key: four values for message and event pages, five for suppression pages; shorter prefix cursors stay valid.
- Breaking: mark uncertain uploads and sends non-retryable, including network failures, timeouts, 408 and 5xx; retry only transient 429 refusals, and never automatically resend unknown or still-sending email outcomes.
- Breaking: reject padded or ill-formed Unicode shared and channel tokens as `ZOHO_CPAAS_NOT_CONFIGURED` before provider-prefix normalization.
- Breaking: map the component's `oversized_body` reason to HTTP 400 in the client webhook route.
- Reject signed WhatsApp bodies as `stale_event` even when they contain email timestamp fields, preserving messages until live qualification.
- Bound cleanup event reads to 8 MiB across expired and linked events and schedule continuation when the event budget fills.
- Limit each page read to 1 MiB in addition to `numItems + 1` rows, so a page of large rows can hold fewer than `numItems` items.
- Depend on `@convex-dev/workpool` through the `^0.4.13` range instead of an exact version.
