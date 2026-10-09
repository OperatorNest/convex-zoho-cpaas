// Interactive maintainer verification against a real Zoho account on an existing local deployment.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { acquireLock } from "./with-local-lock.mjs";
import { getLocalCliEnv, loadE2eEnv, readE2eEnv } from "./e2e-env.mjs";
import { saveE2eFixture } from "./e2e-fixtures.mjs";

const requiredNames = [
  "ZOHO_CPAAS_REGION",
  "ZOHO_CPAAS_WEBHOOK_SECRET",
  "E2E_EMAIL_FROM",
  "E2E_EMAIL_TO",
];
const optionalNames = [
  "E2E_EMAIL_BATCH_ALIAS",
  "E2E_EMAIL_TEMPLATE_KEY",
  "E2E_EMAIL_TEMPLATE_MERGE_INFO",
  "E2E_BOUNCE_TO",
  "E2E_WHATSAPP_FROM",
  "E2E_WHATSAPP_TO",
  "E2E_WHATSAPP_TEMPLATE",
  "E2E_WHATSAPP_MERGE_INFO",
  "E2E_SMS_SENDER_KEY",
  "E2E_SMS_TO",
  "E2E_SMS_TEMPLATE",
  "E2E_SMS_TEMPLATE_KEY",
  "E2E_SMS_MERGE_INFO",
];
const webhookPath = "/zoho-cpaas/e2e-webhook";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
let cancelRequested = false;

function assertActive() {
  if (cancelRequested) throw new Error("Interrupted");
}

function check(label, ok) {
  checks.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

function parseOptions(argv) {
  let dryRun = false;
  let waitMinutes = 10;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--wait") {
      waitMinutes = Number(argv[++index]);
      if (!Number.isFinite(waitMinutes) || waitMinutes <= 0 || waitMinutes > 1425)
        throw new Error("--wait must be a number greater than 0 and at most 1425 minutes");
    } else throw new Error("Unknown e2e option; use --dry-run or --wait <minutes>");
  }
  return { dryRun, waitMinutes };
}

function configuration(values) {
  const missing = requiredNames.filter((name) => !values.get(name));
  if (!values.get("ZOHO_CPAAS_TOKEN") && !values.get("ZOHO_CPAAS_EMAIL_TOKEN"))
    missing.push("ZOHO_CPAAS_TOKEN or ZOHO_CPAAS_EMAIL_TOKEN");
  const forbiddenTestMode =
    values.get("ZOHO_CPAAS_TEST_MODE") === "true" || process.env.ZOHO_CPAAS_TEST_MODE === "true";
  const region = values.get("ZOHO_CPAAS_REGION");
  if (region && !["us", "eu", "in", "au", "jp", "cn"].includes(region))
    missing.push("ZOHO_CPAAS_REGION (valid value)");
  return { missing, forbiddenTestMode, region };
}

function printPlan(values, options, config) {
  console.log("End-to-end verification plan (names only; no network calls in dry run)");
  console.log(`Required missing: ${config.missing.length ? config.missing.join(", ") : "none"}`);
  console.log(
    `Test mode active in input or process: ${config.forbiddenTestMode ? "yes (refused)" : "no"}`,
  );
  console.log(
    `Optional inputs present: ${optionalNames.filter((name) => values.get(name)).join(", ") || "none"}`,
  );
  console.log(
    `Optional inputs missing: ${optionalNames.filter((name) => !values.get(name)).join(", ") || "none"}`,
  );
  console.log(`Wait: ${options.waitMinutes} minute(s)`);
  console.log(
    "Plan: lock, build, local Convex dev, load deployment env, tunnel, dashboard setup, sends, webhook wait/replay, redacted fixtures, cleanup.",
  );
  console.log(
    config.region === "in"
      ? "SMS: India region; configured template inputs enable the send."
      : "SMS: SKIP (Zoho SMS is India-only; region is not in).",
  );
}

function localUrls() {
  return getLocalCliEnv();
}

function command(args, { input, timeout = 120_000 } = {}) {
  const result = spawnSync("pnpm", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: getLocalCliEnv().env,
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`Local command failed: pnpm ${args.slice(0, 2).join(" ")}`);
  return result.stdout.trim();
}

