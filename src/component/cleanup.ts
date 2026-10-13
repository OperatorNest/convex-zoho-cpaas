import { readConfig } from "../shared/config.js";
import { v } from "convex/values";
import { zohoCpaasError } from "../shared/errors.js";
import { webhookReceiptRetentionMs } from "../shared/webhook.js";
import { env, internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";

const BATCH = 200;
// Convex caps stored documents at 1 MiB, including event fields and system fields.
const MAX_STORED_EVENT_BYTES = 1_048_576;
const EVENT_READ_BUDGET_BYTES = 8 * 1_048_576;
const EVENT_BATCH_SIZE = Math.floor(EVENT_READ_BUDGET_BYTES / MAX_STORED_EVENT_BYTES);
const DAY = 86_400_000;
const STUCK_SENDING_AFTER = DAY;

export const run = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const { retentionDays } = readConfig(env);
    const now = Date.now();
    const cutoff = now - retentionDays * DAY;
    let remaining = BATCH;
    let remainingEvents = EVENT_BATCH_SIZE;
    let deleted = 0;
    const jobsToFinalize: Id<"sendJobs">[] = [];

    const staleAttempt = await ctx.db
      .query("messages")
      .withIndex("by_status_and_sendingAt_and_createdAt", (q) =>
        q
          .eq("status", "sending")
          .gt("sendingAt", 0)
          .lt("sendingAt", now - STUCK_SENDING_AFTER),
      )
      .take(remaining);
    for (const message of staleAttempt) {
      await ctx.db.patch("messages", message._id, {
        status: "unknown",
        terminalAt: now,
        failureDefinitive: false,
        error: zohoCpaasError("ZOHO_CPAAS_NETWORK_ERROR", { retryable: false }).data,
      });
      if (message.jobId && !jobsToFinalize.includes(message.jobId))
        jobsToFinalize.push(message.jobId);
      remaining--;
    }
    const finalizeJobs = async () => {
      for (const jobId of jobsToFinalize) {
        const job = await ctx.db.get("sendJobs", jobId);
        if (!job || job.finishedAt !== undefined) continue;
        const queued = await ctx.db
          .query("messages")
          .withIndex("by_jobId_and_status_and_canceledAt", (q) =>
            q.eq("jobId", job._id).eq("status", "queued"),
          )
          .take(1);
        if (queued.length > 0) continue;
        const sending = await ctx.db
          .query("messages")
          .withIndex("by_jobId_and_status_and_canceledAt", (q) =>
            q.eq("jobId", job._id).eq("status", "sending"),
          )
          .take(1);
        if (sending.length > 0) continue;
        await ctx.db.patch("sendJobs", job._id, {
          finishedAt: now,
          payload: "",
        });
      }
      jobsToFinalize.length = 0;
    };
    await finalizeJobs();

    const deleteMessageWithEvents = async (message: Doc<"messages">) => {
      if (message.jobId && !jobsToFinalize.includes(message.jobId))
        jobsToFinalize.push(message.jobId);
      const linked = await ctx.db
        .query("events")
        .withIndex("by_messageId_and_occurredAt", (q) => q.eq("messageId", message._id))
        .take(Math.min(remaining, remainingEvents));
      for (const event of linked) {
        await ctx.db.delete("events", event._id);
        remaining--;
        remainingEvents--;
        deleted++;
      }
      if (remaining === 0 || remainingEvents === 0) return false;
      await ctx.db.delete("messages", message._id);
      remaining--;
      deleted++;
      return true;
    };

    if (remaining > 0 && remainingEvents > 0) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_receivedAt", (q) => q.lt("receivedAt", cutoff))
        .take(Math.min(remaining, remainingEvents));
      for (const event of events) {
        await ctx.db.delete("events", event._id);
        remaining--;
        remainingEvents--;
        deleted++;
      }
    }
    if (remaining > 0 && remainingEvents > 0) {
      const jobs = await ctx.db
        .query("sendJobs")
        .withIndex("by_finishedAt", (q) => q.gt("finishedAt", 0).lt("finishedAt", cutoff))
        .take(remaining);
      for (const job of jobs) {
        await ctx.db.delete("sendJobs", job._id);
        remaining--;
        deleted++;
      }
    }
    if (remaining > 0 && remainingEvents > 0) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_terminalAt", (q) => q.gt("terminalAt", 0).lt("terminalAt", cutoff))
        .take(remaining);
      for (const message of messages) {
        if (!(await deleteMessageWithEvents(message))) break;
      }
      await finalizeJobs();
    }
    if (remaining > 0 && remainingEvents > 0) {
      const fallbackStatuses = [
        "accepted",
        "delivered",
        "read",
        "failed",
        "bounced",
        "complained",
        "suppressed",
        "canceled",
      ] as const;
      for (const status of fallbackStatuses) {
        if (remaining === 0 || remainingEvents === 0) break;
        const candidates = await ctx.db
          .query("messages")
          .withIndex("by_status_and_terminalAt_and_createdAt", (q) =>
            q.eq("status", status).eq("terminalAt", undefined).lt("createdAt", cutoff),
          )
          .take(remaining);
        for (const message of candidates) {
          if (!(await deleteMessageWithEvents(message))) break;
        }
      }
      await finalizeJobs();
    }
    if (remaining > 0 && remainingEvents > 0) {
      const receipts = await ctx.db
        .query("webhookReceipts")
        .withIndex("by_createdAt", (q) =>
          q.lt("createdAt", now - webhookReceiptRetentionMs(retentionDays)),
        )
        .take(remaining);
      for (const receipt of receipts) {
        await ctx.db.delete("webhookReceipts", receipt._id);
        remaining--;
        deleted++;
      }
    }

    const hasMore = remaining === 0 || remainingEvents === 0;
    if (hasMore) await ctx.scheduler.runAfter(0, internal.cleanup.run, {});
    return { deleted, hasMore };
  },
});
