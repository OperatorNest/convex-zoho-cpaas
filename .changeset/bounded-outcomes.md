---
"@operatornest/convex-zoho-cpaas": minor
---

- Breaking: move channel sends to `email`, `sms` and `whatsapp` component modules, remove `experimental`, and move uploads to `files.upload`.
- Breaking: use `htmlbody` and `textbody` for inline email content and `zohoMessageId`, `zohoRequestId`, `zohoEventId` and `zohoAgentId` for provider identifiers.
- Breaking: rename stored reads to `messages.get` and `messages.list`, configuration reads to `messages.getConfig(ctx, {})` with a required empty argument object, and return `ZOHO_CPAAS_NOT_FOUND` for missing referenced messages.
- Breaking: export `ZOHO_CPAAS_ERROR_CODES`, `ZohoCpaasErrorCode`, `ZohoCpaasErrorData` and `isZohoCpaasError`, with fixed messages and `retryable` only on provider and network errors.
- Breaking: replace validation, configuration, provider rejection and unusable-success codes with `ZOHO_CPAAS_INVALID_ARGUMENT`, `ZOHO_CPAAS_NOT_CONFIGURED`, `ZOHO_CPAAS_PROVIDER_ERROR` and `ZOHO_CPAAS_INVALID_RESPONSE`; uploads distinguish provider, network and response failures.
- Breaking: reject malformed component env values, including retention days, instead of selecting a default; unset retention remains 30 days.
- Breaking: store effective `testMode` on all provider-operation rows and rename indexes with the provider identifier fields; regenerate bindings for the new schema.
- Breaking: preserve `unknown` outcomes until signed webhooks resolve them; SMS and WhatsApp never automatically resend transport uncertainty, and email retries may duplicate provider sends.
- Breaking: bound pages to 1–100 items and encoded send payloads to 256 KiB, reject malformed cursors and identifiers, and require client or env test-mode opt-in.
- Breaking: require usable signed-body event timestamps within receipt retention minus one day and five minutes of future skew; deduplicate only committed receipts.
- Breaking: require Node 24 or newer and keep example functions internal for app authorization.
- Export sender resolution as `resolveEmailFrom` and document all client methods, types, statuses, configuration and errors.
- Recheck suppressions and the effective SMS India endpoint before every attempt, and preserve conflicting webhook envelopes as unresolved.
- Match events against identifiers and state written earlier in the same transaction; callback failures roll back receipt and event writes.
- Permit a new idempotent send after a definitive failure before the HTTP request starts, and rethrow non-package send errors unchanged.
- Register component and workpool tests through the package helper without a Vitest dependency-inlining override.
