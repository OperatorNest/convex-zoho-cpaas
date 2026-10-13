# Security

## Reporting

Report vulnerabilities in `@operatornest/convex-zoho-cpaas` through the package repository’s Security tab (Report a vulnerability) or [operatornest+security@gmail.com](mailto:operatornest+security@gmail.com). Include the affected version, operation, code path, redacted reproduction and impact. Remove credentials, keys, endpoints, payloads, customer data and personal information. Keep exploit details private until maintainers coordinate disclosure.

The app authenticates and authorizes callers before invoking `ZohoCpaas`. Report paths that bypass those boundaries or disclose component credentials prefixed `ZOHO_CPAAS_`.

## Component boundaries

Bind credentials to component env. The component verifies signatures before applying webhook events; apps authenticate and authorize their own functions and restrict access to stored raw provider data. Rotate leaked signing keys. Committed-receipt deduplication lasts at least 30 days. Every event requires a timestamp in the signed body, no older than receipt retention minus one day and no more than five minutes in the future. Bodies outside that bound, or without usable event timestamps, fail as invalid signatures without a receipt; refreshing the unsigned header timestamp cannot bypass the bound.
