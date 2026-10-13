# 0010: Scope idempotency keys and suppressions by test mode and bound every body read

An idempotency key and a suppression belong to one test mode. A simulated send never reaches a recipient, so a key or a suppression recorded in test mode must not replay or block a live send; the `sendJobs` index is `by_testMode_and_idempotencyKey` and the `suppressions` index is `by_testMode_and_channel_and_address`. `suppressions.list` and `suppressions.remove` resolve test mode like sends: the client option or `ZOHO_CPAAS_TEST_MODE`. Idempotency keys are 1 to 128 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`, the format shared by every component.

Every webhook body and provider response body is read through the shared `readBoundedText`, which returns `undefined` for an oversized or non-UTF-8 body without telling the two apart. The webhook route therefore answers 400 for both, and the component also bounds direct callers and returns `oversized_body`, which the route maps to 400. Provider requests set `redirect: "manual"` and treat a 3xx status as `ZOHO_CPAAS_INVALID_RESPONSE`; a send that receives one becomes unknown, because the request reached Zoho.

The route is registered only by the `ZohoCpaas` method `registerRoutes`, which forwards the constructor's `onEvent`; one registration path keeps one place that maps component reasons to HTTP status codes.

Pagination cursors contain at most the paginated index's declared field count plus two system values, `_creationTime` and `_id`. Shorter arrays are valid prefix bounds. Both `cursor` and `endCursor` follow the same bound: four values for message and event indexes, five for suppressions.

Every shared or channel token passes `readSecret` before provider-prefix normalization. Empty, padded or ill-formed Unicode values raise `ZOHO_CPAAS_NOT_CONFIGURED`; normalization cannot repair malformed env.

Cleanup shares an 8 MiB event-read budget across expired-event and linked-event queries. Convex's 1 MiB maximum stored document size bounds each event, so the budget permits eight event reads per transaction, independently of the 200-candidate budget. Filling either budget schedules a continuation. A message remains until all of its linked events are deleted.
