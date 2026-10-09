// Exercises the example on an anonymous local Convex deployment, including a fresh CI checkout.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { acquireLock } from "./with-local-lock.mjs";

const results = [];
const failures = [];

// A developer's anonymous backend may contain pre-release rows that no longer
// match the current schema. Exercise a clean backend without touching that data.
function isolateIfConfigured() {
  if (!existsSync(".env.local")) return null;
  const sourceRoot = process.cwd();
  const base =
    process.platform === "darwin" && existsSync("/private/tmp/claude-502")
      ? "/private/tmp/claude-502"
      : tmpdir();
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "zoho-cpaas-smoke-"));
  try {
    cpSync(sourceRoot, dir, {
      recursive: true,
      filter: (source) => {
        const name = relative(sourceRoot, source).split(sep)[0];
        if (name.startsWith(".env")) return false;
        return ![".git", ".convex", ".cache", "node_modules", "coverage"].includes(name);
      },
    });
    symlinkSync(join(sourceRoot, "node_modules"), join(dir, "node_modules"), "dir");
    process.chdir(dir);
    return { sourceRoot, dir };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function convex(...args) {
  return execFileSync("pnpm", ["exec", "convex", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
}

function setEnv(name, value) {
  const result = spawnSync("pnpm", ["exec", "convex", "env", "set", name], {
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "pipe"],
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
  if (result.status !== 0) throw new Error(`Failed to set ${name} on the local deployment`);
}

function parseOut(out) {
  try {
    return JSON.parse(out.trim());
  } catch {
    throw new Error("Convex CLI returned non-JSON output");
  }
}

function run(fn, args = {}) {
  return parseOut(convex("run", fn, JSON.stringify(args)));
}

function runError(fn, args = {}) {
  try {
    convex("run", fn, JSON.stringify(args));
  } catch (error) {
    return `${error.stderr ?? ""}${error.stdout ?? ""}${error.message}`;
  }
  return null;
}

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

async function waitFor(fn, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function pushFunctions() {
  try {
    convex("dev", "--once");
  } catch (error) {
    // Another process may have restarted the shared local backend; retry once.
    console.log(
      `convex dev --once failed (${String(error.message).split("\n")[0]}); retrying once`,
    );
    convex("dev", "--once");
  }
}

function ensureLocalDeployment() {
  if (!existsSync(".env.local")) convex("init");
  // Refuse a configured cloud deployment even when a local site happens to be in the file.
  const envFile = readFileSync(".env.local", "utf8");
  const deployment = envFile.match(/^CONVEX_DEPLOYMENT=(.*)$/m)?.[1]?.trim();
  const cloudUrl = envFile.match(/^CONVEX_URL=(.*)$/m)?.[1]?.trim();
  if (deployment && !deployment.startsWith("anonymous:") && !deployment.startsWith("local:"))
    throw new Error("Smoke requires an anonymous local deployment");
  if (cloudUrl && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(cloudUrl))
    throw new Error("Smoke requires a local Convex URL");
}

// The anonymous local backend only stays up while `convex dev` runs, and the webhook journey
// needs its HTTP site, so keep a dev process alive for the whole run.
function startDev() {
  const child = spawn("pnpm", ["exec", "convex", "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
  let log = "";
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`convex dev not ready: ${log.slice(-500)}`)),
      120_000,
    );
    const onData = (chunk) => {
      log += chunk.toString();
      if (/functions ready/i.test(log)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`convex dev exited (${code}): ${log.slice(-500)}`));
    });
  });
  return { child, ready };
}

async function stopDev(dev) {
  if (!dev?.child.pid) return;
  const pid = dev.child.pid;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([
    new Promise((resolve) => dev.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The entire process group has exited.
  }
}

function siteUrl() {
  const line = readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.startsWith("CONVEX_SITE_URL="));
  if (!line) throw new Error("CONVEX_SITE_URL missing from .env.local");
  const url = line.slice("CONVEX_SITE_URL=".length).trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("CONVEX_SITE_URL is invalid");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !parsed.port ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Smoke requires a local HTTP site");
  return url;
}

// Zoho scheme (spec 5.2): HMAC-SHA256 base64 over the URL-decoded JSON text, header carries ts.
function signature(json, secret) {
  const s = createHmac("sha256", secret).update(json, "utf8").digest("base64");
  return `ts=${Date.now()};s=${encodeURIComponent(s)};s-algorithm=HmacSHA256`;
}

async function post(base, json, sig) {
  const response = await fetch(`${base}/zoho-cpaas/webhook`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "producer-signature": sig },
    body: `data=${encodeURIComponent(json)}`,
  });
  return response.status;
}

