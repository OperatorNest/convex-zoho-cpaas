import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSmoke, runSmoke, step, waitFor } from "./smoke-harness.mjs";

function readSiteUrl(workspace) {
  const config = JSON.parse(
    readFileSync(join(workspace, ".convex/local/default/config.json"), "utf8"),
  );
  return `http://127.0.0.1:${config.ports.site}`;
}

// Zoho signs the URL-decoded JSON body with HMAC-SHA256.
function signBody(json, secret) {
  const digest = createHmac("sha256", secret).update(json, "utf8").digest("base64");
  return `ts=${Date.now()};s=${encodeURIComponent(digest)};s-algorithm=HmacSHA256`;
}

await runSmoke(async ({ workspace, runConvexCli, runFunction, setEnvironmentVariable }) => {
  const siteUrl = readSiteUrl(workspace);
  const secret = randomBytes(24).toString("hex");
  const tag = `smoke${Date.now()}`;
  const addressFor = (name) => `${tag}-${name}@example.test`;
  const readMessage = (messageId) => runFunction("example:get", { messageId });
  const waitForStatus = (messageId, status) =>
    waitFor(async () => {
      const message = await readMessage(messageId);
      return message?.status === status ? message : null;
    });
  const countCallbacks = () => runFunction("example:webhookCallbackCount");
  const listSuppressions = () =>
    runFunction("example:listSuppressions", { paginationOpts: { numItems: 50, cursor: null } });
  const readReceipts = async () =>
    JSON.parse(
      await runConvexCli([
        "data",
        "--component",
        "zohoCpaas",
        "webhookReceipts",
        "--format",
        "jsonArray",
      ]),
    );
  const postWebhook = async (json, signature) => {
    const response = await fetch(`${siteUrl}/zoho-cpaas/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "producer-signature": signature,
      },
      body: `data=${encodeURIComponent(json)}`,
    });
    return response.status;
  };

  await setEnvironmentVariable("ZOHO_CPAAS_REGION", "in");
  await setEnvironmentVariable("ZOHO_CPAAS_TEST_MODE", "true");
  await setEnvironmentVariable("ZOHO_CPAAS_WEBHOOK_SECRET", secret);
  await waitFor(async () => {
    try {
      const config = await runFunction("example:getConfig", {});
      return config.testMode === true && config.region === "in";
    } catch {
      return false;
    }
  });

  await step("files.upload returns a simulated file-cache key", async () => {
    const fileCacheKey = await runFunction("example:upload", {
      name: "smoke.txt",
      mimeType: "text/plain",
      content: { $bytes: "c21va2U=" },
    });
    assertSmoke(
      typeof fileCacheKey === "string" && fileCacheKey.startsWith("test-file-"),
      String(fileCacheKey),
    );
  });

  const emailRequest = {
    to: addressFor("bounce"),
    subject: "Smoke",
    textbody: "Hello",
    idempotencyKey: `${tag}-key`,
  };
  const [sentId] = await runFunction("example:sendEmail", emailRequest);
  let sent;
  await step("email.send reaches accepted", async () => {
    sent = await waitForStatus(sentId, "accepted");
  });
  await step("email.send tagged testMode", () =>
    assertSmoke(sent?.testMode === true, "email.send tagged testMode"),
  );
  await step("idempotent replay returns same ids", async () => {
    const replay = await runFunction("example:sendEmail", emailRequest);
    assertSmoke(replay.length === 1 && replay[0] === sentId, JSON.stringify(replay));
  });

  const batchRequest = {
    recipients: [addressFor("b1"), addressFor("b2"), addressFor("b3")],
    templateKey: "smoke-template",
    idempotencyKey: `${tag}-batch`,
  };
  const batchIds = await runFunction("example:sendTemplateBatch", batchRequest);
  await step("sendTemplateBatch returns 3 rows", () =>
    assertSmoke(
      batchIds.length === 3 && new Set(batchIds).size === 3,
      "sendTemplateBatch returns 3 rows",
    ),
  );
  await step("batch idempotent replay returns same ids", async () => {
    const replay = await runFunction("example:sendTemplateBatch", batchRequest);
    assertSmoke(replay.join() === batchIds.join(), "batch idempotent replay returns same ids");
  });
  await step("batch rows reach accepted in test mode", async () => {
    const rows = [];
    for (const messageId of batchIds) rows.push(await waitForStatus(messageId, "accepted"));
    assertSmoke(
      rows.length === 3 && rows.every((row) => row.testMode === true),
      "batch rows reach accepted in test mode",
    );
  });

  const createBounceBody = (webhookRequestId, extra = {}) =>
    JSON.stringify({
      event_name: ["hardbounce"],
      event_message: [
        {
          email_info: {
            client_reference: sentId,
            subject: "Smoke",
            to: [{ email_address: { address: addressFor("bounce") } }],
            processed_time: new Date().toISOString(),
          },
          object: "email",
          event_data: [
            {
              details: [
                {
                  reason: "Mailbox does not exist",
                  time: new Date().toISOString(),
                  diagnostic_message: "550 5.1.1 user unknown",
                },
              ],
              object: "bounce",
            },
          ],
          request_id: sent?.zohoRequestId,
        },
      ],
      ...(webhookRequestId === undefined ? {} : { webhook_request_id: webhookRequestId }),
      ...extra,
    });
  const callbacksBefore = await countCallbacks();
  const bounceBody = createBounceBody(`${tag}-wh1`);
  await step("signed hard-bounce webhook returns 200", async () => {
    const status = await postWebhook(bounceBody, signBody(bounceBody, secret));
    assertSmoke(status === 200, `status ${status}`);
  });
  await step("message status becomes bounced", async () => {
    const message = await readMessage(sentId);
    assertSmoke(message?.status === "bounced", String(message?.status));
  });
  await step("bounced address added to suppressions", async () => {
    const suppressions = await listSuppressions();
    assertSmoke(
      suppressions.some(
        (suppression) =>
          suppression.address === addressFor("bounce") && suppression.reason === "hardbounce",
      ),
    );
  });
  const callbacksAfter = await countCallbacks();
  await step("onEvent callback ran once", () =>
    assertSmoke(callbacksAfter === callbacksBefore + 1, `${callbacksBefore} -> ${callbacksAfter}`),
  );
  await step("replayed webhook returns 200", async () => {
    const status = await postWebhook(bounceBody, signBody(bounceBody, secret));
    assertSmoke(status === 200, `status ${status}`);
  });
  await step("replayed webhook does not rerun callback", async () =>
    assertSmoke(
      (await countCallbacks()) === callbacksAfter,
      "replayed webhook does not rerun callback",
    ),
  );
  await step("bad signature returns 401", async () => {
    const status = await postWebhook(bounceBody, signBody(bounceBody, `${secret}x`));
    assertSmoke(status === 401, `status ${status}`);
  });
  const receiptsBefore = (await readReceipts()).length;
  const unidentifiedBody = createBounceBody(undefined, { note: tag });
  await step("signed body without webhook_request_id returns 200", async () => {
    const status = await postWebhook(unidentifiedBody, signBody(unidentifiedBody, secret));
    assertSmoke(status === 200, `status ${status}`);
  });
  await step("failed receipt recorded", async () =>
    assertSmoke((await readReceipts()).length === receiptsBefore + 1, "failed receipt recorded"),
  );
  await step("failed receipt does not run callback", async () =>
    assertSmoke(
      (await countCallbacks()) === callbacksAfter,
      "failed receipt does not run callback",
    ),
  );

  const countStaleReceipts = async () =>
    (await readReceipts()).filter((receipt) => receipt.reason === "stale_event").length;
  const staleReceiptsBefore = await countStaleReceipts();
  const undatedBody = JSON.stringify({
    webhook_request_id: `${tag}-undated`,
    event_name: ["delivered"],
    event_message: [{ channel: "whatsapp", to: "+15550100002", client_reference: tag }],
  });
  await step("signed webhook without an event time returns 200", async () => {
    const status = await postWebhook(undatedBody, signBody(undatedBody, secret));
    assertSmoke(status === 200, `status ${status}`);
  });
  await step("webhook without an event time records one stale_event receipt", async () =>
    assertSmoke(
      (await countStaleReceipts()) === staleReceiptsBefore + 1,
      "webhook without an event time records one stale_event receipt",
    ),
  );
  await step("webhook without an event time does not run callback", async () =>
    assertSmoke(
      (await countCallbacks()) === callbacksAfter,
      "webhook without an event time does not run callback",
    ),
  );

  await step("send to suppressed address is rejected as ZOHO_CPAAS_ALL_SUPPRESSED", async () => {
    const outcome = await runFunction("example:sendEmail", {
      to: addressFor("bounce"),
      subject: "Blocked",
      textbody: "Body",
    }).then(
      () => "accepted",
      (error) => String(error instanceof Error ? error.message : error),
    );
    assertSmoke(outcome.includes("ZOHO_CPAAS_ALL_SUPPRESSED"), outcome);
  });
  await step("suppressed batch row is suppressed without a provider call", async () => {
    const messageIds = await runFunction("example:sendTemplateBatch", {
      recipients: [addressFor("bounce"), addressFor("fresh")],
      templateKey: "smoke-template",
    });
    const messages = await Promise.all(messageIds.map((messageId) => readMessage(messageId)));
    assertSmoke(
      messages.some(
        (message) => message?.to === addressFor("bounce") && message.status === "suppressed",
      ),
    );
  });

  const pageRecipient = addressFor("page");
  for (const subject of ["P1", "P2", "P3"])
    await runFunction("example:sendEmail", { to: pageRecipient, subject, textbody: "x" });
  const listPage = (recipient, cursor) =>
    runFunction("example:list", {
      recipient,
      channel: "email",
      paginationOpts: { numItems: 2, cursor },
    });
  const firstPage = await listPage(pageRecipient, null);
  await step("list page 1 has 2 rows", () =>
    assertSmoke(
      firstPage.page.length === 2 && firstPage.isDone === false,
      "list page 1 has 2 rows",
    ),
  );
  await step("list page 2 has the remaining row", async () => {
    const secondPage = await listPage(pageRecipient, firstPage.continueCursor);
    assertSmoke(
      secondPage.page.length === 1 &&
        !firstPage.page.some((message) => message.messageId === secondPage.page[0].messageId),
    );
  });
  await step("list normalizes recipient before indexed lookup", async () => {
    const normalizedPage = await listPage(pageRecipient.toUpperCase(), null);
    assertSmoke(
      normalizedPage.page.length === 2 &&
        normalizedPage.page.every(
          (message, index) => message.messageId === firstPage.page[index]?.messageId,
        ),
    );
  });
  await step("removeSuppression removes the address", async () =>
    assertSmoke(
      (await runFunction("example:removeSuppression", { address: addressFor("bounce") })) === true,
    ),
  );
  await step("suppression list no longer has the address", async () =>
    assertSmoke(
      !(await listSuppressions()).some(
        (suppression) => suppression.address === addressFor("bounce"),
      ),
    ),
  );

  await step("whatsapp.sendTemplate accepted", async () => {
    const messageId = await runFunction("example:sendWhatsappTemplate", {
      from: "+15550100001",
      to: "+15550100002",
      templateKey: "smoke-template",
    });
    assertSmoke(
      (await waitForStatus(messageId, "accepted")).testMode === true,
      "whatsapp.sendTemplate accepted",
    );
  });
  await step("sms.sendTemplate accepted", async () => {
    const messageId = await runFunction("example:sendSmsTemplate", {
      senderKey: "smoke-sender",
      to: "+919876543210",
      templateKey: "smoke-template",
    });
    assertSmoke(
      (await waitForStatus(messageId, "accepted")).testMode === true,
      "sms.sendTemplate accepted",
    );
  });
});
