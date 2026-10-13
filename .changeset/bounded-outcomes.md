---
"@operatornest/convex-zoho-cpaas": minor
---

Harden sends, webhook correlation, argument boundaries, and local runtime tooling.

Breaking changes:

- Handle the new `unknown` message status for network failures, worker crashes, and stuck sends. Email retries may send duplicates; SMS and WhatsApp unknown outcomes are never automatically resent. Canceling an email awaiting retry sets `canceledAt` and stops later attempts while its status remains `unknown` until a webhook resolves it.
- Read errors as `{ code, message, providerStatus?, providerCode? }`. Messages are fixed per code. Provider rejection codes move to `providerCode`; stored `class`, `subCode`, and `retryable`, and thrown `retryable`, are removed. Use `ZOHO_CPAAS_PROVIDER_REJECTED` for provider rejection.
- Request 1–100 items per page with valid scalar-array Convex-helper cursors of at most 4096 characters. Caller read limits cannot expand the server limit, including with `endCursor`. Malformed message IDs raise the package validation error.
- Keep complete encoded send payloads within 256 KiB, idempotency keys within 200 characters, template keys and WhatsApp agent IDs within 200, and template aliases within 100. Upload larger media separately.
- Set test mode through the client constructor or component env; undeclared caller fields are no longer forwarded to component functions.
- Expect suppressions and the effective SMS India endpoint to be checked again at each attempt, including simulation. Configuration changes can terminate queued sends before a provider request.
- Expect conflicting webhook identifiers or recipients to remain unresolved. Client-reference indexes now include channel and recipient, and the job/status index includes `canceledAt`; regenerate component bindings for the changed schema and validators. Stored email senders and WhatsApp senders use normalized addresses.
- Use the test helper without Vitest `test.server.deps.inline`; it imports workpool’s TypeScript test entry directly so Vitest transforms both components.
- Consumers require Node 24 or newer. The example status query is internal; invoke it from authorized server functions or the local CLI.

- Treat SMS and WhatsApp 5xx responses with unrecognized body codes as unknown outcomes; only known Zoho codes permit definitive 5xx failure or a 503 retry.
- Require usable signed-body event timestamps within receipt retention minus one day and five minutes of future skew; expired, missing, or unusable timestamps return invalid signature without a receipt.
- Deduplicate only committed webhook bodies; failed receipts cannot block later valid delivery of the same body. Receipt indexes now include `reason`; regenerate component bindings.
- Match each webhook event against message identifiers and state written by earlier events in the same transaction.
- Treat caught action failures before the HTTP request starts as definitive failures, permitting a new send with the same idempotency key.
- Receive non-package send errors unchanged instead of a package validation error.
