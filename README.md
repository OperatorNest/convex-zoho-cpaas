# @operatornest/convex-zoho-cpaas

[![Release](https://github.com/OperatorNest/convex-zoho-cpaas/actions/workflows/release.yml/badge.svg)](https://github.com/OperatorNest/convex-zoho-cpaas/actions/workflows/release.yml) [![npm](https://img.shields.io/npm/v/@operatornest/convex-zoho-cpaas)](https://www.npmjs.com/package/@operatornest/convex-zoho-cpaas) [![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Zoho CPaaS messaging for Convex: durable transactional email, signed webhooks, per-recipient state, and experimental template-only SMS and WhatsApp.

**Verified against:** Provider account behavior has not yet been qualified against a Zoho CPaaS account. Token scopes, channel behavior, and provider response envelopes remain unconfirmed.

## Install

```sh
pnpm add @operatornest/convex-zoho-cpaas convex convex-helpers
```

`convex` and `convex-helpers` are peers. The component mounts its workpool child automatically.

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

Run `pnpm exec convex codegen` after mounting. App functions own authentication and authorization; credentials are component env bound by reference.

| Variable                             | Required                                    | Default         | Valid values                                                   |
| ------------------------------------ | ------------------------------------------- | --------------- | -------------------------------------------------------------- |
| `ZOHO_CPAAS_REGION`                  | No                                          | us              | us, eu, in, au, jp, cn                                         |
| `ZOHO_CPAAS_BASE_URL`                | No                                          | Region endpoint | HTTPS URL without credentials, query or fragment               |
| `ZOHO_CPAAS_TOKEN`                   | For live sends without a channel token      | None            | Nonblank Agent token, optionally prefixed with Zoho-enczapikey |
| `ZOHO_CPAAS_EMAIL_TOKEN`             | For live email without a shared token       | Shared token    | Nonblank Agent token                                           |
| `ZOHO_CPAAS_SMS_TOKEN`               | For live SMS without a shared token         | Shared token    | Nonblank Agent token                                           |
| `ZOHO_CPAAS_WHATSAPP_TOKEN`          | For live WhatsApp without a shared token    | Shared token    | Nonblank Agent token                                           |
| `ZOHO_CPAAS_WEBHOOK_SECRET`          | For webhooks unless the previous key exists | None            | Nonblank signing key                                           |
| `ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS` | No                                          | None            | Nonblank previous signing key                                  |
| `ZOHO_CPAAS_RETENTION_DAYS`          | No                                          | 30              | Integer string from 1 through 3650                             |
| `ZOHO_CPAAS_TEST_MODE`               | No                                          | false           | true or false                                                  |

Unset retention uses 30 days; malformed configuration raises `ZOHO_CPAAS_NOT_CONFIGURED`. Without `ZOHO_CPAAS_REGION`, the reported region comes from the endpoint host: `.eu`, `.in`, `.com.au`, `.jp` and `.com.cn` map to their regions, and every other host reports us. The client option can enable test mode and cannot disable env test mode. Zoho documents no live/test token prefix, so token contents never imply simulation.

## Quick start

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
      textbody: "Thanks for your order.",
      idempotencyKey: args.idempotencyKey,
    }),
});
```

Inline email requires `subject` and `htmlbody` or `textbody`. Templates require exactly one of `templateKey` and `templateAlias`. Attachments and inline images need base64 `content` with `mimeType`, or a `fileCacheKey`. Upload binary media with `files.upload(ctx, { name, mimeType, content })`; it follows the ZeptoMail File Cache Upload API by sending `content` as the raw request body to `/files?name=<name>` with `Content-Type` set to `mimeType`, and `mimeType` must be a `type/subtype` token of at most 255 characters.

Every requested email recipient gets a row, including suppressed recipients, when the request succeeds. Zoho reports one request ID for a single send, so a webhook naming only that request ID cannot identify a recipient when one send has several addresses; send mail that needs per-recipient outcomes with `email.sendBatch` or `email.sendTemplateBatch`, whose events carry the recipient address. An entirely suppressed request raises `ZOHO_CPAAS_ALL_SUPPRESSED`; eligible cc or bcc without an eligible to raises `ZOHO_CPAAS_INVALID_ARGUMENT`.

## Concepts

| Term                                                                                                                   | Meaning                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`                                                                                                                | Transactional email, inline or template, sent individually or as a batch.                                                                                                                                                                                                    |
| `sms`                                                                                                                  | Experimental India DLT template SMS; the component sends to one number.                                                                                                                                                                                                      |
| `whatsapp`                                                                                                             | Experimental pre-approved Utility or Authentication template messages.                                                                                                                                                                                                       |
| `messages`                                                                                                             | Stored per-recipient outbound messages and their events.                                                                                                                                                                                                                     |
| `suppressions`                                                                                                         | Persistent addresses excluded from outbound sends until removed.                                                                                                                                                                                                             |
| `config`                                                                                                               | Read-only component configuration: email token presence, effective test mode and region.                                                                                                                                                                                     |
| `files`                                                                                                                | Binary email media uploaded to Zoho’s file cache.                                                                                                                                                                                                                            |
| `from, defaultFrom`                                                                                                    | The email sender; the call’s from overrides the client defaultFrom.                                                                                                                                                                                                          |
| `to, cc, bcc`                                                                                                          | Recipient addresses; email uses address objects, batches use emailAddress objects, SMS uses country-code digits, and WhatsApp uses a country-code number.                                                                                                                    |
| `address, name, emailAddress`                                                                                          | An email address, optional display name, and a batch recipient’s address object.                                                                                                                                                                                             |
| `subject`                                                                                                              | The email subject.                                                                                                                                                                                                                                                           |
| `htmlbody, textbody`                                                                                                   | HTML and plain-text email content; inline email requires at least one.                                                                                                                                                                                                       |
| `replyTo`                                                                                                              | Reply-to email addresses.                                                                                                                                                                                                                                                    |
| `trackOpens, trackClicks`                                                                                              | Optional email tracking decisions forwarded only when supplied.                                                                                                                                                                                                              |
| `mimeHeaders`                                                                                                          | Additional email MIME headers.                                                                                                                                                                                                                                               |
| `templateKey, templateAlias`                                                                                           | Exactly one Zoho template identifier; the template must already exist.                                                                                                                                                                                                       |
| `mergeInfo`                                                                                                            | Values replacing template variables; batches can supply per-recipient values.                                                                                                                                                                                                |
| `senderKey`                                                                                                            | The SMS sender associated with the sending agent and DLT approval.                                                                                                                                                                                                           |
| `zohoAgentId`                                                                                                          | An optional Zoho WhatsApp agent ID; absent uses the agent bound to the token.                                                                                                                                                                                                |
| `clientReference`                                                                                                      | An app reference echoed by Zoho; absent uses component message IDs.                                                                                                                                                                                                          |
| `idempotencyKey`                                                                                                       | A caller key returning the prior send for `retentionDays` after the send finishes, unless every non-suppressed outcome definitively failed or was canceled before uncertainty.                                                                                               |
| `attachments, inlineImages`                                                                                            | Email files and images supplied with base64 content or a fileCacheKey.                                                                                                                                                                                                       |
| `mimeType, content, fileCacheKey, cid`                                                                                 | Media type, base64 email media or binary upload content, Zoho cache key, and inline-image content ID.                                                                                                                                                                        |
| `messageId, messageIds, _id`                                                                                           | Component row IDs; send methods return message IDs and stored documents retain Convex _id.                                                                                                                                                                                   |
| `jobId`                                                                                                                | The component send-job row ID linking messages in one outbound request.                                                                                                                                                                                                      |
| `zohoMessageId, zohoRequestId, zohoEventId`                                                                            | Provider message, request and webhook identifiers, distinct from component row IDs.                                                                                                                                                                                          |
| `channel`                                                                                                              | email, sms or whatsapp; an unrecognized webhook channel is unknown.                                                                                                                                                                                                          |
| `testMode`                                                                                                             | Explicit simulation enabled by the client option or component env true; stored on affected rows.                                                                                                                                                                             |
| `region, configured`                                                                                                   | Zoho data-center region, explicit or derived from the endpoint host, and, per channel (`email`, `sms`, `whatsapp`), whether a channel or shared token is set.                                                                                                                |
| `paginationOpts, page, isDone, continueCursor`                                                                         | Convex pagination input and bounded stored-row page output.                                                                                                                                                                                                                  |
| `recipient, status`                                                                                                    | Message-list filters; exactly one is required, recipient requires channel, and status forbids channel.                                                                                                                                                                       |
| `onEvent, event, ambiguous`                                                                                            | An internal mutation callback, its normalized signed event, and whether message correlation has multiple candidates.                                                                                                                                                         |
| `type, raw`                                                                                                            | A normalized event category and its provider-controlled payload; raw access requires app authorization.                                                                                                                                                                      |
| `occurredAt, receivedAt, createdAt, sendingAt, sentAt, terminalAt, canceledAt`                                         | Timestamps in milliseconds since the Unix epoch.                                                                                                                                                                                                                             |
| `attempts, failureDefinitive`                                                                                          | Number of attempts and whether an outcome permits an idempotent new send.                                                                                                                                                                                                    |
| `error, warning, code, message, retryable, providerStatus, providerCode`                                               | Fixed error data, an optional success-warning code, retry classification, provider HTTP status and bounded Zoho error code.                                                                                                                                                  |
| `reason, sourceMessageId`                                                                                              | Suppression cause and its originating component message ID.                                                                                                                                                                                                                  |
| `retentionDays`                                                                                                        | Days before terminal rows and completed jobs expire; receipts last at least 30 days.                                                                                                                                                                                         |
| `queued`                                                                                                               | Entered on enqueue for an eligible recipient, or on a retry after definitive rejection.                                                                                                                                                                                      |
| `sending`                                                                                                              | Entered after begin rechecks the suppression and effective endpoint.                                                                                                                                                                                                         |
| `accepted`                                                                                                             | Entered after a provider acceptance or simulated send; email and SMS usually remain here.                                                                                                                                                                                    |
| `unknown`                                                                                                              | Entered on transport uncertainty or a stuck attempt; SMS and WhatsApp never automatically resend it. Email bounce and complaint events resolve it; WhatsApp delivered, read and failed events will resolve it once a live capture qualifies WhatsApp webhooks; SMS has none. |
| `delivered`                                                                                                            | Entered on a compatible WhatsApp delivery event; inactive until a live capture qualifies WhatsApp webhooks.                                                                                                                                                                  |
| `read`                                                                                                                 | Entered on a compatible WhatsApp read event; terminal; inactive until a live capture qualifies WhatsApp webhooks.                                                                                                                                                            |
| `failed`                                                                                                               | Entered after definitive provider rejection, configuration failure, or a compatible WhatsApp failure event (inactive until a live capture qualifies WhatsApp webhooks); terminal.                                                                                            |
| `bounced`                                                                                                              | Entered on an email hardbounce event; terminal and suppresses the address.                                                                                                                                                                                                   |
| `complained`                                                                                                           | Entered on an email complaint event; terminal and suppresses the address.                                                                                                                                                                                                    |
| `suppressed`                                                                                                           | Entered when an address is suppressed at enqueue or before begin; terminal.                                                                                                                                                                                                  |
| `canceled`                                                                                                             | Entered when pending work is canceled before an uncertain outcome; terminal.                                                                                                                                                                                                 |
| `hardbounce, softbounce, complaint, open, click`                                                                       | Zoho email event categories; only hardbounce and complaint change message state.                                                                                                                                                                                             |
| `undelivered, unknown event`                                                                                           | Normalized provider failure and unrecognized event categories.                                                                                                                                                                                                               |
| `path, registerRoutes`                                                                                                 | The signed webhook route path and route registration helper; the default path is /zoho-cpaas/webhook.                                                                                                                                                                        |
| `accepted, duplicate, invalid_signature, missing_secret, oversized_body, invalid_payload, stale_event receipt reasons` | Webhook processing outcomes after signature, body, configuration, event-time and deduplication checks.                                                                                                                                                                       |