function receiptCount() {
  const out = convex(
    "data",
    "--component",
    "zohoCpaas",
    "webhookReceipts",
    "--format",
    "jsonArray",
  );
  return parseOut(out).length;
}

const isolated = isolateIfConfigured();
let release;
let dev;
try {
  release = await acquireLock();
  ensureLocalDeployment();
  const base = siteUrl();
  const secret = randomBytes(24).toString("hex");
  console.log("Building the package and pushing functions to the local deployment...");
  execFileSync("pnpm", ["build"], { stdio: "ignore" });
  pushFunctions();
  dev = startDev();
  await dev.ready;

  // Local deployment only.
  setEnv("ZOHO_CPAAS_TEST_MODE", "true");
  setEnv("ZOHO_CPAAS_WEBHOOK_SECRET", secret);
  await waitFor(() => {
    try {
      return run("example:status").testMode === true;
    } catch {
      return false;
    }
  }, "component test-mode environment to reload");

  const tag = `smoke${Date.now()}`;
  const addr = (name) => `${tag}-${name}@example.test`;
  const messageStatus = (id) => run("example:getMessage", { messageId: id });
  const waitStatus = (id, status) =>
    waitFor(() => {
      const m = messageStatus(id);
      return m?.status === status ? m : null;
    }, `${id} to reach ${status}`);

  // a. Sends.
  const [sentId] = run("example:sendEmail", {
    to: addr("bounce"),
    subject: "Smoke",
    text: "Hello",
    idempotencyKey: `${tag}-key`,
  });
  const sent = await waitStatus(sentId, "accepted");
  check("email.send reaches accepted", sent.status === "accepted");
  check("email.send tagged testMode", sent.testMode === true);
  const replay = run("example:sendEmail", {
    to: addr("bounce"),
    subject: "Smoke",
    text: "Hello",
    idempotencyKey: `${tag}-key`,
  });
  check("idempotent replay returns same ids", replay.length === 1 && replay[0] === sentId);

  const batchRecipients = [addr("b1"), addr("b2"), addr("b3")];
  const batchIds = run("example:sendTemplateBatch", {
    recipients: batchRecipients,
    templateKey: "smoke-template",
    idempotencyKey: `${tag}-batch`,
  });
  check("sendTemplateBatch returns 3 rows", batchIds.length === 3 && new Set(batchIds).size === 3);
  const batchReplay = run("example:sendTemplateBatch", {
    recipients: batchRecipients,
    templateKey: "smoke-template",
    idempotencyKey: `${tag}-batch`,
  });
  check("batch idempotent replay returns same ids", batchReplay.join() === batchIds.join());
  const batchRows = [];
  for (const id of batchIds) batchRows.push(await waitStatus(id, "accepted"));
  check(
    "batch rows reach accepted in test mode",
    batchRows.length === 3 &&
      batchRows.every((row) => row.status === "accepted" && row.testMode === true),
  );

  // b. Webhook end to end.
  const events = (reqId, extra = {}) =>
    JSON.stringify({
      event_name: ["hardbounce"],
      event_message: [
        {
          email_info: {
            client_reference: sentId,
            subject: "Smoke",
            to: [{ email_address: { address: addr("bounce") } }],
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
        },
      ],
      request_id: sent.providerRequestId,
      ...(reqId ? { webhook_request_id: reqId } : {}),
      ...extra,
    });
  const callbacksBefore = run("example:webhookCallbackCount");
  const json = events(`${tag}-wh1`);
  const status1 = await post(base, json, signature(json, secret));
  check("signed hard-bounce webhook returns 200", status1 === 200, `status ${status1}`);
  const bounced = messageStatus(sentId);
  check("message status becomes bounced", bounced?.status === "bounced", bounced?.status);
  const supps = run("example:listSuppressions", { paginationOpts: { numItems: 50, cursor: null } });
  check(
    "bounced address added to suppressions",
    supps.some((s) => s.address === addr("bounce") && s.reason === "hardbounce"),
  );
  const callbacksAfter = run("example:webhookCallbackCount");
  check("onEvent callback ran once", callbacksAfter === callbacksBefore + 1);
  const status2 = await post(base, json, signature(json, secret));
  check("replayed webhook returns 200", status2 === 200, `status ${status2}`);
  check(
    "replayed webhook does not rerun callback",
    run("example:webhookCallbackCount") === callbacksAfter,
  );
  const status3 = await post(base, json, signature(json, `${secret}x`));
  check("bad signature returns 401", status3 === 401, `status ${status3}`);
  const receiptsBefore = receiptCount();
  const noId = events(undefined, { note: tag });
  const status4 = await post(base, noId, signature(noId, secret));
  check("signed body without webhook_request_id returns 200", status4 === 200, `status ${status4}`);
  check("failed receipt recorded", receiptCount() === receiptsBefore + 1);
  check(
    "failed receipt does not run callback",
    run("example:webhookCallbackCount") === callbacksAfter,
  );

  // c. Suppressed sends do not reach a provider.
  const afterSuppressed = runError("example:sendEmail", {
    to: addr("bounce"),
    subject: "Blocked",
    text: "Body",
  });
  check(
    "send to suppressed address is rejected as ZOHO_CPAAS_ALL_SUPPRESSED",
    afterSuppressed !== null && afterSuppressed.includes("ZOHO_CPAAS_ALL_SUPPRESSED"),
  );
  const mixed = run("example:sendTemplateBatch", {
    recipients: [addr("bounce"), addr("fresh")],
    templateKey: "smoke-template",
  });
  const mixedRows = mixed.map((id) => messageStatus(id));
  check(
    "suppressed batch row is suppressed without a provider call",
    mixedRows.some((m) => m?.to === addr("bounce") && m.status === "suppressed"),
  );

  // d. Pagination and suppression management.
  const pageTo = addr("page");
  for (const n of [1, 2, 3]) run("example:sendEmail", { to: pageTo, subject: `P${n}`, text: "x" });
  const page = (cursor) =>
    run("example:listMessages", {
      recipient: pageTo,
      channel: "email",
      paginationOpts: { numItems: 2, cursor },
    });
  const page1 = page(null);
  const page2 = page(page1.continueCursor);
  check("listMessages page 1 has 2 rows", page1.page.length === 2 && page1.isDone === false);
  check(
    "listMessages page 2 has the remaining row",
    page2.page.length === 1 && !page1.page.some((m) => m.id === page2.page[0].id),
  );
  const normalizedPage = run("example:listMessages", {
    recipient: pageTo.toUpperCase(),
    channel: "email",
    paginationOpts: { numItems: 2, cursor: null },
  });
  check(
    "listMessages normalizes recipient before indexed lookup",
    normalizedPage.page.length === 2 &&
      normalizedPage.page.every((row, index) => row.id === page1.page[index]?.id),
  );
  check(
    "removeSuppression removes the address",
    run("example:removeSuppression", { address: addr("bounce") }) === true,
  );
  check(
    "suppression list no longer has the address",
    !run("example:listSuppressions", { paginationOpts: { numItems: 50, cursor: null } }).some(
      (s) => s.address === addr("bounce"),
    ),
  );

  // e. Experimental channels.
  const waId = run("example:sendWhatsappTemplate", {
    from: "+15550100001",
    to: "+15550100002",
    templateKey: "smoke-template",
  });
  check("whatsapp.sendTemplate accepted", (await waitStatus(waId, "accepted")).testMode === true);
  const smsId = run("example:sendSmsTemplate", {
    senderKey: "smoke-sender",
    to: "+919876543210",
    templateKey: "smoke-template",
  });
  check("sms.sendTemplate accepted", (await waitStatus(smsId, "accepted")).testMode === true);
} catch (error) {
  failures.push(`fatal: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await stopDev(dev);
  release?.();
  if (isolated) {
    process.chdir(isolated.sourceRoot);
    rmSync(isolated.dir, { recursive: true, force: true });
  }
}

console.log("\nSmoke summary");
for (const r of results)
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : ` (${r.detail})`}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nAll ${results.length} checks passed in the real Convex runtime.`);
