# @operatornest/convex-zoho-cpaas

[![Release](https://github.com/OperatorNest/convex-zoho-cpaas/actions/workflows/release.yml/badge.svg)](https://github.com/OperatorNest/convex-zoho-cpaas/actions/workflows/release.yml) [![npm](https://img.shields.io/npm/v/@operatornest/convex-zoho-cpaas)](https://www.npmjs.com/package/@operatornest/convex-zoho-cpaas) [![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Zoho CPaaS messaging for Convex: durable transactional email, signed webhooks, per-recipient state, and experimental template-only SMS and WhatsApp.

**Verified against:** Provider account behavior has not yet been qualified against a Zoho CPaaS account. Token scopes, channel behavior, and provider response envelopes remain unconfirmed.

## Install

```sh
pnpm add @operatornest/convex-zoho-cpaas convex convex-helpers
```

`convex` and `convex-helpers` are peers. The package uses `@convex-dev/workpool` for durable sends; consumers do not mount its child component separately.

## Configure

Mount the component in `convex/convex.config.ts` and bind app environment values by reference so credentials remain in component env:

```ts
import zohoCpaas from "@operatornest/convex-zoho-cpaas/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    ZOHO_CPAAS_REGION: v.optional(
      v.union(
        v.literal("us"),
        v.literal("eu"),
        v.literal("in"),
        v.literal("au"),
        v.literal("jp"),
        v.literal("cn"),
      ),
    ),
    ZOHO_CPAAS_BASE_URL: v.optional(v.string()),
    ZOHO_CPAAS_TOKEN: v.optional(v.string()),
    ZOHO_CPAAS_EMAIL_TOKEN: v.optional(v.string()),
    ZOHO_CPAAS_SMS_TOKEN: v.optional(v.string()),
    ZOHO_CPAAS_WHATSAPP_TOKEN: v.optional(v.string()),
    ZOHO_CPAAS_WEBHOOK_SECRET: v.optional(v.string()),
    ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS: v.optional(v.string()),
    ZOHO_CPAAS_RETENTION_DAYS: v.optional(v.string()),
    ZOHO_CPAAS_TEST_MODE: v.optional(v.string()),
  },
});

app.use(zohoCpaas, {
  env: {
    ZOHO_CPAAS_REGION: app.env.ZOHO_CPAAS_REGION,
    ZOHO_CPAAS_BASE_URL: app.env.ZOHO_CPAAS_BASE_URL,
    ZOHO_CPAAS_TOKEN: app.env.ZOHO_CPAAS_TOKEN,
    ZOHO_CPAAS_EMAIL_TOKEN: app.env.ZOHO_CPAAS_EMAIL_TOKEN,
    ZOHO_CPAAS_SMS_TOKEN: app.env.ZOHO_CPAAS_SMS_TOKEN,
    ZOHO_CPAAS_WHATSAPP_TOKEN: app.env.ZOHO_CPAAS_WHATSAPP_TOKEN,
    ZOHO_CPAAS_WEBHOOK_SECRET: app.env.ZOHO_CPAAS_WEBHOOK_SECRET,
    ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS: app.env.ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS,
    ZOHO_CPAAS_RETENTION_DAYS: app.env.ZOHO_CPAAS_RETENTION_DAYS,
    ZOHO_CPAAS_TEST_MODE: app.env.ZOHO_CPAAS_TEST_MODE,
  },
});

export default app;
```

Run `pnpm exec convex codegen` after mounting. Set deployment values through Convex environment management, never through send arguments.

| Variable                                                                      | Purpose                                                                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ZOHO_CPAAS_REGION`                                                           | `us` (default), `eu`, `in`, `au`, `jp`, or `cn`.                                                            |
| `ZOHO_CPAAS_BASE_URL`                                                         | Optional HTTPS host override, including `.sa` and `.ca` legacy hosts.                                       |
| `ZOHO_CPAAS_TOKEN`                                                            | Shared Agent token, bare or with `Zoho-enczapikey` prefix.                                                  |
| `ZOHO_CPAAS_EMAIL_TOKEN`, `ZOHO_CPAAS_SMS_TOKEN`, `ZOHO_CPAAS_WHATSAPP_TOKEN` | Optional channel overrides of the shared token.                                                             |
| `ZOHO_CPAAS_WEBHOOK_SECRET`, `ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS`             | Current and previous webhook Authentication Keys.                                                           |
| `ZOHO_CPAAS_RETENTION_DAYS`                                                   | Terminal-record retention: `1`–`3650`, default `30`. Webhook receipts are kept at least 30 days regardless. |
| `ZOHO_CPAAS_TEST_MODE`                                                        | Test-mode opt-in only when exactly `true`.                                                                  |

## Quick start

Create the client from `components.zohoCpaas` inside your app. App functions own authentication and authorization. `defaultFrom` is optional when each send includes `from`.

```ts
import { ZohoCpaas } from "@operatornest/convex-zoho-cpaas";
import { v } from "convex/values";
import { components } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const cpaas = new ZohoCpaas(components.zohoCpaas, {
  defaultFrom: { address: "receipts@example.com", name: "Example" },
});

export const sendReceipt = internalMutation({
  args: { to: v.string(), idempotencyKey: v.string() },
  returns: v.array(v.string()),
  handler: (ctx, args) =>
    cpaas.email.send(ctx, {
      to: [{ address: args.to }],
      subject: "Your receipt",
      text: "Thanks for your order.",
      idempotencyKey: args.idempotencyKey,
    }),
});
```

Email `to`, `cc`, and `bcc` use `{ address, name? }`; `replyTo` uses the same flat shape. A single send permits at most 500 addresses in each recipient field. A batch permits at most 500 total recipients and sends one provider request. Batch `to` entries use `{ emailAddress: { address, name? }, mergeInfo? }`. Each accepted recipient, including cc/bcc, gets a message row. Partially suppressed sends retain suppressed rows; a request with no eligible recipient raises `ZOHO_CPAAS_ALL_SUPPRESSED`. Inline sends require `subject` and `html` or `text`; template sends require a `templateKey` or `templateAlias`.

Attachments use `{ name, mimeType?, content?, fileCacheKey? }`; base64 `content` requires `mimeType`. Inline images use `{ cid, mimeType?, content?, fileCacheKey? }` and HTML `cid:<cid>`. `email.uploadFile(ctx, { name, mimeType, content })` takes an `ArrayBuffer` and returns a file-cache key. Inline base64 data is capped at 256 KiB; upload accepts at most Zoho's documented 15 MB, subject to Convex transport limits. SMS and WhatsApp `mergeInfo` accepts JSON values nested up to three container levels, within a 256 KiB request cap.

## Webhooks

In Zoho CPaaS Agent settings, set a webhook URL ending in `/zoho-cpaas/webhook` and put its Authentication Key in `ZOHO_CPAAS_WEBHOOK_SECRET`:

```ts
import { registerRoutes } from "@operatornest/convex-zoho-cpaas";
import { httpRouter } from "convex/server";
import { components } from "./_generated/api.js";

const http = httpRouter();
registerRoutes(http, components.zohoCpaas);
export default http;
```

`registerRoutes(http, component, { path?, onEvent? })` takes a `path` of type `` `/${string}` `` and accepts an internal app mutation callback. The `ZohoCpaas` constructor can hold `onEvent`; then `client.registerRoutes(http, { path? })` forwards it. The exact callback argument type is exported as `ZohoCpaasEventArgs`. The component invokes it in the receipt/event apply transaction. A throw rolls state back and returns 500 so Zoho can redeliver; callback logic must be safe per event.

The route forwards raw body text and the `producer-signature` header. The component verifies base64 HMAC-SHA256 over Zoho's URL-decoded body using current or previous secret and constant-time comparison, then deduplicates by provider event ID and body hash. A missing or bad signature returns 401; missing secrets or callback failure return 500. A body above 512 KiB returns 413; malformed `Content-Length` or undecodable UTF-8 returns 400. A direct component `webhooks.receive` call returns only `{ reason, duplicate }`, including `reason: "oversized_body"` when its body exceeds the same limit. Correctly signed events, including unusable payloads stored as failed receipts, return 200. The parser accepts JSON and form-encoded JSON and limits expanded events to 500 and 256 KiB. The unsigned timestamp gets a 24-hour freshness window and five minutes of future skew.

## API reference

All client methods take `(ctx, args)` with an args object. Function references underneath use `components.zohoCpaas.<module>.<function>`. The constructor options are `{ testMode?: boolean, defaultFrom?: EmailAddress, onEvent?: FunctionReference_future<"mutation", "internal", ZohoCpaasEventArgs, null> }`.

| Client method                                                           | Component function              | Result                              |
| ----------------------------------------------------------------------- | ------------------------------- | ----------------------------------- |
| `email.send(ctx, args)`                                                 | `messages.send`                 | Message IDs for inline email.       |
| `email.sendTemplate(ctx, args)`                                         | `messages.sendTemplate`         | Message IDs for template email.     |
| `email.sendBatch(ctx, args)`                                            | `messages.sendBatch`            | Message IDs for one provider batch. |
| `email.sendTemplateBatch(ctx, args)`                                    | `messages.sendTemplateBatch`    | Message IDs for one template batch. |
| `email.uploadFile(ctx, args)`                                           | `files.uploadFile`              | File-cache key.                     |
| `experimental.sms.sendTemplate(ctx, args)`                              | `messages.sendSmsTemplate`      | One India DLT template message ID.  |
| `experimental.whatsapp.sendTemplate(ctx, args)`                         | `messages.sendWhatsappTemplate` | One template message ID.            |
| `messages.status(ctx)`                                                  | `messages.status`               | Configuration, test mode, region.   |
| `messages.get(ctx, { messageId })`                                      | `messages.getMessage`           | Message row or null.                |
| `messages.list(ctx, { recipient?, channel?, status?, paginationOpts })` | `messages.listMessages`         | Paginated messages.                 |
| `messages.listEvents(ctx, { messageId, paginationOpts })`               | `messages.listEvents`           | Paginated events.                   |
| `messages.cancel(ctx, { messageId })`                                   | `messages.cancel`               | Cancels queued message.             |
| `suppressions.list(ctx, { channel, paginationOpts })`                   | `suppressions.list`             | Paginated suppressions.             |
| `suppressions.remove(ctx, { channel, address })`                        | `suppressions.remove`           | Removes a normalized address.       |
| `registerRoutes(http, component, options?)`                             | `webhooks.receive`              | Registers verified webhook route.   |
| `client.registerRoutes(http, { path? })`                                | `webhooks.receive`              | Uses constructor callback.          |

List methods take Convex `paginationOpts: { numItems, cursor }` and use `paginator` from `convex-helpers/server/pagination`; wrap them with `convex-helpers/react`'s `usePaginatedQuery` in React apps. `messages.list` filters by exactly one of `recipient` or `status`. A `recipient` filter requires an explicit `channel` (`email`, `sms`, or `whatsapp`) and is normalized with that channel's rules, the same representation used on write (email lowercased, SMS digits only, WhatsApp `+` plus digits); the channel is never guessed from the address, and `channel` without `recipient` is rejected. Query WhatsApp as `channel: "whatsapp"` with or without a leading `+`, and SMS as `channel: "sms"` likewise. Email accepts optional cc/bcc/reply-to, tracking flags, `clientReference`, `mimeHeaders`, attachments, inline images, and `idempotencyKey`. There is no Zoho send idempotency header. The request digest is computed over key-sorted JSON, so argument key order never causes a false `ZOHO_CPAAS_IDEMPOTENCY_CONFLICT`. Local deduplication lasts only while the send-job ledger remains: within that window, a key may create a new job after every prior non-suppressed message definitively failed or was canceled (suppressed rows are ignored for this decision), while unknown outcomes stay deduplicated. After a finished job is swept at the retention cutoff, its key has no deduplication record; do not replay an old ambiguous send without first resolving its provider outcome. A batch uses reserved `__onx_ref` merge data for per-recipient references unless a caller supplies `clientReference`.

Root exports are limited to what an app needs: the `ZohoCpaas` class, `registerRoutes`, `isZohoCpaasError`, the types `Message`, `MessageEvent`, `Suppression`, `Channel`, `MessageStatus`, `EmailAddress`, `EmailAttachment`, `InlineImage`, `Region`, the send argument and option types, `ZohoCpaasEventArgs`, `ZohoCpaasErrorCode` and `ZohoCpaasMessageErrorCode`, and the validators `emailAddressValidator`, `attachmentValidator`, `inlineImageValidator`, `channelValidator`, `statusValidator`, `regionValidator` and `normalizedWebhookEventValidator`. Use the last to declare the `event` field of your `onEvent` callback arguments (`{ event: normalizedWebhookEventValidator, messageId: v.optional(v.string()), ambiguous: v.boolean() }`). Provider parsing, signature verification, and error classification are internal and not part of the public API. `MessageEvent.raw` is a provider passthrough diagnostic field; do not treat or index it as trusted state.

## Error codes

Errors are `ConvexError<{ code: ZohoCpaasErrorCode; message: string; retryable?: boolean }>`; `message` is sanitized and does not include secrets or provider bodies. Use `isZohoCpaasError(error)` to narrow them. Failures stored on message rows use a separate set of codes, listed under [Stored message error codes](#stored-message-error-codes).

| Code                              | Meaning                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| `ZOHO_CPAAS_VALIDATION_FAILED`    | Invalid send input, recipient, attachment, or webhook callback option. |
| `ZOHO_CPAAS_NOT_CONFIGURED`       | Channel token missing without test-mode opt-in.                        |
| `ZOHO_CPAAS_INVALID_CONFIG`       | Invalid token, base URL, or other component setting.                   |
| `ZOHO_CPAAS_UNSUPPORTED_REGION`   | Channel unavailable in the selected region.                            |
| `ZOHO_CPAAS_IDEMPOTENCY_CONFLICT` | Same idempotency key used with different request content.              |
| `ZOHO_CPAAS_ALL_SUPPRESSED`       | No eligible email recipient remains.                                   |
| `ZOHO_CPAAS_UPLOAD_FAILED`        | Provider file-cache upload failed.                                     |

### Stored message error codes

`message.error.code` (typed `string`) and `message.warning` hold per-message codes recorded by the send pipeline. They are never thrown. `ZohoCpaasMessageErrorCode` types the values the component itself writes plus the recognized Zoho codes; Zoho may return other well-formed codes, which are stored verbatim.

| Code                                    | Where                | Meaning                                                                      |
| --------------------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `ZOHO_CPAAS_STUCK`                      | `error.code`         | A send stayed `sending` for more than 24 hours; outcome is unknown.          |
| `ZOHO_CPAAS_WORKPOOL_ACTION_FAILED`     | `error.code`         | The send action crashed or timed out before reporting an outcome.            |
| `ZOHO_CPAAS_NETWORK_ERROR`              | `error.code`         | The request outcome is unknown (network failure or timeout).                 |
| `ZOHO_CPAAS_RETRY_AFTER_TOO_LONG`       | `error.code`         | Zoho asked for a retry delay longer than 24 hours; not retried.              |
| `ZOHO_CPAAS_NOT_CONFIGURED`             | `error.code`         | The channel token was unavailable when the job ran.                          |
| `ZOHO_CPAAS_INVALID_CONFIG`             | `error.code`         | The base URL or token configuration was invalid when the job ran.            |
| `ZOHO_CPAAS_UNSUPPORTED_REGION`         | `error.code`         | The configured region is not supported when the job ran.                     |
| `ZOHO_CPAAS_UNRECOGNIZED_SUCCESS_BODY`  | `warning` (accepted) | Zoho returned 2xx with an unexpected body; the send is treated accepted.     |
| Zoho codes such as `TM_4001`, `SMI_115` | `error.code`         | Provider rejection, with `error.class` and `error.retryable` classification. |

## Testing

Test mode is an explicit client option (`new ZohoCpaas(component, { testMode: true })`) or `ZOHO_CPAAS_TEST_MODE === "true"`. It creates `testMode: true` rows and synthetic provider identifiers without a Zoho call. Webhooks still need a signing secret. Without a channel token and opt-in, sends raise `ZOHO_CPAAS_NOT_CONFIGURED`.

Use the exported `register(t)` helper with `convex-test`; it registers the component and workpool child:

```ts
import { register } from "@operatornest/convex-zoho-cpaas/test";
import { convexTest } from "convex-test";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const t = convexTest(schema, modules);
register(t);
```

Stub `fetch`, use dummy `vi.stubEnv` values, and restore environment and fake timers in `afterEach`. Simulator tests do not prove component env binding or provider behavior. `pnpm smoke` exercises the anonymous local Convex runtime, including signed HTTP webhook and batch flows.

## Data retention

A daily cron processes at most 200 cleanup candidates per batch. Default terminal-record retention is 30 days. It clears terminal job provider payloads while retaining request digests until finished jobs are deleted at the configured retention cutoff, regardless of whether a failure outcome was unknown. It also deletes old events and webhook receipts (receipts use the larger of the configured retention and 30 days), and sweeps old provider-state rows without `terminalAt` by `createdAt`. Queued work stays pending. A `sending` attempt older than 24 hours becomes failed. Suppressions persist until an authorized app call removes them. Reads use bounded pages.

## Known limitations

- Live Zoho send and webhook capture have not validated token scopes, SMS and WhatsApp payload/status details, signature wire encoding, form field names, or exact event timestamps. The HMAC fixture validates the implementation's algorithm only.
- Zoho's signature does not cover a timestamp. A captured request can be replayed with a fresh timestamp during receipt retention; event ID and body hash deduplication suppress duplicate application. Receipts are kept for at least 30 days, even when `ZOHO_CPAAS_RETENTION_DAYS` is smaller. After receipt expiry, there is no cryptographic replay bound.
- SMS is India-only and requires DLT approval, sender association, and a pre-approved template. It has no webhook reconciliation and remains `accepted` after request acceptance. WhatsApp supports pre-approved Utility or Authentication templates; inbound, free-form, media, interactive, and batch sends are outside this component.
- Email has no delivered webhook. A successful send stays `accepted` unless a later failure event arrives; opens and clicks are events. Unknown multi-recipient webhook envelopes are retained as diagnostics rather than assigning one failure to all addresses.
- Per-recipient batch `__onx_ref` substitution, Zoho rate limits, 429 behavior, full 15 MB upload in Convex transport, and the `.sa`/`.ca` host behavior still need live-account qualification. Workpool concurrency is fixed at 10.

## Security notes

Authenticate and authorize app functions before calling the component. Keep credentials in component env, not args or tables. Webhook replay window: Zoho's signature does not cover a timestamp, so a captured, validly signed request can be resent. The component rejects stale unsigned timestamps (24 hours) and deduplicates by event ID and body hash for as long as the receipt exists, at least 30 days (`ZOHO_CPAAS_RETENTION_DAYS` values below 30 do not shorten receipt retention). Beyond that window a replay of an old body is not detectable; keep the webhook secret private and rotate it if it leaks. Treat raw webhook diagnostics as provider-controlled data and apply your data access policy before exposing them. Report issues through [private vulnerability reporting](https://github.com/OperatorNest/convex-zoho-cpaas/security/advisories/new); see [SECURITY.md](SECURITY.md).

## Development

Use `.mise.toml` for Node 26 and pnpm 12.9.1. `pnpm build:codegen` generates bindings and builds the package; `pnpm check` runs formatting, build, lint, typecheck, Knip, and coverage tests; `pnpm smoke` tests the anonymous real runtime. See [CONTRIBUTING.md](CONTRIBUTING.md). The maintainer-run `pnpm e2e` workflow uses gitignored `.env.e2e` for real provider sends and webhook qualification; start with `pnpm e2e --dry-run`. It is never run in CI. `pnpm e2e:env` only loads component env values.

## License

MIT. See [LICENSE](LICENSE).
