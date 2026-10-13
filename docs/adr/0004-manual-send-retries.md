# ADR 0004: Own channel-aware retries

Enqueue workpool actions with `retry: false`. Completion schedules at most five total attempts with exponential backoff and bounded `Retry-After`. Email retries network failures, 429, 5xx, and recognized daily-limit errors unless classification forbids retry. A lost email response can cause a duplicate email; idempotency keys prevent duplicate component jobs, not duplicate provider sends.

SMS and WhatsApp retry only explicit 429 or 503 rejections carrying a code in the package’s known Zoho code lists. Unrecognized 5xx body codes cannot establish a definitive rejection. Transport failures without a response record `unknown` and are never automatically resent for those channels. A later signed webhook resolves `unknown`; completion cannot overwrite a delivery with transport uncertainty. Stuck actions also record `unknown`. Suppressions and the effective SMS India endpoint are rechecked transactionally before every attempt.

Caught action failures before `fetch` starts are definitive failures; the same idempotency key can create a new send. Failures after the request may have reached Zoho remain uncertain.
