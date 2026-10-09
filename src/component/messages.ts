import { paginator } from "convex-helpers/server/pagination";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v, type Infer } from "convex/values";
import {
  buildEmailPayload,
  buildSmsPayload,
  buildWhatsappPayload,
  normalizeEmail,
  normalizeRecipient,
  isIndiaBaseUrl,
  type EmailAddress,
  type EmailRecipient,
} from "../shared/provider.js";
import { zohoError } from "../shared/errors.js";
import { sha256Hex } from "../shared/crypto.js";
import { stableStringify } from "../shared/record.js";
import {
  channelValidator,
  emailBatchArgs,
  emailSendArgs,
  emailTemplateArgs,
  emailTemplateBatchArgs,
  smsTemplateArgs,
  whatsappTemplateArgs,
} from "../shared/validators.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { env, mutation, query, type MutationCtx } from "./_generated/server.js";
import schema, { statusValidator } from "./schema.js";
import { providerConfiguration, resolveTestMode, tokenFor } from "./config.js";
import { pool } from "./pool.js";

const idsValidator = v.array(v.id("messages"));
type Channel = Doc<"messages">["channel"];
type EmailArgs =
  | Infer<typeof emailSendArgs>
  | Infer<typeof emailTemplateArgs>
  | Infer<typeof emailBatchArgs>
  | Infer<typeof emailTemplateBatchArgs>;

function assertSendConfiguration(channel: Channel, testMode: boolean): void {
  if (testMode) return;
  providerConfiguration(channel);
}

function publicSend<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    if (error instanceof ConvexError) throw error;
    const message = error instanceof Error ? error.message : "Send request validation failed";
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", message);
  });
}

async function suppressed(ctx: MutationCtx, channel: Channel, address: string): Promise<boolean> {
  const row = await ctx.db
    .query("suppressions")
    .withIndex("by_channel_and_address", (q) => q.eq("channel", channel).eq("address", address))
    .unique();
  return !!row;
}

