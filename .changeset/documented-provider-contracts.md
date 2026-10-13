---
"@operatornest/convex-zoho-cpaas": minor
---

- Breaking: move the configuration read from `messages.getConfig(ctx, {})` to `config.get(ctx)`, backed by component `config.get`, and report `configured` per channel as `{ email, sms, whatsapp }`; export `configurationValidator`.
- Breaking: component `webhooks.receive` returns `{ reason }` without `duplicate`; `reason: "duplicate"` identifies an already committed body.
- Breaking: apply only the webhook events whose signed event time is within the replay bound, and store a correctly signed body with no such event as a `stale_event` failed receipt that returns 200 and applies nothing; WhatsApp webhooks are rejected, and WhatsApp delivered, read and failed transitions stay inactive, until a captured payload names an event-time field.
- Breaking: read webhook event time only from `event_data[].details[].time` or `email_info.processed_time`, accept object or array `event_data` and `details`, read epoch numbers below 1e12 as seconds, and accept string times only as ISO 8601 with `Z` or a numeric offset.
- Breaking: remove `ZOHO_CPAAS_WORKPOOL_ACTION_FAILED`, `ZOHO_CPAAS_RETRY_AFTER_TOO_LONG` and `ZOHO_CPAAS_STUCK`; outcome-less and stuck sends record `ZOHO_CPAAS_NETWORK_ERROR`, and a retry delay above 24 hours records `ZOHO_CPAAS_PROVIDER_ERROR`.
- Breaking: send `files.upload` content as the raw request body with `Content-Type` set to `mimeType` and the file name in the `name` query, and reject malformed MIME types.
- Breaking: correlate batch email events by request ID plus recipient, give every batch row the same client reference, and stop sending an injected merge field and top-level batch `merge_info`.
- Breaking: allow `failed` only from queued, sending, accepted or unknown, so a late failure cannot overwrite a WhatsApp delivery or read.
- Read the webhook request ID from the event message before the payload.
- Keep a live message's stored test mode when a reconciled event links to it while env test mode is on.
- Mark an SMS or WhatsApp message left sending by an interrupted attempt as unknown instead of resending it.
- Replay an idempotent send before checking provider configuration, so a removed token does not block it.
- Raise retryable `ZOHO_CPAAS_NETWORK_ERROR` for an upload without a response and `ZOHO_CPAAS_PROVIDER_ERROR` with `providerStatus` for a failed upload with an unreadable body.
- Derive the reported region from the endpoint host when `ZOHO_CPAAS_REGION` is unset.
- Record a caught failure before the provider request as `ZOHO_CPAAS_INVALID_ARGUMENT`.
