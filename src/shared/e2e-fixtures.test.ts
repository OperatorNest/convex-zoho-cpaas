import { expect, test } from "vitest";
import { parseWebhookBody } from "./webhook.js";

type Fixture = {
  body: string;
  expected: null | {
    eventCount: number;
    events: Array<{
      type: string;
      channel: string;
      hasRecipient: boolean;
      hasProviderRequestId: boolean;
      hasProviderMessageId: boolean;
      hasClientReference: boolean;
    }>;
  };
};

const fixtureModules = import.meta.glob<{ default: Fixture }>("../../tests/fixtures/e2e/**/*.json");
const e2eFixtures = Object.entries(fixtureModules).filter(([path]) =>
  path.includes("/tests/fixtures/e2e/"),
);

test.skipIf(e2eFixtures.length === 0)(
  "redacted end-to-end fixtures retain observed parser mapping",
  async () => {
    for (const [path, load] of e2eFixtures) {
      const { default: fixture } = await load();
      const parsed = parseWebhookBody(fixture.body, 1704067200000);
      if (fixture.expected === null) {
        expect(parsed, path).toBeNull();
        continue;
      }
      expect(parsed, path).not.toBeNull();
      expect(parsed?.events.length, path).toBe(fixture.expected.eventCount);
      expect(
        parsed?.events.map((event) => ({
          type: event.type,
          channel: event.channel,
          hasRecipient: event.recipient !== undefined,
          hasProviderRequestId: event.providerRequestId !== undefined,
          hasProviderMessageId: event.providerMessageId !== undefined,
          hasClientReference: event.clientReference !== undefined,
        })),
        path,
      ).toEqual(fixture.expected.events);
    }
  },
);
