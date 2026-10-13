# Security

## Reporting

Report vulnerabilities in `@operatornest/convex-zoho-cpaas` through the package repository’s Security tab (Report a vulnerability) or [operatornest+security@gmail.com](mailto:operatornest+security@gmail.com). Include the affected version, operation, code path, redacted reproduction and impact. Remove credentials, keys, endpoints, payloads, customer data and personal information. Keep exploit details private until maintainers coordinate disclosure.

The app authenticates and authorizes callers before invoking `ZohoCpaas`. Report paths that bypass those boundaries or disclose component credentials prefixed `ZOHO_CPAAS_`.

## Boundaries

Bind credentials to component env. The component verifies signatures before applying webhook events; apps authenticate and authorize their own functions and restrict access to stored raw provider data. Rotate leaked signing keys. Committed-receipt deduplication lasts at least 30 days. Every event requires a documented event time in the signed body, no older than receipt retention minus one day and no more than five minutes in the future. A correctly signed body outside that bound, or without a usable event time, is stored as a `stale_event` failed receipt that applies no event and invokes no callback; refreshing the unsigned header timestamp cannot bypass the bound.
