import { describe, expect, test } from "vitest";
import { atOrThrow } from "../test-helpers.js";
import {
  classifyNetworkError,
  classifyProviderError,
  parseRetryAfter,
  retryBackoffMs,
  zohoCpaasProviderErrorCodes,
} from "./errors.js";
import { stableStringify } from "./record.js";
import {
  buildEmailPayload,
  buildSmsPayload,
  buildWhatsappPayload,
  normalizeToken,
  regionBaseUrl,
  isIndiaBaseUrl,
  validateUploadFile,
} from "./provider.js";
import { canTransitionStatus } from "./status.js";
import { parseWebhookBody, verifyWebhookSignature } from "./webhook.js";

const webhookPayload = {
  event_name: ["hardbounce"],
  event_message: [
    {
      email_info: {
        email_reference: "ref-demo-0001",
        client_reference: "order-12345",
        is_smtp_trigger: false,
        subject: "Account Confirmation",
        bounce_address: "bounce@bounce.info.zylker.com",
        from: { address: "accounts@info.zylker.com", name: "Paula" },
        to: [{ email_address: { address: "rudra.d@zylker.com", name: "Rudra" } }],
        processed_time: "2026-10-04T10:00:00Z",
      },
      object: "email",
      event_data: [
        {
          details: [
            {
              reason: "Mailbox does not exist",
              time: "2026-10-04T10:00:05Z",
              diagnostic_message: "550 5.1.1 user unknown",
            },
          ],
          object: "bounce",
        },
      ],
    },
  ],
  request_id: "2d6f.14350939.i1.demo",
  mailagent_key: "123456abcd78",
  webhook_request_id: "wh-demo-0001",
};
const json = JSON.stringify(webhookPayload);
const header =
  "ts=1790000000000;s=a6tBYILSTq7n2%2BkwFHltWX7cz5Tq%2BE9TUm7aNP4IqF0%3D;s-algorithm=HmacSHA256";
const body = `data=${encodeURIComponent(json)}`;