function run(name, args = {}) {
  const result = spawnSync(process.execPath, ["scripts/convex-run-stdin.mjs", name], {
    input: JSON.stringify(args),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: getLocalCliEnv().env,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Local Convex function failed: ${name}`);
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`Local Convex response was invalid: ${name}`);
  }
}

function startDev() {
  const child = spawn("pnpm", ["exec", "convex", "dev", "--env-file", ".env.local"], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: getLocalCliEnv().env,
  });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Local Convex dev did not become ready")),
      120_000,
    );
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-4000);
      if (/functions ready/i.test(output)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not start local Convex dev"));
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Local Convex dev exited before readiness"));
    });
  });
  return { child, ready };
}

function cloudflaredPath() {
  const found = spawnSync("which", ["cloudflared"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  const fallback = join(homedir(), ".local/bin/cloudflared");
  if (existsSync(fallback)) return fallback;
  throw new Error("cloudflared is missing from PATH and ~/.local/bin/cloudflared");
}

function startTunnel(site) {
  const child = spawn(cloudflaredPath(), ["tunnel", "--url", site], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Cloudflare quick tunnel did not become ready")),
      90_000,
    );
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-8000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not start Cloudflare quick tunnel"));
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Cloudflare quick tunnel exited before readiness"));
    });
  });
  return { child, ready };
}

async function stopProcess(proc) {
  if (!proc?.child.pid) return;
  try {
    process.kill(-proc.child.pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([new Promise((resolve) => proc.child.once("exit", resolve)), sleep(5000)]);
  try {
    process.kill(-proc.child.pid, "SIGKILL");
  } catch {
    /* exited */
  }
}

async function waitFor(fn, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertActive();
    try {
      const result = fn();
      if (result) return result;
    } catch (error) {
      if (cancelRequested) throw error;
      // The local deployment may still be applying code or environment values.
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function stringMap(values, name) {
  const raw = values.get(name);
  if (!raw) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be a JSON object of string values`);
  }
  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== "object" ||
    Object.values(parsed).some((value) => typeof value !== "string")
  )
    throw new Error(`${name} must be a JSON object of string values`);
  return parsed;
}

async function acceptedMessage(id) {
  return waitFor(() => {
    const row = run("example:getMessage", { messageId: id });
    if (row?.status === "failed") throw new Error("Provider send failed");
    return ["accepted", "delivered", "read", "bounced"].includes(row?.status) ? row : null;
  }, "provider send acceptance");
}

async function sendOperation(label, fn, allSentIds) {
  try {
    assertActive();
    const ids = fn();
    const list = Array.isArray(ids) ? ids : [ids];
    if (list.length === 0 || list.some((id) => typeof id !== "string"))
      throw new Error("No message IDs");
    for (const id of list) {
      const row = await acceptedMessage(id);
      if (row.testMode === true) throw new Error("Test-mode message row");
      allSentIds.add(id);
    }
    check(label, true);
    return list;
  } catch (error) {
    if (cancelRequested) throw error;
    check(label, false);
    return [];
  }
}

function decodePayload(rawBody) {
  try {
    const trimmed = rawBody.trimStart();
    const text = trimmed.startsWith("{")
      ? rawBody
      : decodeURIComponent(rawBody.replace(/\+/g, " ")).replace(/^[^=]+=+/, "");
    const value = JSON.parse(text);
    if (!value || typeof value !== "object") return null;
    return value;
  } catch {
    return null;
  }
}

function receiptsFor(providerEventId) {
  const rows = JSON.parse(
    command([
      "exec",
      "convex",
      "data",
      "--component",
      "zohoCpaas",
      "webhookReceipts",
      "--format",
      "jsonArray",
      "--limit",
      "1000",
    ]),
  );
  return rows.filter((row) => row.providerEventId === providerEventId && !row.reason);
}

function eventName(payload) {
  const name = Array.isArray(payload?.event_name) ? payload.event_name[0] : payload?.event_name;
  return typeof name === "string" ? name.toLowerCase() : "";
}

