---
"@operatornest/convex-zoho-cpaas": minor
---

- Breaking: require the `convex-helpers` peer at `^0.1.128`.
- Breaking: `ZOHO_CPAAS_PROVIDER_ERROR` and `ZOHO_CPAAS_NETWORK_ERROR` always carry `retryable`, including the stored error of a stuck send; `isZohoCpaasError` rejects those codes without `retryable`, rejects unknown fields, and accepts any well-formed `providerCode` of at most 64 characters.
- Limit each page read to 1 MiB in addition to `numItems + 1` rows, so a page of large rows can hold fewer than `numItems` items.
- Depend on `@convex-dev/workpool` through the `^0.4.13` range instead of an exact version.
