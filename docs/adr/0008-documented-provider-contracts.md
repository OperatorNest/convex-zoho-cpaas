# 0008: Follow documented provider contracts

Every provider-facing format follows Zoho documentation until an attended live capture replaces it, and each test fixture states whether it is documented or captured.

`files.upload` follows the ZeptoMail File Cache Upload API: `content` is the raw request body, `Content-Type` is the validated `mimeType`, and the file name travels in the `name` query parameter. The format stays unqualified until one attended live upload.

Webhook events read `request_id` from the event message, else from the payload. Batch rows share one client reference, the first queued message ID unless the caller supplies one, and batch events correlate by request ID plus recipient address. Batch requests carry no injected merge field and no top-level `merge_info`. A single send to several addresses has one request ID, so a webhook without a recipient address stays unresolved; multi-recipient mail that needs per-recipient outcomes uses a batch send.

Configuration reads belong to the `config` group: client `config.get(ctx)` calls component `config.get`. Without `ZOHO_CPAAS_REGION`, the region derives from the endpoint host suffix, and an unrecognized host reports us.

The error catalog keeps one code per caller decision. A send action ending without an outcome and a send stuck in progress record `ZOHO_CPAAS_NETWORK_ERROR`, because the provider outcome is unknown. A retry delay above 24 hours records `ZOHO_CPAAS_PROVIDER_ERROR` without retry.
