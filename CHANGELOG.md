# @operatornest/convex-zoho-cpaas

## 0.3.0

### Minor Changes

- d8dab46: - Breaking: move channel sends to `email`, `sms` and `whatsapp` component modules, remove `experimental`, and move uploads to `files.upload`.
  - Breaking: use `htmlbody` and `textbody` for inline email content and `zohoMessageId`, `zohoRequestId`, `zohoEventId` and `zohoAgentId` for provider identifiers.
  - Breaking: rename stored reads to `messages.get` and `messages.list`, and return `ZOHO_CPAAS_NOT_FOUND` for missing referenced messages.
  - Breaking: normalize stored email `from` addresses to trimmed lowercase and stored WhatsApp `from` numbers to `+` followed by country-code digits; update consumers that compare stored senders with the original input.
  - Breaking: export `ZOHO_CPAAS_ERROR_CODES`, `ZohoCpaasErrorCode`, `ZohoCpaasErrorData` and `isZohoCpaasError`, with fixed messages and `retryable` exactly on provider and network errors.
  - Breaking: remove `ZohoCpaasMessageErrorCode` and stored error fields `class` and `subCode`; use `ZohoCpaasErrorCode`, `retryable`, `providerStatus` and `providerCode` from the unified error shape.
  - Breaking: replace validation, configuration, provider rejection and unusable-success codes with `ZOHO_CPAAS_INVALID_ARGUMENT`, `ZOHO_CPAAS_NOT_CONFIGURED`, `ZOHO_CPAAS_PROVIDER_ERROR` and `ZOHO_CPAAS_INVALID_RESPONSE`; uploads distinguish provider, network and response failures.
  - Breaking: reject malformed component env values, including retention days, instead of selecting a default; unset retention remains 30 days.
  - Breaking: require stored `testMode`, rename provider identifier fields and indexes, and replace the stored error shape; existing 0.2.0 rows can fail schema validation on push. Before upgrading, clear the component's `messages`, `events`, `webhookReceipts` and `suppressions` tables together with their dependent `sendJobs`, or remove and re-add the component; no migration is provided. Regenerate bindings after upgrading.
  - Breaking: preserve `unknown` outcomes until signed webhooks resolve them; no channel automatically resends transport uncertainty.
  - Breaking: bound pages to 1–100 items and encoded send payloads to 256 KiB, reject malformed cursors and identifiers, and require client or env test-mode opt-in.
  - Breaking: require usable signed-body event timestamps within receipt retention minus one day and five minutes of future skew; deduplicate only committed receipts.
  - Breaking: require Node 24 or newer and keep example functions internal for app authorization.
  - Export sender resolution as `resolveEmailFrom` and document all client methods, types, statuses, configuration and errors.
  - Recheck suppressions and the effective SMS India endpoint before every attempt, and preserve conflicting webhook envelopes as unresolved.
  - Match events against identifiers and state written earlier in the same transaction; callback failures roll back receipt and event writes.
  - Permit a new idempotent send after a definitive failure before the HTTP request starts, and rethrow non-package send errors unchanged.
  - Register component and workpool tests through the package helper without a Vitest dependency-inlining override.
