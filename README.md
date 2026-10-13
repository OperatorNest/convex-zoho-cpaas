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
| `ZOHO_CPAAS_BASE_URL`                                                         | HTTPS endpoint override; absent uses the region host.                                                       |
| `ZOHO_CPAAS_TOKEN`                                                            | Shared Agent token; absent requires a channel token or test mode.                                           |
| `ZOHO_CPAAS_EMAIL_TOKEN`, `ZOHO_CPAAS_SMS_TOKEN`, `ZOHO_CPAAS_WHATSAPP_TOKEN` | Optional channel overrides of the shared token.                                                             |
| `ZOHO_CPAAS_WEBHOOK_SECRET`, `ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS`             | Current and previous signing keys; absent makes webhooks fail closed.                                       |
| `ZOHO_CPAAS_RETENTION_DAYS`                                                   | Terminal-record retention: `1`–`3650`, default `30`. Webhook receipts are kept at least 30 days regardless. |
| `ZOHO_CPAAS_TEST_MODE`                                                        | Disabled unless exactly `true`.                                                                             |

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

Email addresses use `{ address, name? }`; batches use `{ emailAddress: { address, name? }, mergeInfo? }`. A single send allows 500 addresses per recipient field; a batch allows 500 across `to`, `cc`, and `bcc`. Every requested recipient gets a row when the request succeeds, including suppressed recipients. At least one `to` must remain eligible when `cc` or `bcc` remains eligible; otherwise the request raises `ZOHO_CPAAS_VALIDATION_FAILED`. A request with every recipient suppressed raises `ZOHO_CPAAS_ALL_SUPPRESSED`. Each attempt rechecks suppressions before marking eligible messages `sending`.

Inline email requires `subject` and `html` or `text`. Templates require exactly one of `templateKey` and `templateAlias`. Attachments use `{ name, mimeType?, content?, fileCacheKey? }`; inline images replace `name` with `cid`. Supply base64 `content` with `mimeType`, or a `fileCacheKey`. The complete JSON-encoded send payload, including media and merge values, is capped at 256 KiB. Upload larger media with `email.uploadFile(ctx, { name, mimeType, content })`; `content` is an `ArrayBuffer`, capped at 15 MiB subject to Convex transport limits. The return value is a file-cache key.

Client options default to no `defaultFrom`, no `onEvent`, and no test-mode opt-in. An email call's `from` overrides `defaultFrom`; one must exist. `testMode: true` or component env `ZOHO_CPAAS_TEST_MODE === "true"` enables simulation; caller objects cannot override the constructor's `testMode`. `onEvent` is an internal mutation called in the receipt transaction. Route `path` defaults to `/zoho-cpaas/webhook`.

Optional tracking flags, reply addresses, headers, merge values, media, template identifiers, and agent IDs are omitted from the provider request when absent. `clientReference` defaults to a generated message ID; batches use per-recipient `__onx_ref` substitutions unless a reference is supplied. `idempotencyKey` has no default and accepts 1–200 nonblank characters. Template keys, SMS sender keys, and WhatsApp agent IDs accept at most 200 characters; template aliases and client references accept at most 100.

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

The route forwards raw body text and the `producer-signature` header. The component verifies base64 HMAC-SHA256 over Zoho's URL-decoded body using current or previous secret and constant-time comparison, then deduplicates by provider event ID and body hash. A missing or bad signature returns 401; missing secrets or callback failure return 500. A body above 512 KiB returns 413; malformed `Content-Length` or undecodable UTF-8 returns 400. A direct component `webhooks.receive` call returns only `{ reason, duplicate }`, including `reason: "oversized_body"` when its body exceeds the same limit. Correctly signed events within the signed-event freshness bound, including unusable payloads stored as failed receipts, return 200. Only committed bodies deduplicate; a failed receipt never blocks a later valid delivery of the same body. The parser accepts JSON and form-encoded JSON and limits expanded events to 500 and 256 KiB. The unsigned timestamp gets a 24-hour freshness window and five minutes of future skew.

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
| `messages.cancel(ctx, { messageId })`                                   | `messages.cancel`               | Stops a pending attempt.            |
| `suppressions.list(ctx, { channel, paginationOpts })`                   | `suppressions.list`             | Paginated suppressions.             |
| `suppressions.remove(ctx, { channel, address })`                        | `suppressions.remove`           | Removes a normalized address.       |
| `registerRoutes(http, component, options?)`                             | `webhooks.receive`              | Registers verified webhook route.   |
| `client.registerRoutes(http, { path? })`                                | `webhooks.receive`              | Uses constructor callback.          |