async function existingIds(
  ctx: MutationCtx,
  key: string | undefined,
  request: string,
): Promise<Id<"messages">[] | null> {
  if (key === undefined) return null;
  if (!key.trim())
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Idempotency key must not be blank");
  const job = await ctx.db
    .query("sendJobs")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", key))
    .order("desc")
    .first();
  if (!job) return null;
  if (job.requestHash !== (await sha256Hex(request)))
    throw zohoError(
      "ZOHO_CPAAS_IDEMPOTENCY_CONFLICT",
      "Idempotency key was used for a different request",
    );
  // Suppressed rows never reached the provider, so they are neutral: replay is
  // allowed when every other row definitively failed or was canceled unsent.
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

async function enqueueEmail(
  ctx: MutationCtx,
  args: EmailArgs,
  path: string,
  batch: boolean,
): Promise<Id<"messages">[]> {
  const request = stableStringify({ path, args });
  const testMode = resolveTestMode(args.testMode);
  assertSendConfiguration("email", testMode);
  const prior = await existingIds(ctx, args.idempotencyKey, request);
  if (prior) return prior;
  const allTo: EmailRecipient[] = args.to.map((item) =>
    "emailAddress" in item ? item : { emailAddress: item },
  );
  if (!allTo.length)
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Email requires at least one to recipient");
  if (
    allTo.length > 500 ||
    (args.cc?.length ?? 0) > 500 ||
    (args.bcc?.length ?? 0) > 500 ||
    (args.replyTo?.length ?? 0) > 500
  )
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Email recipient limit is 500 per field");
  if (batch && allTo.length + (args.cc?.length ?? 0) + (args.bcc?.length ?? 0) > 500)
    throw zohoError(
      "ZOHO_CPAAS_VALIDATION_FAILED",
      "Email batch recipient limit is 500 across to, cc, and bcc",
    );
  if (batch && !allTo.length)
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Email batch requires a to recipient");
  try {
    buildEmailPayload(
      args,
      batch ? allTo : allTo.map((r) => r.emailAddress),
      args.clientReference ?? "validation",
    );
  } catch (error) {
    throw zohoError(
      "ZOHO_CPAAS_VALIDATION_FAILED",
      error instanceof Error ? error.message : "Invalid email send",
    );
  }
  if (
    batch &&
    !args.clientReference &&
    allTo.some((r) => Object.hasOwn(r.mergeInfo ?? {}, "__onx_ref"))
  )
    throw zohoError(
      "ZOHO_CPAAS_VALIDATION_FAILED",
      "mergeInfo key __onx_ref is reserved for per-recipient correlation",
    );
  const preparedTo: EmailRecipient[] = [];
  const preparedCc: EmailAddress[] = [];
  const preparedBcc: EmailAddress[] = [];
  const recipients: { to: string; status: Doc<"messages">["status"] }[] = [];
  const seen = new Set<string>();
  for (const item of allTo) {
    const address = normalizeEmail(item.emailAddress.address);
    if (seen.has(address))
      throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Duplicate recipient across email fields");
    seen.add(address);
    const isSuppressed = await suppressed(ctx, "email", address);
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
      if (seen.has(address))
        throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Duplicate recipient across email fields");
      seen.add(address);
      const isSuppressed = await suppressed(ctx, "email", address);
      recipients.push({ to: address, status: isSuppressed ? "suppressed" : "queued" });
      if (!isSuppressed) target.push({ ...item, address: item.address.trim() });
    }
  }
  if (!preparedTo.length && (preparedCc.length || preparedBcc.length))
    throw zohoError(
      "ZOHO_CPAAS_VALIDATION_FAILED",
      "Email requires a deliverable to recipient when cc or bcc is deliverable",
    );
  if (recipients.every((r) => r.status === "suppressed"))
    throw zohoError("ZOHO_CPAAS_ALL_SUPPRESSED", "All email recipients are suppressed");
  const now = Date.now();
  const ids: Id<"messages">[] = [];
  const region = env.ZOHO_CPAAS_REGION ?? "us";
  for (const recipient of recipients) {
    ids.push(
      await ctx.db.insert("messages", {
        channel: "email",
        to: recipient.to,
        from: args.from.address.trim(),
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
  if (!ids.length)
    throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "At least one recipient is required");
  const firstQueued = recipients.findIndex((r) => r.status === "queued");
  const clientReference =
    args.clientReference ??
    (batch ? "{{__onx_ref}}" : String(ids[firstQueued < 0 ? 0 : firstQueued]));
  for (const id of ids)
    await ctx.db.patch("messages", id, {
      clientReference: args.clientReference ?? (batch ? String(id) : clientReference),
    });
  if (batch && !args.clientReference) {
    const sharedMergeInfo = "mergeInfo" in args ? args.mergeInfo : undefined;
    for (let index = 0, queuedIndex = 0; index < allTo.length; index++) {
      const recipient = recipients[index];
      if (!recipient || recipient.status !== "queued") continue;
      const item = preparedTo[queuedIndex];
      const id = ids[index];
      if (!item || !id)
        throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Invalid batch recipient state");
      preparedTo[queuedIndex] = {
        ...item,
        mergeInfo: {
          ...sharedMergeInfo,
          ...item.mergeInfo,
          __onx_ref: String(id),
        },
      };
      queuedIndex++;
    }
  }
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

export const send = mutation({
  args: emailSendArgs.fields,
  returns: idsValidator,
  handler: (ctx, args) => publicSend(() => enqueueEmail(ctx, args, "/email", false)),
});
export const sendTemplate = mutation({
  args: emailTemplateArgs.fields,
  returns: idsValidator,
  handler: (ctx, args) => publicSend(() => enqueueEmail(ctx, args, "/email/template", false)),
});
export const sendBatch = mutation({
  args: emailBatchArgs.fields,
  returns: idsValidator,
  handler: (ctx, args) => publicSend(() => enqueueEmail(ctx, args, "/email/batch", true)),
});
export const sendTemplateBatch = mutation({
  args: emailTemplateBatchArgs.fields,
  returns: idsValidator,
  handler: (ctx, args) => publicSend(() => enqueueEmail(ctx, args, "/email/template/batch", true)),
});

async function enqueueTemplate(
  ctx: MutationCtx,
  args: Infer<typeof smsTemplateArgs> | Infer<typeof whatsappTemplateArgs>,
  channel: "sms" | "whatsapp",
) {
  const testMode = resolveTestMode(args.testMode);
  assertSendConfiguration(channel, testMode);
  if (
    channel === "sms" &&
    !testMode &&
    env.ZOHO_CPAAS_REGION !== "in" &&
    !isIndiaBaseUrl(env.ZOHO_CPAAS_BASE_URL)
  ) {
    console.warn("ZOHO_CPAAS_UNSUPPORTED_REGION");
    throw zohoError("ZOHO_CPAAS_UNSUPPORTED_REGION", "SMS is available in the India region only");
  }
  const request = stableStringify({ channel, args });
  const prior = await existingIds(ctx, args.idempotencyKey, request);
  if (prior) {
    const first = prior[0];
    if (!first) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Existing send has no message");
    return first;
  }
  const to = normalizeRecipient(channel, args.to);
  const isSuppressed = await suppressed(ctx, channel, to);
  const now = Date.now();
  const id = await ctx.db.insert("messages", {
    channel,
    to,
    from: "senderKey" in args ? args.senderKey : args.from,
    status: isSuppressed ? "suppressed" : "queued",
    clientReference: args.clientReference ?? "pending",
    attempts: 0,
    failureDefinitive: true,
    testMode,
    region: env.ZOHO_CPAAS_REGION ?? "us",
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

export const sendSmsTemplate = mutation({
  args: smsTemplateArgs.fields,
  returns: v.id("messages"),
  handler: (ctx, args) => publicSend(() => enqueueTemplate(ctx, args, "sms")),
});
export const sendWhatsappTemplate = mutation({
  args: whatsappTemplateArgs.fields,
  returns: v.id("messages"),
  handler: (ctx, args) => publicSend(() => enqueueTemplate(ctx, args, "whatsapp")),
});

export const getMessage = query({
  args: { messageId: v.id("messages") },
  returns: v.union(schema.doc("messages"), v.null()),
  handler: (ctx, { messageId }) => ctx.db.get("messages", messageId),
});
export const listMessages = query({
  args: {
    recipient: v.optional(v.string()),
    channel: v.optional(channelValidator),
    status: v.optional(statusValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("messages")),
  handler: async (ctx, args) => {
    if (Boolean(args.recipient) === Boolean(args.status))
      throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Specify exactly one of recipient or status");
    if (args.recipient) {
      if (!args.channel)
        throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Channel is required with recipient");
      const recipient = normalizeRecipient(args.channel, args.recipient);
      return paginator(ctx.db, schema)
        .query("messages")
        .withIndex("by_to_and_createdAt", (q) => q.eq("to", recipient))
        .order("desc")
        .paginate(args.paginationOpts);
    }
    if (!args.status) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Status is required");
    if (args.channel)
      throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED", "Channel applies only with recipient");
    const status = args.status;
    return paginator(ctx.db, schema)
      .query("messages")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
export const listEvents = query({
  args: { messageId: v.id("messages"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("events")),
  handler: (ctx, args) =>
    paginator(ctx.db, schema)
      .query("events")
      .withIndex("by_messageId_and_occurredAt", (q) => q.eq("messageId", args.messageId))
      .order("desc")
      .paginate(args.paginationOpts),
});
export const cancel = mutation({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: async (ctx, { messageId }) => {
    const row = await ctx.db.get("messages", messageId);
    if (!row || row.status !== "queued") return false;
    await ctx.db.patch("messages", messageId, { status: "canceled", terminalAt: Date.now() });
    if (row.jobId) {
      const job = await ctx.db.get("sendJobs", row.jobId);
      if (job) {
        const queuedSibling = await ctx.db
          .query("messages")
          .withIndex("by_jobId_and_status", (q) => q.eq("jobId", row.jobId).eq("status", "queued"))
          .take(1);
        const sendingSibling = await ctx.db
          .query("messages")
          .withIndex("by_jobId_and_status", (q) => q.eq("jobId", row.jobId).eq("status", "sending"))
          .take(1);
        if (queuedSibling.length === 0 && sendingSibling.length === 0 && job.workId) {
          await pool.cancel(ctx, job.workId);
        }
      }
    }
    return true;
  },
});

export const status = query({
  args: {},
  returns: v.object({ configured: v.boolean(), testMode: v.boolean(), region: v.string() }),
  handler: () => ({
    configured: !!tokenFor("email"),
    testMode: resolveTestMode(undefined),
    region: env.ZOHO_CPAAS_REGION ?? "us",
  }),
});