describe("webhook trust boundary", () => {
  test("verifies the documented worked HMAC vector and extracts array-shaped email events", async () => {
    const signed = await verifyWebhookSignature(
      body,
      header,
      "test-authentication-key",
      null,
      1790000000000,
    );
    expect(signed).toBe(json);
    expect(signed).not.toBeNull();
    if (signed === null) throw new Error("Expected signed payload");
    expect(parseWebhookBody(signed)).toMatchObject({
      providerEventId: "wh-demo-0001",
      events: [
        {
          type: "hardbounce",
          channel: "email",
          recipient: "rudra.d@zylker.com",
          providerRequestId: "2d6f.14350939.i1.demo",
          providerMessageId: "ref-demo-0001",
          clientReference: "order-12345",
        },
      ],
    });
  });

  test("rejects tampering, missing secrets, stale and future timestamps", async () => {
    expect(
      await verifyWebhookSignature(
        `${body}x`,
        header,
        "test-authentication-key",
        null,
        1790000000000,
      ),
    ).toBeNull();
    expect(await verifyWebhookSignature(body, header, null, null, 1790000000000)).toBeNull();
    expect(
      await verifyWebhookSignature(
        body,
        header,
        "test-authentication-key",
        null,
        1790000000000 + 86400001,
      ),
    ).toBeNull();
    expect(
      await verifyWebhookSignature(
        body,
        header,
        "test-authentication-key",
        null,
        1790000000000 - 300001,
      ),
    ).toBeNull();
  });

  test("accepts the previous secret during rotation", async () => {
    expect(
      await verifyWebhookSignature(
        body,
        header,
        "new-key",
        "test-authentication-key",
        1790000000000,
      ),
    ).toBe(json);
  });

  test("parses JSON and form bodies and safely ignores unknown event names", () => {
    expect(parseWebhookBody(json)?.events).toHaveLength(1);
    expect(parseWebhookBody(body)?.events).toHaveLength(1);
    expect(
      parseWebhookBody(JSON.stringify({ ...webhookPayload, event_name: ["unknown"] }))?.events.at(0)
        ?.type,
    ).toBe("unknown");
    expect(parseWebhookBody("{broken")).toBeNull();
    expect(parseWebhookBody(JSON.stringify({ event_name: "open" }))).toBeNull();
  });

  test("retains one unresolved event for a multi-address email envelope", () => {
    const event = structuredClone(webhookPayload);
    const first = event.event_message.at(0);
    if (first === undefined) throw new Error("Missing event fixture");
    first.email_info.to.push({
      email_address: { address: "SECOND@EXAMPLE.COM", name: "Second" },
    });
    Object.assign(first.email_info, {
      cc: [{ email_address: { address: "cc@example.com" } }],
      bcc: [{ email_address: { address: "bcc@example.com" } }],
    });
    const parsed = parseWebhookBody(JSON.stringify(event));
    expect(parsed?.events).toHaveLength(1);
    expect(parsed?.events.at(0)?.recipient).toBeUndefined();
    expect(atOrThrow(parsed?.events ?? [], 0).raw).toMatchObject({
      event_name: "hardbounce",
      event_message: { email_info: { cc: [{ email_address: { address: "cc@example.com" } }] } },
    });
  });

  test("matches recipient only when an email event_message names one address", () => {
    const event = structuredClone(webhookPayload);
    event.event_name = ["hardbounce", "open"];
    const first = event.event_message.at(0);
    if (first === undefined) throw new Error("Missing event fixture");
    event.event_message = [
      first,
      {
        ...first,
        email_info: {
          ...first.email_info,
          to: [{ email_address: { address: "SECOND@EXAMPLE.COM", name: "Second" } }],
        },
      },
    ];
    expect(parseWebhookBody(JSON.stringify(event))?.events.map((item) => item.recipient)).toEqual([
      "rudra.d@zylker.com",
      "second@example.com",
    ]);
  });

  test("does not allow malformed headers or a timestamp to stand in for a valid HMAC", async () => {
    const malformed = "ts=1790000000000;s=not-base64;s-algorithm=HmacSHA256";
    expect(
      await verifyWebhookSignature(body, malformed, "test-authentication-key", null, 1790000000000),
    ).toBeNull();
    expect(
      await verifyWebhookSignature(
        body,
        header.replace("HmacSHA256", "none"),
        "test-authentication-key",
        null,
        1790000000000,
      ),
    ).toBeNull();
    expect(
      await verifyWebhookSignature(
        "data=%zz",
        header,
        "test-authentication-key",
        null,
        1790000000000,
      ),
    ).toBeNull();
  });
});