`messages.list` accepts exactly one of `recipient` or `status`; `recipient` requires `channel`, while `status` forbids it. Email addresses are lowercased, SMS numbers contain digits only, and WhatsApp numbers use `+` followed by digits. Pages accept 1–100 items and Convex-helper cursors, including `endCursor`; every page reads at most `numItems + 1` rows.

Idempotency hashes key-sorted request JSON. A changed request under the same key raises `ZOHO_CPAAS_IDEMPOTENCY_CONFLICT`. A new job may reuse a key only when every prior non-suppressed recipient definitively failed or was canceled before any uncertain attempt. Unknown outcomes remain deduplicated until job retention removes the ledger. Zoho has no send idempotency header.

Transport failures record `unknown`. Email may retry them up to five attempts and can send duplicates when a response was lost. SMS and WhatsApp never automatically resend unknown outcomes; they retry explicit 429 or 503 rejections with a code in the package’s known Zoho code lists. An unrecognized body code does not make a 5xx failure definitive. Caught action failures before the HTTP request starts are definitive failures and permit a new send under the same idempotency key. Signed webhooks can resolve `unknown` and survive a later uncertain completion. Canceling queued work or an email awaiting retry stops future attempts; `canceledAt` records cancellation, while an uncertain outcome stays `unknown` until a webhook resolves it. Cancellation cannot undo a provider request.

Webhook matching requires compatible channel, recipient, and identifiers. Events in one body use message identifiers and state written by earlier events in that transaction. Ambiguous envelopes remain unresolved. Client-reference lookups include channel and recipient; early events reconcile in scheduled batches of at most 100 rows with a 512 KiB read budget.

## Errors

Thrown errors and `message.error` use `{ code, message, providerStatus?, providerCode? }`. Each code has the fixed sentence below. `providerStatus` is an HTTP status; `providerCode` is a Zoho code of at most 64 characters. Provider descriptions, response bodies, recipients, and message content never enter errors. `isZohoCpaasError(error)` validates the thrown error's code, message type, and optional provider fields. Retry classification stays internal. Send functions rethrow non-package errors unchanged.

| Code                                   | Fixed message                                                 |
| -------------------------------------- | ------------------------------------------------------------- |
| `ZOHO_CPAAS_VALIDATION_FAILED`         | An argument is invalid, missing or out of bounds.             |
| `ZOHO_CPAAS_NOT_CONFIGURED`            | The channel token is missing and test mode is disabled.       |
| `ZOHO_CPAAS_INVALID_CONFIG`            | A component setting is invalid.                               |
| `ZOHO_CPAAS_UNSUPPORTED_REGION`        | The channel is unavailable at the configured endpoint.        |
| `ZOHO_CPAAS_IDEMPOTENCY_CONFLICT`      | The idempotency key identifies different request content.     |
| `ZOHO_CPAAS_ALL_SUPPRESSED`            | All email recipients are suppressed.                          |
| `ZOHO_CPAAS_UPLOAD_FAILED`             | The provider did not return a usable file cache key.          |
| `ZOHO_CPAAS_PROVIDER_REJECTED`         | The provider rejected the request.                            |
| `ZOHO_CPAAS_NETWORK_ERROR`             | The send request outcome is unknown.                          |
| `ZOHO_CPAAS_WORKPOOL_ACTION_FAILED`    | The send action ended without reporting an outcome.           |
| `ZOHO_CPAAS_RETRY_AFTER_TOO_LONG`      | The provider requested a retry delay longer than 24 hours.    |
| `ZOHO_CPAAS_STUCK`                     | The send remained in progress for more than 24 hours.         |
| `ZOHO_CPAAS_UNRECOGNIZED_SUCCESS_BODY` | The provider accepted the request without usable identifiers. |

