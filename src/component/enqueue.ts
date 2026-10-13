import { type Infer } from "convex/values";
import {
  buildEmailPayload,
  buildSmsPayload,
  buildWhatsappPayload,
  normalizeEmail,
  normalizeRecipient,
  type EmailAddress,
  type EmailRecipient,
} from "../shared/provider.js";
import { zohoCpaasError } from "../shared/errors.js";
import { validateIdempotencyKey } from "../shared/bounds.js";
import { sha256Hex } from "../shared/crypto.js";
import { stableStringify } from "../shared/record.js";
import {
  emailBatchArgsValidator,
  emailSendArgsValidator,
  emailTemplateArgsValidator,
  emailTemplateBatchArgsValidator,
  smsTemplateArgsValidator,
  whatsappTemplateArgsValidator,
} from "../shared/validators.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { env, type MutationCtx } from "./_generated/server.js";
import { readConfig } from "../shared/config.js";
import { providerConfiguration, readTestMode } from "./config.js";
import { pool } from "./pool.js";

type Channel = Doc<"messages">["channel"];
type EmailArgs =
  | Infer<typeof emailSendArgsValidator>
  | Infer<typeof emailTemplateArgsValidator>
  | Infer<typeof emailBatchArgsValidator>
  | Infer<typeof emailTemplateBatchArgsValidator>;

function assertSendConfiguration(channel: Channel, testMode: boolean): void {
  if (testMode) return;
  providerConfiguration(channel);
}

async function suppressed(
  ctx: MutationCtx,
  testMode: boolean,
  channel: Channel,
  address: string,
): Promise<boolean> {
  const row = await ctx.db
    .query("suppressions")
    .withIndex("by_testMode_and_channel_and_address", (q) =>
      q.eq("testMode", testMode).eq("channel", channel).eq("address", address),
    )
    .unique();
  return !!row;
}

async function existingIds(
  ctx: MutationCtx,
  key: string | undefined,
  testMode: boolean,
  request: string,
): Promise<Id<"messages">[] | null> {
  if (key === undefined) return null;
  validateIdempotencyKey(key);
  const job = await ctx.db
    .query("sendJobs")
    .withIndex("by_testMode_and_idempotencyKey", (q) =>
      q.eq("testMode", testMode).eq("idempotencyKey", key),
    )
    .order("desc")
    .first();
  if (!job) return null;
  if (job.requestHash !== (await sha256Hex(request)))
    throw zohoCpaasError("ZOHO_CPAAS_IDEMPOTENCY_CONFLICT");

  let definitive = 0;
  let allDefinitive = true;
  for (const id of job.messageIds) {
    const message = await ctx.db.get("messages", id);
    if (message?.status === "suppressed") continue;
    if (
      !message ||
      (message.status !== "canceled" &&
        !(message.status === "failed" && message.failureDefinitive === true)) ||
      (message.status === "canceled" &&
        message.failureDefinitive !== true &&
        message.attempts !== 0)
    ) {
      allDefinitive = false;
      break;
    }
    definitive++;
  }
  if (allDefinitive && definitive > 0) return null;
  return job.messageIds;
}

