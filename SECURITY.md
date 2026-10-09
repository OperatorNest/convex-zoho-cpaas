# Security

Report a suspected vulnerability through [GitHub private vulnerability reporting](https://github.com/OperatorNest/convex-zoho-cpaas/security/advisories/new) or email [operatornest+security@gmail.com](mailto:operatornest+security@gmail.com). Include the affected version or revision, the send, webhook, component-env, or data-retention path, a minimal reproduction, and the potential impact. Remove credentials, message contents, recipient addresses, and personal data from the report.

Please avoid public issue or pull-request disclosure until maintainers can assess and coordinate a fix. Zoho CPaaS send tokens and webhook secrets belong in Convex component environment variables bound from the app, never in function arguments, database rows, tests, or logs. The component verifies webhooks before applying events; the consuming app remains responsible for authenticating and authorizing its own functions before calling this component.
