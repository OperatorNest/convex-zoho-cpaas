# ADR 0007: Bound webhook replay with signed event timestamps

Zoho signs the URL-decoded body, including event timestamps, but does not sign the header timestamp. Header freshness alone cannot prevent replay after a receipt expires.

Retain receipts for at least 30 days, or the configured retention when larger. Reject a body as an invalid signature when any event timestamp is older than receipt retention minus one day or more than five minutes in the future. Missing or unusable body timestamps are rejected because substituting receipt time would remove the replay bound. Rejection creates no receipt and applies no event. Cleanup and verification share the receipt retention calculation.

Only receipts from committed event transactions participate in provider-event-ID and body-hash deduplication. Failed receipts are indexed separately by `reason` and never block a later valid delivery. Message lookups reflect patches made by earlier events within the same transaction.
