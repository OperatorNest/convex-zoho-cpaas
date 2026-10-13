# 0007: Bound webhook replay with signed event timestamps

Zoho signs the URL-decoded body, including event timestamps, but does not sign the header timestamp. Header freshness alone cannot prevent replay after a receipt expires.

Retain receipts for at least 30 days, or the configured retention when larger. Reject a correctly signed body when any event time is missing, older than receipt retention minus one day, or more than five minutes in the future, because substituting receipt time would remove the replay bound. Rejection stores a `stale_event` failed receipt, applies no event, invokes no callback and returns 200, so Zoho neither redelivers nor disables the webhook.

Read event time only from documented fields: `event_data[].details[].time`, else `email_info.processed_time`. `event_data` and `details` may each be an object or an array. Epoch numbers below 1e12 are seconds, because read as milliseconds they would predate September 2001. Undocumented fields such as `occurred_at` and `timestamp` are never read. Zoho documents no WhatsApp event-time field, so WhatsApp webhooks are rejected until a captured live payload names one; one attended live capture qualifies webhooks. Cleanup and verification share the receipt retention calculation.

Only receipts from committed event transactions participate in provider-event-ID and body-hash deduplication. Failed receipts are indexed separately by `reason` and never block a later valid delivery. Message lookups reflect patches made by earlier events within the same transaction.