function mappedType(name) {
  return (
    {
      hardbounce: "hardbounce",
      hard_bounce: "hardbounce",
      softbounce: "softbounce",
      soft_bounce: "softbounce",
      fbl: "complaint",
      fbl_complaint: "complaint",
      complaint: "complaint",
      feedback_loop: "complaint",
      open: "open",
      email_open: "open",
      click: "click",
      email_link_click: "click",
      delivered: "delivered",
      read: "read",
      undelivered: "undelivered",
      failed: "failed",
    }[name.replace(/[\s-]+/g, "_")] ?? "unknown"
  );
}

function boxedWebhook(url) {
  const lines = [
    "MAINTAINER: Zoho CPaaS EU dashboard",
    "Agents (Mail Agent) -> choose Agent -> Webhooks -> Configure Webhook",
    `URL: ${url}`,
    "Description: OperatorNest local e2e verification",
    "Enable: Soft bounced, Hard bounced, Open, Click, Feedback loop",
    "If testing WhatsApp: Delivered, Read, Undelivered",
    "Select Add to save the webhook URL and events.",
    "Webhooks tab -> Authentication Key (top right) -> enter the value of ZOHO_CPAAS_WEBHOOK_SECRET from .env.e2e -> Configure",
    "Then return here and press Enter. Open the delivered email and click its link during the countdown.",
  ];
  const width = Math.max(...lines.map((line) => line.length));
  console.log(`\n+${"-".repeat(width + 2)}+`);
  for (const line of lines) console.log(`| ${line.padEnd(width)} |`);
  console.log(`+${"-".repeat(width + 2)}+\n`);
}

async function waitForDashboard(signal) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(
      "Press Enter after the webhook URL, events, and Authentication Key are configured: ",
      { signal },
    );
  } finally {
    rl.close();
  }
}

function appendReport(report) {
  const date = new Date().toISOString().slice(0, 10);
  const safe = [
    "Provider test account observations; these do not qualify production behavior.",
    "",
    "# End-to-end Zoho CPaaS verification",
    "",
    `Observed on ${date} with this repo's anonymous local Convex deployment and a Cloudflare quick tunnel.`,
    "",
    `Region input: ${report.region}. Default host used: ${report.defaultHost ? "yes" : "no (base URL override configured)"}.`,
    `Default EU host accepted an email send: ${report.region === "eu" && report.defaultHost && report.acceptedSends.some((entry) => entry.startsWith("email.")) ? "yes" : "not qualified"}.`,
    `Real provider sends accepted: ${report.acceptedSends.join(", ") || "none"}.`,
    `Observed component response shape: message ID strings with accepted status for listed sends; file upload returned a file_cache_key string: ${report.fileUploaded ? "yes" : "not qualified"}.`,
    `Verified and applied webhook event names: ${report.eventNames.join(", ") || "none"}.`,
    `Webhook content types: ${report.contentTypes.join(", ") || "none"}.`,
    `Form field names: ${report.formFields.join(", ") || "none observed"}.`,
    `producer-signature s= URL encoding observed: ${report.signatureEncoded ? "yes" : "no conclusive sample"}.`,
    `Shared agent token across channels observed: ${report.sharedTokenChannels.join(", ") || "not qualified"}.`,
    `Signature, receipt, callback, and dedupe checks passed: ${report.webhookPassCount}.`,
    `Bounce suppression observed: ${report.bounceSuppression ? "yes" : "not qualified"}.`,
    "Exact raw provider response envelopes remain unobserved because the component retains mapped results only.",
    "Fixtures in this directory are redacted; raw signatures and personal data are never written there.",
    "",
  ].join("\n");
  const path = `tests/fixtures/e2e/${date}-verification-${randomUUID().slice(0, 8)}.md`;
  mkdirSync("tests/fixtures/e2e", { recursive: true });
  writeFileSync(path, safe, { mode: 0o600 });
  return path;
}

function updateVerifiedDocs(report, observationPath) {
  if (!report.verified) return;
  const date = new Date().toISOString().slice(0, 10);
  const readme = readFileSync("README.md", "utf8");
  writeFileSync(
    "README.md",
    readme.replace(
      /^\*\*Verified against:\*\*.*$/m,
      `**Verified against:** Zoho CPaaS ${report.region.toUpperCase()} account on ${date}: real email send and signed webhook verification, application, callback, and replay deduplication. See [the dated result](${observationPath}).`,
    ),
  );
}