export async function enqueueEmail(
  ctx: MutationCtx,
  args: EmailArgs,
  path: string,
  batch: boolean,
): Promise<Id<"messages">[]> {
  const request = stableStringify({ path, args });
  const testMode = readTestMode(args.testMode);
  const prior = await existingIds(ctx, args.idempotencyKey, testMode, request);
  if (prior) return prior;
  assertSendConfiguration("email", testMode);
  const allTo: EmailRecipient[] = args.to.map((item) =>
    "emailAddress" in item ? item : { emailAddress: item },
  );
  if (!allTo.length) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
  if (
    allTo.length > 500 ||
    (args.cc?.length ?? 0) > 500 ||
    (args.bcc?.length ?? 0) > 500 ||
    (args.replyTo?.length ?? 0) > 500
  )
    throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
  if (batch && allTo.length + (args.cc?.length ?? 0) + (args.bcc?.length ?? 0) > 500)
    throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
  buildEmailPayload(
    args,
    batch ? allTo : allTo.map((r) => r.emailAddress),
    args.clientReference ?? "validation",
  );
  const preparedTo: EmailRecipient[] = [];
  const preparedCc: EmailAddress[] = [];
  const preparedBcc: EmailAddress[] = [];
  const recipients: { to: string; status: Doc<"messages">["status"] }[] = [];
  const seen = new Set<string>();
  for (const item of allTo) {
    const address = normalizeEmail(item.emailAddress.address);
    if (seen.has(address)) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
    seen.add(address);
    const isSuppressed = await suppressed(ctx, testMode, "email", address);
    recipients.push({ to: address, status: isSuppressed ? "suppressed" : "queued" });
    if (!isSuppressed)
      preparedTo.push({
        ...item,
        emailAddress: { ...item.emailAddress, address: item.emailAddress.address.trim() },
      });
  }
  for (const [source, target] of [
    [args.cc ?? [], preparedCc],
    [args.bcc ?? [], preparedBcc],
  ] as const) {
    for (const item of source) {
      const address = normalizeEmail(item.address);
      if (seen.has(address)) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
      seen.add(address);
      const isSuppressed = await suppressed(ctx, testMode, "email", address);
      recipients.push({ to: address, status: isSuppressed ? "suppressed" : "queued" });
      if (!isSuppressed) target.push({ ...item, address: item.address.trim() });
    }
  }
  if (!preparedTo.length && (preparedCc.length || preparedBcc.length))
    throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
  if (recipients.every((r) => r.status === "suppressed"))
    throw zohoCpaasError("ZOHO_CPAAS_ALL_SUPPRESSED");
  const now = Date.now();
  const ids: Id<"messages">[] = [];
  const region = readConfig(env).region;
  for (const recipient of recipients) {
    ids.push(
      await ctx.db.insert("messages", {
        channel: "email",
        to: recipient.to,
        from: normalizeEmail(args.from.address),
        status: recipient.status,
        clientReference: args.clientReference ?? "pending",
        attempts: 0,
        failureDefinitive: true,
        testMode,
        region,
        createdAt: now,
        ...(recipient.status === "suppressed" ? { terminalAt: now } : {}),
      }),
    );
  }
  const firstQueued = recipients.findIndex((r) => r.status === "queued");
  const clientReference = args.clientReference ?? String(ids[firstQueued]);
  for (const id of ids) await ctx.db.patch("messages", id, { clientReference });
  const input = { ...args, cc: preparedCc, bcc: preparedBcc };
  const prepared = batch ? preparedTo : preparedTo.map((r) => r.emailAddress);
  const payload = buildEmailPayload(input, prepared, clientReference);
  const jobId = await ctx.db.insert("sendJobs", {
    channel: "email",
    path,
    payload: JSON.stringify(payload),
    requestHash: await sha256Hex(request),
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    messageIds: ids,
    attempts: 0,
    testMode,
    createdAt: now,
  });
  for (const id of ids) await ctx.db.patch("messages", id, { jobId });
  const workId = await pool.enqueueAction(
    ctx,
    internal.sends.execute,
    { jobId, attempt: 1 },
    { onComplete: internal.sends.complete, context: { jobId, attempt: 1 }, retry: false },
  );
  await ctx.db.patch("sendJobs", jobId, { workId });
  return ids;
}

export async function enqueueTemplate(
  ctx: MutationCtx,
  args: Infer<typeof smsTemplateArgsValidator> | Infer<typeof whatsappTemplateArgsValidator>,
  channel: "sms" | "whatsapp",
) {
  const testMode = readTestMode(args.testMode);
  const request = stableStringify({ channel, args });
  const prior = await existingIds(ctx, args.idempotencyKey, testMode, request);
  if (prior) {
    const first = prior[0];
    if (!first) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
    return first;
  }
  assertSendConfiguration(channel, testMode);
  const to = normalizeRecipient(channel, args.to);
  const isSuppressed = await suppressed(ctx, testMode, channel, to);
  if ("senderKey" in args) buildSmsPayload(args, args.clientReference ?? "validation");
  else buildWhatsappPayload(args, args.clientReference ?? "validation");
  const now = Date.now();
  const id = await ctx.db.insert("messages", {
    channel,
    to,
    from: "senderKey" in args ? args.senderKey : normalizeRecipient("whatsapp", args.from),
    status: isSuppressed ? "suppressed" : "queued",
    clientReference: args.clientReference ?? "pending",
    attempts: 0,
    failureDefinitive: true,
    testMode,
    region: readConfig(env).region,
    createdAt: now,
    ...(isSuppressed ? { terminalAt: now } : {}),
  });
  const clientReference = args.clientReference ?? String(id);
  await ctx.db.patch("messages", id, { clientReference });
  const payload =
    "senderKey" in args
      ? buildSmsPayload(args, clientReference)
      : buildWhatsappPayload(args, clientReference);
  const jobId = await ctx.db.insert("sendJobs", {
    channel,
    path: `/${channel}`,
    payload: isSuppressed ? "" : JSON.stringify(payload),
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    messageIds: [id],
    attempts: 0,
    testMode,
    requestHash: await sha256Hex(request),
    createdAt: now,
    ...(isSuppressed ? { finishedAt: now } : {}),
  });
  await ctx.db.patch("messages", id, { jobId });
  if (isSuppressed) return id;
  const workId = await pool.enqueueAction(
    ctx,
    internal.sends.execute,
    { jobId, attempt: 1 },
    { onComplete: internal.sends.complete, context: { jobId, attempt: 1 }, retry: false },
  );
  await ctx.db.patch("sendJobs", jobId, { workId });
  return id;
}