The last code is stored in `message.warning` after an unrecognized 2xx response. Provider rejection codes appear in `providerCode` rather than replacing `code`.

## Testing

Test mode is an explicit client option (`new ZohoCpaas(component, { testMode: true })`) or `ZOHO_CPAAS_TEST_MODE === "true"`. It creates `testMode: true` rows and synthetic provider identifiers without a Zoho call. Simulation still enforces channel endpoints before execution; SMS requires an India endpoint. Webhooks still need a signing secret. Without a channel token and opt-in, sends raise `ZOHO_CPAAS_NOT_CONFIGURED`.

Use the exported `register(t)` helper with `convex-test`; it registers the component and workpool child. Vitest transforms their TypeScript test entries without a `test.server.deps.inline` setting:

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

A daily cron processes at most 200 cleanup candidates per batch. Default terminal-record retention is 30 days. It clears terminal job provider payloads while retaining request digests until finished jobs are deleted at the configured retention cutoff, regardless of whether a failure outcome was unknown. It also deletes old events and webhook receipts (receipts use the larger of the configured retention and 30 days), and sweeps old provider-state rows without `terminalAt` by `createdAt`. Queued work stays pending. A `sending` attempt older than 24 hours becomes `unknown`. Suppressions persist until an authorized app call removes them.

## Known limitations

- Live Zoho send and webhook capture have not validated token scopes, SMS and WhatsApp payload/status details, signature wire encoding, form field names, or exact event timestamps. The HMAC fixture validates the implementation's algorithm only.
- Zoho’s signature does not cover the header timestamp. Event ID and committed-body hash deduplication suppress replay during receipt retention; the signed-event freshness bound in Security rejects expired bodies after receipt deletion.
- SMS rechecks that the effective HTTPS endpoint has an India `.in` hostname on every attempt and requires DLT approval, sender association, and a pre-approved template. It has no webhook reconciliation and remains `accepted` after request acceptance. WhatsApp supports pre-approved Utility or Authentication templates; inbound, free-form, media, interactive, and batch sends are outside this component.
- Email has no delivered webhook. A successful send stays `accepted` unless a later failure event arrives; opens and clicks are events. Unknown multi-recipient webhook envelopes are retained as diagnostics rather than assigning one failure to all addresses.
- Per-recipient batch `__onx_ref` substitution, Zoho rate limits, 429 behavior, full 15 MB upload in Convex transport, and the `.sa`/`.ca` host behavior still need live-account qualification. Workpool concurrency is fixed at 10.

## Security

Webhook receipts are retained for `max(ZOHO_CPAAS_RETENTION_DAYS, 30)` days, with invalid retention settings using 30 days. Every event must have a usable timestamp in the signed body. A body with any event older than that receipt retention period minus one day, or more than five minutes in the future, returns 401 (`invalid_signature`) without storing a receipt or applying events. Missing or unusable event timestamps also fail this check. Changing the unsigned `ts` header cannot extend this bound.

Authenticate and authorize app functions before calling the component. Credentials belong in component env. Restrict access to messages and provider-controlled raw events. Report vulnerabilities through [private reporting](https://github.com/OperatorNest/convex-zoho-cpaas/security/advisories/new); see [SECURITY.md](https://github.com/OperatorNest/convex-zoho-cpaas/blob/main/SECURITY.md).

## Development

Use `.mise.toml` for Node 24 and pnpm 12.9.1. `pnpm build:codegen` generates bindings and builds the package; `pnpm check` runs formatting, build, lint, typecheck, Knip, and coverage tests; `pnpm smoke` tests the anonymous real runtime. See [CONTRIBUTING.md](https://github.com/OperatorNest/convex-zoho-cpaas/blob/main/CONTRIBUTING.md). The maintainer-run `pnpm e2e` workflow uses gitignored `.env.e2e` for real provider sends and webhook qualification; start with `pnpm e2e --dry-run`. It is never run in CI. `pnpm e2e:env` only loads component env values.

## License

MIT. See [LICENSE](LICENSE).