async function collectAttempts(
  sessionId,
  site,
  sentIds,
  mainIds,
  bounceIds,
  whatsappIds,
  report,
  ordinal,
) {
  const captureSession = run("e2eWebhook:activeSession");
  if (!captureSession || captureSession.sessionId !== sessionId) {
    check("e2e webhook capture session active", false);
    throw new Error("End-to-end webhook capture session expired; rerun e2e verification");
  }
  if (captureSession.quotaExceeded) {
    check("e2e webhook capture quota", false);
    throw new Error("End-to-end webhook capture exceeded 64 requests; rerun e2e verification");
  }
  const attempts = run("e2eWebhook:pending", { sessionId });
  if (attempts.length === 0) return ordinal;
  const originals = [];
  for (const attempt of attempts) {
    ordinal++;
    const fixture = await saveE2eFixture({
      rawBody: attempt.rawBody,
      contentType: attempt.contentType,
      signature: attempt.signature,
      reason: attempt.reason,
      receivedAt: attempt.receivedAt,
      eventOrdinal: ordinal,
    });
    const payload = decodePayload(attempt.rawBody);
    const eventId = payload?.webhook_request_id;
    const name = eventName(payload);
    if (attempt.reason === "accepted" && typeof eventId === "string") {
      originals.push({ attempt, eventId, name, observations: fixture.observations });
    } else if (!attempt.duplicate) {
      check("real webhook signature and payload", false);
    }
  }
  run("e2eWebhook:clear", { sessionId, ids: attempts.map((attempt) => attempt._id) });

  for (const { attempt, eventId, name, observations } of originals) {
    assertActive();
    const callbacks = run("example:e2eCallbacksFor", { providerEventId: eventId });
    const receipt = receiptsFor(eventId);
    const expectedType = mappedType(name);
    const payload = decodePayload(attempt.rawBody);
    const names = Array.isArray(payload?.event_name) ? payload.event_name : [payload?.event_name];
    const messages = Array.isArray(payload?.event_message)
      ? payload.event_message
      : [payload?.event_message];
    const verified =
      Boolean(attempt.signature) &&
      receipt.length === 1 &&
      callbacks.length === messages.length &&
      callbacks.every(
        (row, index) =>
          row.messageId &&
          sentIds.has(row.messageId) &&
          row.ambiguous !== true &&
          mappedType(String(names[index] ?? names[0] ?? "").toLowerCase()) !== "unknown" &&
          row.type === mappedType(String(names[index] ?? names[0] ?? "").toLowerCase()),
      );
    check(`signed ${expectedType} webhook: receipt, mapping, callback, message`, verified);
    if (!verified) continue;
    if (callbacks.some((row) => row.type === "hardbounce" && bounceIds.has(row.messageId))) {
      const bounced = [...bounceIds].some(
        (id) => run("example:getMessage", { messageId: id })?.status === "bounced",
      );
      const suppressions = run("example:listSuppressions", {
        paginationOpts: { numItems: 100, cursor: null },
      });
      const suppressed = suppressions.some(
        (row) => row.address === report.bounceAddress && row.reason === "hardbounce",
      );
      report.bounceSuppression = bounced && suppressed;
      check("hard bounce applied and recipient suppressed", report.bounceSuppression);
    }
    const before = callbacks.length;
    let replayPassed = false;
    try {
      assertActive();
      const replay = await fetch(`${site}${webhookPath}`, {
        method: "POST",
        headers: { "content-type": attempt.contentType, "producer-signature": attempt.signature },
        body: attempt.rawBody,
      });
      const duplicate = await waitFor(
        () =>
          run("e2eWebhook:pending", { sessionId }).find(
            (row) => row.reason === "duplicate" && row.rawBody === attempt.rawBody,
          ),
        "duplicate replay capture",
        30_000,
      );
      ordinal++;
      await saveE2eFixture({
        rawBody: duplicate.rawBody,
        contentType: duplicate.contentType,
        signature: duplicate.signature,
        reason: duplicate.reason,
        receivedAt: duplicate.receivedAt,
        eventOrdinal: ordinal,
      });
      run("e2eWebhook:clear", { sessionId, ids: [duplicate._id] });
      const after = run("example:e2eCallbacksFor", { providerEventId: eventId }).length;
      replayPassed =
        replay.status === 200 &&
        duplicate.duplicate &&
        before === after &&
        receiptsFor(eventId).length === 1;
    } catch (error) {
      if (cancelRequested) throw error;
    }
    check(`signed ${expectedType} replay deduplicated`, replayPassed);
    if (!replayPassed) continue;
    report.webhookPassCount++;
    if (observations.contentType) report.contentTypes.add(observations.contentType);
    if (observations.formField) report.formFields.add(observations.formField);
    if (observations.signatureUrlEncoded) report.signatureEncoded = true;
    for (const rawEventName of names)
      if (
        typeof rawEventName === "string" &&
        mappedType(rawEventName.toLowerCase()) !== "unknown" &&
        /^[a-z_ -]{1,40}$/.test(rawEventName.toLowerCase())
      )
        report.eventNames.add(rawEventName);
    if (callbacks.some((row) => row.type === "open" && mainIds.has(row.messageId)))
      report.open = true;
    if (callbacks.some((row) => row.type === "click" && mainIds.has(row.messageId)))
      report.click = true;
    if (
      callbacks.some(
        (row) =>
          row.channel === "whatsapp" &&
          whatsappIds.has(row.messageId) &&
          ["delivered", "read", "undelivered", "failed"].includes(row.type),
      )
    )
      report.whatsapp = true;
  }
  return ordinal;
}