- 72bf7c9: - Breaking: move the configuration read from `messages.status(ctx)` to `config.get(ctx)`, replace component `messages.status` with `config.get`, and report `configured` per channel as `{ email, sms, whatsapp }`; export `configurationValidator`.
  - Breaking: component `webhooks.receive` returns `{ reason }` without `duplicate`; `reason: "duplicate"` identifies an already committed body.
  - Breaking: apply only the webhook events whose signed event time is within the replay bound, and store a correctly signed body with no such event as a `stale_event` failed receipt that returns 200 and applies nothing; WhatsApp webhooks are rejected, and WhatsApp delivered, read and failed transitions stay inactive, until a captured payload names an event-time field.
  - Breaking: read webhook event time only from `event_data[].details[].time` or `email_info.processed_time`, accept object or array `event_data` and `details`, read epoch numbers below 1e12 as seconds, and accept string times only as ISO 8601 with `Z` or a numeric offset.
  - Breaking: remove `ZOHO_CPAAS_WORKPOOL_ACTION_FAILED`, `ZOHO_CPAAS_RETRY_AFTER_TOO_LONG` and `ZOHO_CPAAS_STUCK`; outcome-less and stuck sends record `ZOHO_CPAAS_NETWORK_ERROR`, and a retry delay above 24 hours records `ZOHO_CPAAS_PROVIDER_ERROR`.
  - Breaking: send `files.upload` content as the raw request body with `Content-Type` set to `mimeType` and the file name in the `name` query, and reject malformed MIME types.
  - Breaking: correlate batch email events by request ID plus recipient, give every batch row the same client reference, and stop sending an injected merge field and top-level batch `merge_info`.
  - Breaking: allow `failed` only from queued, sending, accepted or unknown, so a late failure cannot overwrite a WhatsApp delivery or read.
  - Breaking: accept idempotency keys of 1 to 128 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`, and scope each key to test mode.
  - Breaking: scope suppressions to test mode; `suppressions.list` and `suppressions.remove` read the client's test mode, and a test-mode suppression no longer blocks a live send.
  - Breaking: remove the standalone `registerRoutes(http, component, options)`; register the route with `client.registerRoutes(http, { path? })`, which forwards the constructor's `onEvent`.
  - Breaking: the webhook route answers 400 for a body above 512 KiB or not well-formed UTF-8 and ignores a non-numeric `Content-Length`.
  - Breaking: invalid webhook signatures return HTTP 401 with a JSON `{ code, message }` error body instead of plain text.
  - Breaking: reject `ZOHO_CPAAS_WEBHOOK_SECRET` and `ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS` values with leading or trailing whitespace as `ZOHO_CPAAS_NOT_CONFIGURED` instead of trimming them.
  - Breaking: change the messages of `ZOHO_CPAAS_INVALID_ARGUMENT`, `ZOHO_CPAAS_INVALID_WEBHOOK_SIGNATURE` and `ZOHO_CPAAS_NETWORK_ERROR`.
  - Breaking: provider requests do not follow redirects; a 3xx response raises `ZOHO_CPAAS_INVALID_RESPONSE` for an upload and leaves a send unknown with that error.
  - Read provider response bodies up to 64 KiB.
  - Rename the retention cron to `cleanup`.
  - Read the webhook request ID from the event message before the payload.
  - Keep a live message's stored test mode when a reconciled event links to it while env test mode is on.
  - Mark an SMS or WhatsApp message left sending by an interrupted attempt as unknown instead of resending it.
  - Replay an idempotent send before checking provider configuration, so a removed token does not block it.
  - Raise non-retryable `ZOHO_CPAAS_NETWORK_ERROR` for an upload without a response and `ZOHO_CPAAS_PROVIDER_ERROR` with `providerStatus` for a failed upload with an unreadable body.
  - Derive the reported region from the endpoint host when `ZOHO_CPAAS_REGION` is unset.
  - Preserve package errors caught before the provider request, and record other caught pre-request failures as `ZOHO_CPAAS_INVALID_ARGUMENT`.
- 72bf7c9: - Breaking: require the `convex-helpers` peer at `^0.1.128`.
  - Breaking: `ZOHO_CPAAS_PROVIDER_ERROR` and `ZOHO_CPAAS_NETWORK_ERROR` always carry `retryable`, including the stored error of a stuck send; `isZohoCpaasError` rejects those codes without `retryable`, rejects unknown fields, and accepts any well-formed `providerCode` of at most 64 characters.
  - Breaking: reject a cursor or end cursor longer than its paginated index key: four values for message and event pages, five for suppression pages; shorter prefix cursors stay valid.
  - Breaking: mark uncertain uploads and sends non-retryable, including network failures, timeouts, 408 and 5xx; retry only transient 429 refusals, and never automatically resend unknown or still-sending email outcomes.
  - Breaking: reject padded or ill-formed Unicode shared and channel tokens as `ZOHO_CPAAS_NOT_CONFIGURED` before provider-prefix normalization.
  - Breaking: map the component's `oversized_body` reason to HTTP 400 in the client webhook route.
  - Reject signed WhatsApp bodies as `stale_event` even when they contain email timestamp fields, preserving messages until live qualification.
  - Bound cleanup event reads to 8 MiB across expired and linked events and schedule continuation when the event budget fills.
  - Limit each page read to 1 MiB in addition to `numItems + 1` rows, so a page of large rows can hold fewer than `numItems` items.
  - Depend on `@convex-dev/workpool` through the `^0.4.14` range instead of an exact version.

## 0.2.0

### Minor Changes

- bf6c404: The repository was re-created with a clean history; package code and API are unchanged from 0.1.1. The maintainer provider check is now `pnpm e2e`.

## 0.1.1

### Patch Changes

- Publish from GitHub Actions through npm trusted publishing, with signed npm provenance attestations. No API or behavior changes.

## 0.1.0

- Initial public-release candidate: durable transactional email sends, templates, batches, attachments and file-cache uploads across Zoho CPaaS regions; verified webhook processing with transactional callbacks, idempotency, suppression and retention; experimental SMS and WhatsApp template sends; explicit test mode and typed grouped client API.