describe("provider request shapes and limits", () => {
  test("enforces the Zoho 15 MB file and 150 character filename boundaries", () => {
    expect(() =>
      validateUploadFile("a".repeat(150), "application/octet-stream", 15 * 1024 * 1024),
    ).not.toThrow();
    expect(() => validateUploadFile("a".repeat(151), "application/octet-stream", 1)).toThrow(
      /15 MB/,
    );
    expect(() =>
      validateUploadFile("file.bin", "application/octet-stream", 15 * 1024 * 1024 + 1),
    ).toThrow(/15 MB/);
  });
  test("uses documented nested recipient fields but flat reply_to", () => {
    expect(
      buildEmailPayload(
        {
          from: { address: " Sender@Example.com " },
          subject: "Welcome",
          html: "<b>Hello</b>",
          cc: [{ address: "cc@example.com" }],
          bcc: [{ address: "bcc@example.com" }],
          replyTo: [{ address: "reply@example.com" }],
          trackOpens: true,
          mimeHeaders: { "X-Test": "yes" },
          attachments: [{ name: "a.txt", mimeType: "text/plain", content: " Y Q = = " }],
          inlineImages: [{ cid: "logo", fileCacheKey: "cache-1" }],
        },
        [{ address: "To@Example.com" }],
        "row-id",
      ),
    ).toMatchObject({
      from: { address: "Sender@Example.com" },
      to: [{ email_address: { address: "To@Example.com" } }],
      cc: [{ email_address: { address: "cc@example.com" } }],
      bcc: [{ email_address: { address: "bcc@example.com" } }],
      reply_to: [{ address: "reply@example.com" }],
      attachments: [{ name: "a.txt", mime_type: "text/plain", content: "YQ==" }],
      inline_images: [{ cid: "logo", file_cache_key: "cache-1" }],
      client_reference: "row-id",
    });
  });

  test("preserves batch merge info and template selector", () => {
    expect(
      buildEmailPayload(
        {
          from: { address: "from@example.com" },
          templateAlias: "welcome",
          mergeInfo: { shared: "S", overridden: "shared" },
        },
        [
          {
            emailAddress: { address: "to@example.com" },
            mergeInfo: { name: "A", overridden: "local" },
          },
        ],
        "row-id",
      ),
    ).toMatchObject({
      to: [
        {
          email_address: { address: "to@example.com" },
          merge_info: { shared: "S", name: "A", overridden: "local" },
        },
      ],
      template_alias: "welcome",
    });
  });

  test("rejects excessive recipient count and malformed inline media", () => {
    const input = { from: { address: "from@example.com" }, subject: "Hi", text: "Hi" };
    expect(() =>
      buildEmailPayload(
        input,
        Array.from({ length: 501 }, (_, i) => ({ address: `a${i}@example.com` })),
        "id",
      ),
    ).toThrow(/500/);
    expect(() =>
      buildEmailPayload(
        { ...input, attachments: [{ name: "a", content: "no?", mimeType: "text/plain" }] },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/base64/);
    expect(() =>
      buildEmailPayload(
        { ...input, attachments: [{ name: "a", content: "abcde", mimeType: "text/plain" }] },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/base64/);
    expect(() =>
      buildEmailPayload(
        { ...input, attachments: [{ name: "a", content: " \n\t ", mimeType: "text/plain" }] },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/either inline content or a file cache key/);
    expect(() =>
      buildEmailPayload(
        { ...input, replyTo: [{ address: "same@example.com" }, { address: "SAME@example.com" }] },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/Duplicate/);
    expect(() =>
      buildEmailPayload(
        {
          ...input,
          replyTo: Array.from({ length: 501 }, (_, i) => ({ address: `r${i}@example.com` })),
        },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/500/);
    expect(() =>
      buildEmailPayload(
        {
          ...input,
          attachments: Array.from({ length: 60 }, (_, i) => ({
            name: `a${i}`,
            fileCacheKey: `k${i}`,
          })),
          inlineImages: [{ cid: "logo", fileCacheKey: "key" }],
        },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/60/);
    expect(
      buildEmailPayload(
        { ...input, text: "a".repeat(270_000) },
        [{ address: "to@example.com" }],
        "id",
      ).textbody,
    ).toBe("a".repeat(270_000));
    expect(
      buildEmailPayload(
        {
          ...input,
          attachments: [
            {
              name: "exact.bin",
              mimeType: "application/octet-stream",
              content: "A".repeat(256 * 1024),
            },
          ],
        },
        [{ address: "to@example.com" }],
        "id",
      ).attachments,
    ).toHaveLength(1);
    expect(() =>
      buildEmailPayload(
        {
          ...input,
          attachments: [
            {
              name: "over.bin",
              mimeType: "application/octet-stream",
              content: "A".repeat(256 * 1024 + 4),
            },
          ],
        },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/uploadFile.*fileCacheKey/);
    expect(() =>
      buildEmailPayload(
        {
          ...input,
          attachments: [
            {
              name: "large.bin",
              mimeType: "application/octet-stream",
              content: "A".repeat(349_528),
            },
          ],
        },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/uploadFile.*fileCacheKey/);
    expect(
      buildEmailPayload(
        { ...input, attachments: [{ name: "a".repeat(150), fileCacheKey: "cache" }] },
        [{ address: "to@example.com" }],
        "id",
      ).attachments,
    ).toHaveLength(1);
    expect(() =>
      buildEmailPayload(
        { ...input, attachments: [{ name: "a".repeat(151), fileCacheKey: "cache" }] },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/name/);
    expect(() =>
      buildEmailPayload(
        { ...input, subject: "s".repeat(501) },
        [{ address: "to@example.com" }],
        "id",
      ),
    ).toThrow(/subject/);
    expect(
      buildEmailPayload(
        {
          ...input,
          subject: "s".repeat(500),
          attachments: Array.from({ length: 60 }, (_, i) => ({
            name: `f${i}`,
            fileCacheKey: `f-${i}`,
          })),
        },
        [{ address: "to@example.com" }],
        "id",
      ).attachments,
    ).toHaveLength(60);
  });

  test("builds SMS and WhatsApp template request shapes", () => {
    expect(
      buildSmsPayload(
        {
          senderKey: "sender",
          to: "+91-98765 43210",
          templateKey: "key",
          mergeInfo: { otp: "123" },
        },
        "id",
      ),
    ).toEqual({
      sender_key: "sender",
      to: [{ mobile_no: "919876543210" }],
      template_key: "key",
      merge_info: { otp: "123" },
      client_reference: "id",
    });
    expect(
      buildWhatsappPayload(
        { from: "+14155550142", to: "919876543210", templateAlias: "otp", agentId: "agent" },
        "id",
      ),
    ).toEqual({
      from: "+14155550142",
      to: "+919876543210",
      template_alias: "otp",
      client_reference: "id",
      agent_id: "agent",
    });
    expect(() =>
      buildSmsPayload({ senderKey: "sender", to: "+14155550142", templateKey: "key" }, "id"),
    ).toThrow(/India recipient/);
    expect(
      buildSmsPayload(
        {
          senderKey: "sender",
          to: "+919876543210",
          templateKey: "key",
          mergeInfo: { nested: { items: ["one", { number: 2 }] } },
        },
        "id",
      ).merge_info,
    ).toEqual({ nested: { items: ["one", { number: 2 }] } });
    expect(() =>
      buildSmsPayload(
        {
          senderKey: "sender",
          to: "+919876543210",
          templateKey: "key",
          mergeInfo: { tooDeep: { a: { b: { c: { d: "value" } } } } },
        },
        "id",
      ),
    ).toThrow(/nesting/);
  });

  test("maps regions and token prefix", () => {
    expect(regionBaseUrl("eu")).toBe("https://cpaas.zoho.eu/v1.1");
    expect(regionBaseUrl(undefined)).toBe("https://cpaas.zoho.com/v1.1");
    expect(regionBaseUrl("us", "https://api.zeptomail.sa/v1.1/")).toBe(
      "https://api.zeptomail.sa/v1.1",
    );
    expect(() => regionBaseUrl("other")).toThrow();
    expect(normalizeToken("Zoho-enczapikey abc")).toBe("Zoho-enczapikey abc");
    expect(normalizeToken("abc")).toBe("Zoho-enczapikey abc");
    expect(isIndiaBaseUrl("https://cpaas.zoho.in/v1.1")).toBe(true);
    expect(isIndiaBaseUrl("https://cpaas.zoho.com/v1.1")).toBe(false);
  });
});

describe("errors and message status", () => {
  test("recognizes both Zoho error envelopes and operator-action codes", () => {
    expect(
      classifyProviderError(401, { error: { code: "TM_4001", details: [{ code: "SERR_157" }] } }),
    ).toMatchObject({
      retryable: false,
      accountState: false,
      code: "TM_4001",
      subCode: "SERR_157",
    });
    expect(classifyProviderError(400, { data: { error_code: "TM_3301" } })).toMatchObject({
      retryable: false,
      code: "TM_3301",
    });
    expect(
      classifyProviderError(500, { error: { code: "TM_5001", details: [{ code: "LE_102" }] } }),
    ).toMatchObject({ retryable: false, accountState: true });
  });

  test("retries 429, 5xx and daily limits with bounded Retry-After", () => {
    expect(classifyProviderError(429, {}, "5")).toMatchObject({
      retryable: true,
      retryAfterMs: 5000,
    });
    expect(classifyProviderError(503, {}, null).retryable).toBe(true);
    expect(
      classifyProviderError(403, { error: { details: [{ code: "SMI_115" }] } }).retryAfterMs,
    ).toBe(86400000);
    expect(classifyProviderError(500, {}, null, Date.now(), "sms").retryable).toBe(false);
    expect(classifyProviderError(503, {}, null, Date.now(), "sms").retryable).toBe(false);
    expect(
      classifyProviderError(503, { error: { code: "SM_133" } }, null, Date.now(), "sms").retryable,
    ).toBe(false);
    expect(
      classifyProviderError(503, { error: { code: "SM_133" } }, null, Date.now(), "sms")
        .accountState,
    ).toBe(true);
    expect(
      classifyProviderError(403, { error: { details: [{ code: "SMI_115" }] } }, "90000").code,
    ).toBe("ZOHO_CPAAS_RETRY_AFTER_TOO_LONG");
    expect(
      classifyProviderError(
        403,
        { error: { details: [{ code: "SMI_115" }] } },
        "999999999999999999999999999999999",
      ).code,
    ).toBe("ZOHO_CPAAS_RETRY_AFTER_TOO_LONG");
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:05 GMT", 0)).toBe(5000);
    expect(parseRetryAfter("172800")).toBe(172800000);
    expect(parseRetryAfter("999999999999999999999999999999999")).toBeUndefined();
    expect(
      classifyProviderError(
        403,
        { error: { code: "TM_3601", details: [{ code: "SERR_120" }, { code: "SMI_115" }] } },
        "5",
      ),
    ).toMatchObject({ retryable: true, retryAfterMs: 86400000 });
    expect(classifyProviderError(429, { error: { code: "TM_3601" } }).retryable).toBe(false);
    expect(classifyProviderError(429, { data: { error_code: "TM_3301" } }).retryable).toBe(false);
    expect(
      classifyProviderError(429, { error: { code: "TM_4001", details: [{ code: "SERR_157" }] } })
        .retryable,
    ).toBe(false);
    expect(
      classifyProviderError(429, { error: { details: [{ code: "SERR_157" }] } }).retryable,
    ).toBe(false);
    expect(
      classifyProviderError(
        503,
        { error: { details: [{ code: "SMS_108" }] } },
        null,
        Date.now(),
        "sms",
      ),
    ).toMatchObject({ retryable: false, subCode: "SMS_108" });
    expect(
      classifyProviderError(429, {
        error: { code: "TM_3601", details: [{ code: "SERR_157" }, { code: "SMI_115" }] },
      }).retryable,
    ).toBe(false);
    expect(
      classifyProviderError(503, {
        error: { code: "TM_4001", details: [{ code: "OTHER" }, { code: "SM_128" }] },
      }),
    ).toMatchObject({ retryable: false, accountState: true });
    expect(
      classifyProviderError(
        403,
        { error: { code: "TM_3601", details: [{ code: "SMI_115" }] } },
        "172800",
      ),
    ).toMatchObject({ retryable: false, code: "ZOHO_CPAAS_RETRY_AFTER_TOO_LONG" });
    expect(retryBackoffMs(5)).toBe(16000);
  });

  test("treats ambiguous SMS/WhatsApp network failures as permanent for this send", () => {
    expect(classifyNetworkError("sms").retryable).toBe(false);
    expect(classifyNetworkError("whatsapp").retryable).toBe(false);
    expect(classifyNetworkError("email").retryable).toBe(true);
  });

  test("allows monotonic states and terminal bounce, but no reversals", () => {
    expect(canTransitionStatus("queued", "sending", "email")).toBe(true);
    expect(canTransitionStatus("accepted", "bounced", "email")).toBe(true);
    expect(canTransitionStatus("accepted", "delivered", "email")).toBe(false);
    expect(canTransitionStatus("delivered", "failed", "whatsapp")).toBe(true);
    expect(canTransitionStatus("read", "accepted", "whatsapp")).toBe(false);
    expect(canTransitionStatus("read", "delivered", "whatsapp")).toBe(false);
    expect(canTransitionStatus("read", "failed", "whatsapp")).toBe(false);
    expect(canTransitionStatus("read", "read", "whatsapp")).toBe(false);
    expect(canTransitionStatus("complained", "accepted", "email")).toBe(false);
    expect(canTransitionStatus("sending", "canceled", "email")).toBe(false);
  });
});

test("stableStringify sorts keys at every depth and matches JSON for ordered data", () => {
  expect(stableStringify({ b: 1, a: { d: [{ y: 1, x: 2 }], c: undefined } })).toBe(
    '{"a":{"d":[{"x":2,"y":1}]},"b":1}',
  );
  expect(stableStringify({ a: 1, b: [1, "x", null] })).toBe(
    JSON.stringify({ a: 1, b: [1, "x", null] }),
  );
  expect(stableStringify([undefined])).toBe("[null]");
  expect(stableStringify(undefined)).toBe("null");
});

test("every documented provider error code survives classification verbatim", () => {
  for (const code of zohoCpaasProviderErrorCodes)
    expect(classifyProviderError(400, { error: { code } }).code).toBe(code);
});