Names follow the [Zoho API glossary](https://www.zoho.com/cpaas/help/api/api-glossary.html), [email reference](https://www.zoho.com/cpaas/help/api/email-sending.html), [SMS reference](https://www.zoho.com/cpaas/help/api/send-an-sms.html), [WhatsApp reference](https://www.zoho.com/cpaas/help/api/send-a-whatsapp-message.html), and [file-cache documentation](https://www.zoho.com/cpaas/help/file-cache.html).

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

The route forwards raw body text and the `producer-signature` header. The component verifies base64 HMAC-SHA256 over Zoho's URL-decoded body using current or previous secret and constant-time comparison, then deduplicates by provider event ID and body hash. A missing or bad signature returns 401; missing secrets or callback failure return 500. A body above 512 KiB returns 413; malformed `Content-Length` or undecodable UTF-8 returns 400. A direct component `webhooks.receive` call returns only `{ reason }`, with `reason: "duplicate"` for an already committed body and `reason: "oversized_body"` when its body exceeds the same limit. Correctly signed bodies return 200, including unusable payloads stored as `invalid_payload` failed receipts. Freshness is per event: a signed body applies its events whose signed event time is within the bound and skips the others; a body with no such event is stored as a `stale_event` failed receipt that applies no event and invokes no callback. Event time comes only from documented fields: `event_data[].details[].time`, else `email_info.processed_time`; `event_data` and `details` may be objects or arrays. An event time is an epoch number, read as seconds below 1e12 and as milliseconds otherwise, or an ISO 8601 date-time string with `Z` or a numeric `+HH:MM` or `+HHMM` offset; any other string is no event time. Zoho documents no WhatsApp event-time field, so every WhatsApp webhook is rejected as `stale_event` until a captured live payload names one; one attended live capture qualifies webhooks. Only committed bodies deduplicate; a failed receipt never blocks a later valid delivery of the same body. The parser accepts JSON and form-encoded JSON and limits expanded events to 500 and 256 KiB. The unsigned timestamp gets a 24-hour freshness window and five minutes of future skew.

## API reference

`new ZohoCpaas(component, options?: ZohoCpaasOptions)` accepts `testMode`, `defaultFrom` and `onEvent`; `onEvent` is a `FunctionReference_future<"mutation", "internal", ZohoCpaasEventArgs, null>`. Methods take `(ctx, args)` except `config.get(ctx)`, which takes no arguments.

| Method                    | Context           | Arguments                                                                                                                  | Result                                                      |
| ------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `email.send`              | `MutationContext` | `to`, `subject`, `htmlbody?`, `textbody?`, `from?` and the shared email options                                            | Message IDs for inline email.                               |
| `email.sendTemplate`      | `MutationContext` | `to`, `templateKey?`, `templateAlias?`, `mergeInfo?`, `from?` and the shared email options                                 | Message IDs for template email.                             |
| `email.sendBatch`         | `MutationContext` | `to` recipients with merge values, `subject`, `htmlbody?`, `textbody?`, `mergeInfo?`, `from?` and the shared email options | Message IDs for one provider batch.                         |
| `email.sendTemplateBatch` | `MutationContext` | `to` recipients with merge values, `templateKey?`, `templateAlias?`, `mergeInfo?`, `from?` and the shared email options    | Message IDs for one template batch.                         |
| `sms.sendTemplate`        | `MutationContext` | `senderKey`, `to`, `templateKey?`, `templateAlias?`, `mergeInfo?`, `clientReference?`, `idempotencyKey?`                   | One experimental India DLT message ID.                      |
| `whatsapp.sendTemplate`   | `MutationContext` | `from`, `to`, `zohoAgentId?`, `templateKey?`, `templateAlias?`, `mergeInfo?`, `clientReference?`, `idempotencyKey?`        | One experimental template message ID.                       |
| `messages.get`            | `QueryContext`    | `messageId`                                                                                                                | Stored message; missing row raises NOT_FOUND.               |
| `messages.list`           | `QueryContext`    | Exactly one of `recipient` (requires `channel`) or `status` (forbids `channel`), plus `paginationOpts`                     | Page of stored messages.                                    |
| `messages.listEvents`     | `QueryContext`    | `messageId`, `paginationOpts`                                                                                              | Page of stored message events.                              |
| `messages.cancel`         | `MutationContext` | `messageId`                                                                                                                | Whether pending attempts were stopped.                      |
| `suppressions.list`       | `QueryContext`    | `channel`, `paginationOpts`                                                                                                | Page of persistent channel suppressions.                    |
| `suppressions.remove`     | `MutationContext` | `channel`, `address`                                                                                                       | Whether a normalized address was removed.                   |
| `files.upload`            | `ActionContext`   | `name`, `mimeType`, `content`                                                                                              | Zoho file-cache key.                                        |
| `config.get`              | `QueryContext`    | None                                                                                                                       | Per-channel token presence, effective test mode and region. |

The shared email options are `cc?`, `bcc?`, `replyTo?`, `trackOpens?`, `trackClicks?`, `clientReference?`, `mimeHeaders?`, `attachments?`, `inlineImages?` and `idempotencyKey?`; `from` defaults to the client `defaultFrom`. Each method calls the same-named component function. Message get and event reads raise `ZOHO_CPAAS_NOT_FOUND` for missing rows; cancel returns false when an existing row has no cancelable work.

`QueryContext`, `MutationContext` and `ActionContext` expose exactly `runQuery`, `runMutation` and `runAction`, respectively. `resolveEmailFrom(from, defaultFrom)` is a standalone sender-resolution helper. `registerRoutes(http, component, options?)` and `client.registerRoutes(http, { path? })` register the verified webhook route.

## Errors

Errors use `{ code, message, retryable?, providerStatus?, providerCode? }`. Each code has exactly the sentence below. Provider and network errors always carry `retryable`, and no other code carries it; provider descriptions and bodies never enter error data. `providerCode` is truncated to 64 characters. The client exports `ZOHO_CPAAS_ERROR_CODES`, `ZohoCpaasErrorCode`, `ZohoCpaasErrorData` and `isZohoCpaasError`; the guard accepts only known fields, the code with its exact message, `retryable` exactly on provider and network errors, and well-formed provider details.

| Code                                   | Message                                                   | When                                                                                                                           |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ZOHO_CPAAS_IDEMPOTENCY_CONFLICT`      | The idempotency key identifies different request content. | A key identifies different send arguments.                                                                                     |
| `ZOHO_CPAAS_ALL_SUPPRESSED`            | All email recipients are suppressed.                      | All requested email recipients are suppressed.                                                                                 |
| `ZOHO_CPAAS_NOT_FOUND`                 | The referenced row does not exist.                        | A referenced component message row does not exist.                                                                             |
| `ZOHO_CPAAS_INVALID_WEBHOOK_SIGNATURE` | The webhook signature is missing or invalid.              | The HTTP webhook signature is missing, invalid or outside freshness bounds.                                                    |
| `ZOHO_CPAAS_INVALID_ARGUMENT`          | An argument is invalid, missing or out of bounds.         | An argument, message ID or page bound is invalid.                                                                              |
| `ZOHO_CPAAS_NOT_CONFIGURED`            | A required component setting is missing or malformed.     | A required env value is missing or any supplied env value is malformed.                                                        |
| `ZOHO_CPAAS_UNSUPPORTED_REGION`        | The channel is unavailable at the configured endpoint.    | An SMS attempt uses an endpoint outside India.                                                                                 |
| `ZOHO_CPAAS_PROVIDER_ERROR`            | The provider rejected the request.                        | Zoho answered with a failed HTTP status or requested a retry delay above 24 hours.                                             |
| `ZOHO_CPAAS_NETWORK_ERROR`             | The provider request outcome is unknown.                  | A provider request has no response, a send action ends without an outcome, or a send stays in progress for more than 24 hours. |
| `ZOHO_CPAAS_INVALID_RESPONSE`          | The provider returned an unusable success response.       | A successful provider response cannot supply usable send identifiers or a file-cache key.                                      |

An unrecognized successful send stores `ZOHO_CPAAS_INVALID_RESPONSE` in `message.warning` and retains acceptance. An unusable file-upload success throws that code. An upload with no response raises `ZOHO_CPAAS_NETWORK_ERROR` with `retryable: true`; a failed status whose body cannot be read raises `ZOHO_CPAAS_PROVIDER_ERROR` with `providerStatus`.

## Testing

`testMode: true` or `ZOHO_CPAAS_TEST_MODE === "true"` simulates sends and uploads without provider calls. Rows store the effective test mode. Every send attempt still rechecks suppressions and channel endpoints; SMS requires an India endpoint. Webhooks always require a signing key. A missing live-channel token raises `ZOHO_CPAAS_NOT_CONFIGURED`.

Register the component and its workpool child in `convex-test`:

```ts
import { register } from "@operatornest/convex-zoho-cpaas/test";
import { convexTest } from "convex-test";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const t = convexTest(schema, modules);
register(t);
```

Stub `fetch` and dummy env with `vi.stubEnv`; restore env, globals and fake timers after each test. Simulator tests prove state and payload behavior. `pnpm smoke` separately exercises anonymous local-runtime env bindings and signed HTTP webhooks. Neither proves live-account behavior; live provider send, token scopes, event payloads, signature wire encoding and the `files.upload` wire format remain unqualified until one attended live send, upload and webhook capture. Each fixture states whether its payload is documented or captured.

## Limits and retention

| Input                                                    | Limit                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Email addresses per recipient field (single send)        | 500                                                                                                                |
| Email recipients per batch                               | 500 total                                                                                                          |
| Encoded send payload                                     | 256 KiB                                                                                                            |
| Upload content                                           | 15 MiB, subject to Convex transport limits                                                                         |
| Upload request                                           | 30 seconds for the request and response; a timeout before the response raises retryable `ZOHO_CPAAS_NETWORK_ERROR` |
| Idempotency key, template key, sender key, Zoho agent ID | 200 characters                                                                                                     |
| Template alias, client reference                         | 100 characters                                                                                                     |
| `paginationOpts.numItems`                                | 1–100 items; at most `numItems + 1` rows and 1 MiB read per page, also with `endCursor`                            |
| Webhook body                                             | 512 KiB; 500 expanded events and 256 KiB of expanded events                                                        |

Workpool parallelism is 10. Sends have at most five attempts. Email retries transport uncertainty and may produce duplicate provider sends; Zoho has no send idempotency header. SMS and WhatsApp never automatically resend unknown outcomes; a later attempt that finds an SMS or WhatsApp message still sending marks it unknown instead of resending it. They retry only eligible 429 or recognized 503 rejections. Only email bounce and complaint events resolve unknown outcomes; WhatsApp delivered, read and failed events will resolve them once a live capture qualifies WhatsApp webhooks; open and click events do not, and an unknown SMS stays unknown, so resending it needs a new idempotency key. Cancellation stops pending attempts and cannot undo a provider request; canceling an uncertain email keeps it unknown and records `canceledAt`.

A daily cron handles at most 200 cleanup candidates per batch. Terminal messages, old events and finished jobs expire after `retentionDays`, so an idempotency key is remembered for `retentionDays` after its send finishes; receipts use at least 30 days. Finished-job payloads are cleared while request digests remain until job deletion. Sending attempts older than 24 hours become unknown. Queued messages and persistent suppressions do not expire.

Email has no delivered webhook, and SMS has no webhook reconciliation in this component. WhatsApp supports template sends only. Inbound, free-form, media, interactive and batch WhatsApp sends are outside this API.

## Security

Apps authenticate and authorize every call and restrict access to stored messages and provider raw data. Credentials are component env. Signatures cover Zoho’s URL-decoded body; the unsigned header timestamp cannot replace signed event freshness. Only events with a documented signed event time within receipt retention minus one day and five minutes of future skew apply; a body with no such event is stored as a `stale_event` failed receipt and applies nothing. Only committed receipts deduplicate event IDs and body hashes in the event/callback transaction. Callback failures roll that transaction back.

See [SECURITY.md](SECURITY.md) for private reporting.

## Development

Use Node 24 and pnpm 12.9.1 through mise. `pnpm build:codegen` regenerates bindings; `pnpm check` runs formatting, build, lint, typecheck, Knip, source checks and coverage; `pnpm smoke` holds the shared anonymous local-backend lock, builds the package, copies it into a temporary workspace, starts a local backend on free ports and runs the domain steps in `scripts/smoke.mjs`. See [CONTRIBUTING.md](CONTRIBUTING.md).

An attended maintainer session starts with `pnpm e2e --dry-run`. Routine work never reads `.env.e2e` or runs interactive e2e; CI never runs it.

## License

[MIT](LICENSE).
