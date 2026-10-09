// @vitest-environment node
import { describe, expect, test } from "vitest";
import { parseWebhookBody } from "../src/shared/webhook.js";
import { sanitizeE2eFixture } from "./e2e-fixtures.mjs";

const email = "private.person+tag@private.example";
const secret = "ts=1790000000000;s=secret%2Bcredential;s-algorithm=HmacSHA256";

describe("e2e fixture redaction", () => {
  test.each(["json", "form"])(
    "preserves parse shape for %s without retaining secrets",
    (encoding) => {
      const payload = {
        webhook_request_id: "account-42-confidential",
        request_id: "account-42-confidential",
        event_name: ["hardbounce", "fbl_complaint"],
        event_message: [
          {
            email_info: {
              email_reference: "private-message-99",
              client_reference: "private-message-99",
              to: [{ email_address: { address: email, name: "Private Person" } }],
              from: { address: "sender@private.example", name: "Sender Name" },
              processed_time: "2026-10-04T09:00:00Z",
            },
            event_data: [
              {
                details: [{ reason: "Private Person at 192.0.2.44", time: "2026-10-04T09:01:00Z" }],
              },
            ],
            "private.person@private.example": {
              vpa: "private@bank",
              card: "4111111111111111",
              amount: 987654321,
            },
          },
        ],
      };
      const json = JSON.stringify(payload);
      const fixture = sanitizeE2eFixture({
        rawBody: encoding === "form" ? `data=${encodeURIComponent(json)}` : json,
        contentType:
          encoding === "form"
            ? "application/x-www-form-urlencoded; charset=utf-8"
            : "application/json",
        signature: secret,
        reason: "accepted",
        receivedAt: "2026-10-04T09:02:00.000Z",
        parserResult: {
          events: [
            {
              type: "hardbounce",
              channel: "email",
              recipient: email,
              providerRequestId: payload.request_id,
              providerMessageId: "private-message-99",
              clientReference: "private-message-99",
            },
          ],
        },
      });
      const text = JSON.stringify(fixture);
      for (const sensitive of [
        email,
        "Private Person",
        "private.example",
        "private@bank",
        "4111111111111111",
        "987654321",
        "192.0.2.44",
        "account-42-confidential",
        "private-message-99",
        "secret%2Bcredential",
      ]) {
        expect(text).not.toContain(sensitive);
      }
      expect(fixture.signature).toBe("[redacted-signature]");
      expect(fixture.signatureUrlEncoded).toBe(true);
      expect(fixture.formField).toBe(encoding === "form" ? "data" : null);
      expect(fixture.expected?.events[0]).toMatchObject({
        type: "hardbounce",
        channel: "email",
        hasRecipient: true,
      });
      const body = JSON.parse(
        encoding === "form" ? decodeURIComponent(fixture.body.slice(5)) : fixture.body,
      );
      expect(body.event_name).toEqual(["hardbounce", "fbl_complaint"]);
      expect(body.webhook_request_id).toBe(body.request_id);
      expect(body.event_message[0].email_info.email_reference).toBe(
        body.event_message[0].email_info.client_reference,
      );
      expect(body.event_message[0].email_info.to[0].email_address.address).toMatch(
        /@example\.invalid$/,
      );
      expect(body.event_message[0].email_info.from.address).toMatch(/@example\.invalid$/);
      expect(Object.keys(body.event_message[0])).toContain("redacted_key_1");
    },
  );

  test("unknown event names and malformed bodies are non-disclosing", () => {
    const unknown = sanitizeE2eFixture({
      rawBody: JSON.stringify({
        webhook_request_id: "account-secret",
        event_name: ["someone@private.example"],
        event_message: [{}],
      }),
      contentType: "text/plain; private=account-secret",
      signature: null,
      reason: "account-secret",
      parserResult: { events: [{ type: "unknown", channel: "unknown" }] },
    });
    expect(unknown.contentType).toBe("unknown");
    expect(unknown.reason).toBe("redacted");
    expect(JSON.parse(unknown.body).event_name).toEqual(["redacted"]);
    expect(JSON.stringify(unknown)).not.toContain("account-secret");
    expect(JSON.stringify(unknown)).not.toContain("someone@private.example");

    const malformed = sanitizeE2eFixture({
      rawBody: "data=%E0%A4%Aprivate-secret",
      contentType: "application/x-www-form-urlencoded",
      signature: "private-secret",
      parserResult: null,
    });
    expect(malformed.body).toBe('{"redacted_malformed_body":true}');
    expect(malformed.expected).toBeNull();
    expect(JSON.stringify(malformed)).not.toContain("private-secret");
  });

  test("redacts unknown form field and checks signature encoding only in s=", () => {
    const body = JSON.stringify({
      webhook_request_id: "private-id",
      event_name: "read",
      event_message: [{}],
    });
    const fixture = sanitizeE2eFixture({
      rawBody: `private.person%40example.com=${encodeURIComponent(body)}`,
      contentType: "application/x-www-form-urlencoded",
      signature: "note=secret%2Bcredential;s=plain-signature",
      reason: "duplicate",
      parserResult: { events: [{ type: "read", channel: "unknown" }] },
    });
    expect(fixture.formField).toBe("redacted_field");
    expect(fixture.body.startsWith("redacted_field=")).toBe(true);
    expect(fixture.signatureUrlEncoded).toBe(false);
    expect(JSON.stringify(fixture)).not.toContain("private.person");
    expect(JSON.stringify(fixture)).not.toContain("secret%2Bcredential");
  });

  test("bounds deeply nested provider data", () => {
    let nested = { address: "private.person@example.com" };
    for (let index = 0; index < 50; index++) nested = { details: [nested] };
    const fixture = sanitizeE2eFixture({
      rawBody: JSON.stringify({
        webhook_request_id: "private-id",
        event_name: "open",
        event_message: [nested],
      }),
      parserResult: { events: [{ type: "open", channel: "unknown" }] },
    });
    expect(fixture.expected).toBeNull();
    expect(fixture.body).toBe('{"redacted_malformed_body":true}');
    expect(JSON.stringify(fixture)).not.toContain("private.person@example.com");
  });

  test("retains parser aliases and deduplicated case-insensitive email recipients", () => {
    const payload = {
      webhook_request_id: "private-webhook-id",
      event_name: ["Email-Link-Click"],
      event_message: [
        {
          email_info: {
            to: [
              { email_address: { address: "Alice@Private.Example" } },
              { email_address: { address: "alice@private.example" } },
            ],
          },
        },
      ],
    };
    const rawBody = `data=${encodeURIComponent(JSON.stringify(payload))}`;
    const original = parseWebhookBody(rawBody, 1704067200000);
    expect(original?.events[0]).toMatchObject({
      type: "click",
      channel: "email",
      recipient: "alice@private.example",
    });
    const fixture = sanitizeE2eFixture({ rawBody, parserResult: original });
    const sanitized = parseWebhookBody(fixture.body, 1704067200000);
    const sanitizedPayload = JSON.parse(decodeURIComponent(fixture.body.slice(5)));
    expect(sanitizedPayload.event_name).toEqual(["Email-Link-Click"]);
    const addresses = sanitizedPayload.event_message[0].email_info.to.map(
      (item) => item.email_address.address,
    );
    expect(addresses[0]).toBe(addresses[1]);
    expect(sanitized?.events[0]?.type).toBe(original?.events[0]?.type);
    expect(sanitized?.events[0]?.channel).toBe(original?.events[0]?.channel);
    expect(sanitized?.events[0]?.recipient).toBe(addresses[0]);
    expect(fixture.expected?.events[0]?.hasRecipient).toBe(true);
    expect(JSON.stringify(fixture)).not.toContain("Alice@Private.Example");
    expect(JSON.stringify(fixture)).not.toContain("alice@private.example");
  });
});