async function performE2e(values, options) {
  let release;
  let dev;
  let tunnel;
  let sessionId;
  let ordinal = 0;
  const controller = new AbortController();
  const interrupted = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("Interrupted")), {
      once: true,
    });
  });
  const onSignal = () => {
    cancelRequested = true;
    controller.abort();
    if (!release) process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const report = {
    region: values.get("ZOHO_CPAAS_REGION"),
    defaultHost: !values.get("ZOHO_CPAAS_BASE_URL"),
    acceptedSends: [],
    eventNames: new Set(),
    contentTypes: new Set(),
    formFields: new Set(),
    sharedTokenChannels: [],
    fileUploaded: false,
    signatureEncoded: false,
    webhookPassCount: 0,
    open: false,
    click: false,
    whatsapp: false,
    bounceSuppression: false,
    bounceAddress: values.get("E2E_BOUNCE_TO")?.trim().toLowerCase(),
    verified: false,
  };
  try {
    release = await acquireLock();
    assertActive();
    const { site } = localUrls();
    console.log("Building and starting the existing anonymous local Convex deployment...");
    command(["build"]);
    assertActive();
    dev = startDev();
    await Promise.race([dev.ready, interrupted]);
    assertActive();
    loadE2eEnv(values, { replace: true });
    assertActive();
    await waitFor(() => {
      const status = run("example:status");
      return status.configured && status.testMode === false && status.region === report.region;
    }, "e2e deployment configuration");
    check("local component configured in e2e mode", true);
    sessionId = randomUUID();
    run("e2eWebhook:begin", { sessionId, durationMinutes: Math.ceil(options.waitMinutes) + 10 });
    tunnel = startTunnel(site);
    const publicBase = await Promise.race([tunnel.ready, interrupted]);
    boxedWebhook(`${publicBase}${webhookPath}`);
    await waitForDashboard(controller.signal);
    assertActive();
    run("e2eWebhook:begin", { sessionId, durationMinutes: Math.ceil(options.waitMinutes) + 10 });

    const tag = `e2e-${Date.now()}`;
    const from = values.get("E2E_EMAIL_FROM");
    const to = values.get("E2E_EMAIL_TO");
    const allSentIds = new Set();
    const mainIds = new Set(
      await sendOperation(
        "email.send (tracked HTML + text)",
        () => run("example:e2eSendEmail", { from, to, tag }),
        allSentIds,
      ),
    );
    if (mainIds.size) report.acceptedSends.push("email.send");

    if (values.get("E2E_EMAIL_TEMPLATE_KEY")) {
      const ids = await sendOperation(
        "email.sendTemplate",
        () =>
          run("example:e2eSendTemplate", {
            from,
            to,
            templateKey: values.get("E2E_EMAIL_TEMPLATE_KEY"),
            ...(stringMap(values, "E2E_EMAIL_TEMPLATE_MERGE_INFO")
              ? { mergeInfo: stringMap(values, "E2E_EMAIL_TEMPLATE_MERGE_INFO") }
              : {}),
          }),
        allSentIds,
      );
      if (ids.length) report.acceptedSends.push("email.sendTemplate");
    } else console.log("SKIP  email.sendTemplate (E2E_EMAIL_TEMPLATE_KEY absent)");

    const recipients = [
      to,
      ...(values.get("E2E_EMAIL_BATCH_ALIAS") ? [values.get("E2E_EMAIL_BATCH_ALIAS")] : []),
    ];
    const batchIds = await sendOperation(
      `email.sendBatch (${recipients.length} recipient(s))`,
      () => run("example:e2eSendBatch", { from, recipients, tag }),
      allSentIds,
    );
    if (batchIds.length) report.acceptedSends.push("email.sendBatch");

    let fileKey;
    try {
      assertActive();
      fileKey = run("example:uploadFile", {
        name: "verification.txt",
        mimeType: "text/plain",
        content: { $bytes: Buffer.from("OperatorNest e2e verification\n").toString("base64") },
      });
      check(
        "email.uploadFile returned file_cache_key",
        typeof fileKey === "string" && fileKey.length > 0,
      );
      report.fileUploaded = typeof fileKey === "string" && fileKey.length > 0;
    } catch (error) {
      if (cancelRequested) throw error;
      check("email.uploadFile returned file_cache_key", false);
    }
    if (fileKey) {
      const ids = await sendOperation(
        "email.send with file_cache_key attachment",
        () =>
          run("example:e2eSendEmail", {
            from,
            to,
            tag: `${tag}-attachment`,
            attachmentKey: fileKey,
          }),
        allSentIds,
      );
      if (ids.length) report.acceptedSends.push("email.attachment");
    }

    const bounceIds = new Set();
    if (values.get("E2E_BOUNCE_TO")) {
      const ids = await sendOperation(
        "email.send to owner-provided bounce address",
        () =>
          run("example:e2eSendEmail", {
            from,
            to: values.get("E2E_BOUNCE_TO"),
            tag: `${tag}-bounce`,
          }),
        allSentIds,
      );
      for (const id of ids) bounceIds.add(id);
      if (ids.length) report.acceptedSends.push("email.bounce-probe");
    } else
      console.log(
        "SKIP  hard bounce: add E2E_BOUNCE_TO as a guaranteed-invalid address on your own verified domain before a rerun",
      );

    const whatsappIds = new Set();
    const whatsapp = ["E2E_WHATSAPP_FROM", "E2E_WHATSAPP_TO", "E2E_WHATSAPP_TEMPLATE"];
    if (whatsapp.every((name) => values.get(name))) {
      const ids = await sendOperation(
        "experimental WhatsApp template send",
        () =>
          run("example:e2eSendWhatsapp", {
            from: values.get("E2E_WHATSAPP_FROM"),
            to: values.get("E2E_WHATSAPP_TO"),
            templateKey: values.get("E2E_WHATSAPP_TEMPLATE"),
            ...(stringMap(values, "E2E_WHATSAPP_MERGE_INFO")
              ? { mergeInfo: stringMap(values, "E2E_WHATSAPP_MERGE_INFO") }
              : {}),
          }),
        allSentIds,
      );
      if (ids.length) {
        for (const id of ids) whatsappIds.add(id);
        report.acceptedSends.push("whatsapp.sendTemplate");
        if (
          values.get("ZOHO_CPAAS_TOKEN") &&
          !values.get("ZOHO_CPAAS_WHATSAPP_TOKEN") &&
          !values.get("ZOHO_CPAAS_EMAIL_TOKEN")
        )
          if (report.acceptedSends.some((entry) => entry.startsWith("email.")))
            report.sharedTokenChannels.push("email + WhatsApp");
      }
    } else
      console.log(
        `SKIP  WhatsApp template (missing ${whatsapp.filter((name) => !values.get(name)).join(", ")})`,
      );

    if (report.region !== "in")
      console.log("SKIP  SMS template (Zoho SMS is India-only; region is not in)");
    else {
      const sms = ["E2E_SMS_SENDER_KEY", "E2E_SMS_TO"];
      const template = values.get("E2E_SMS_TEMPLATE") ?? values.get("E2E_SMS_TEMPLATE_KEY");
      if (sms.every((name) => values.get(name)) && template) {
        const ids = await sendOperation(
          "experimental SMS template send",
          () =>
            run("example:e2eSendSms", {
              senderKey: values.get("E2E_SMS_SENDER_KEY"),
              to: values.get("E2E_SMS_TO"),
              templateKey: template,
              ...(stringMap(values, "E2E_SMS_MERGE_INFO")
                ? { mergeInfo: stringMap(values, "E2E_SMS_MERGE_INFO") }
                : {}),
            }),
          allSentIds,
        );
        if (ids.length) {
          report.acceptedSends.push("sms.sendTemplate");
          if (
            values.get("ZOHO_CPAAS_TOKEN") &&
            !values.get("ZOHO_CPAAS_SMS_TOKEN") &&
            !values.get("ZOHO_CPAAS_EMAIL_TOKEN") &&
            report.acceptedSends.some((entry) => entry.startsWith("email."))
          )
            report.sharedTokenChannels.push("email + SMS");
        }
      } else
        console.log(
          `SKIP  SMS template (missing ${[...sms.filter((name) => !values.get(name)), ...(!template ? ["E2E_SMS_TEMPLATE"] : [])].join(", ")})`,
        );
    }

    const deadline = Date.now() + options.waitMinutes * 60_000;
    while (Date.now() < deadline) {
      assertActive();
      ordinal = await collectAttempts(
        sessionId,
        site,
        allSentIds,
        mainIds,
        bounceIds,
        whatsappIds,
        report,
        ordinal,
      );
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      process.stdout.write(
        `\rWaiting for real webhooks: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} remaining   `,
      );
      if (
        report.open &&
        report.click &&
        (!bounceIds.size || report.bounceSuppression) &&
        (!whatsappIds.size || report.whatsapp)
      )
        break;
      await sleep(1000);
    }
    process.stdout.write("\n");
    ordinal = await collectAttempts(
      sessionId,
      site,
      allSentIds,
      mainIds,
      bounceIds,
      whatsappIds,
      report,
      ordinal,
    );
    check("owner opened tracked email", report.open);
    check("owner clicked tracked email link", report.click);
    if (bounceIds.size) check("owner-provided hard bounce observed", report.bounceSuppression);
    if (whatsappIds.size) check("real WhatsApp delivery outcome observed", report.whatsapp);
    report.verified = report.open && report.click && checks.every((entry) => entry.ok);
  } finally {
    if (sessionId && dev) {
      try {
        run("e2eWebhook:end", { sessionId });
        for (;;) {
          const attempts = run("e2eWebhook:pending", { sessionId });
          if (!attempts.length) break;
          for (const attempt of attempts) {
            ordinal++;
            await saveE2eFixture({
              rawBody: attempt.rawBody,
              contentType: attempt.contentType,
              signature: attempt.signature,
              reason: attempt.reason,
              receivedAt: attempt.receivedAt,
              eventOrdinal: ordinal,
            });
          }
          run("e2eWebhook:clear", { sessionId, ids: attempts.map((row) => row._id) });
        }
      } catch {
        console.error(
          "Could not clear all local e2e capture rows; their 30-minute expiry remains scheduled.",
        );
      }
    }
    await stopProcess(tunnel);
    await stopProcess(dev);
    release?.();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
  if (report.acceptedSends.length || report.webhookPassCount) {
    const observationPath = appendReport({
      ...report,
      eventNames: [...report.eventNames],
      contentTypes: [...report.contentTypes],
      formFields: [...report.formFields],
    });
    updateVerifiedDocs(report, observationPath);
    console.log(`Observation report: ${observationPath}`);
  }
  assertActive();
}

try {
  const options = parseOptions(process.argv.slice(2));
  const values = readE2eEnv();
  const config = configuration(values);
  if (options.dryRun) printPlan(values, options, config);
  else {
    if (config.missing.length)
      throw new Error(`Missing required .env.e2e names: ${config.missing.join(", ")}`);
    if (config.forbiddenTestMode)
      throw new Error("End-to-end verification refuses active ZOHO_CPAAS_TEST_MODE=true");
    await performE2e(values, options);
    if (checks.some((entry) => !entry.ok)) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "End-to-end verification failed");
  process.exitCode = 1;
}
