import { v } from "convex/values";
import type { ZohoCpaasMessageErrorCode } from "../shared/errors.js";
import { env, internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";

const BATCH = 200;
const DAY = 86_400_000;
const STUCK_SENDING_AFTER = DAY;
// Webhook replay is only deduplicated while its receipt exists, so receipts outlive
// shorter configured retention windows.
const MIN_RECEIPT_RETENTION_DAYS = 30;

export const run = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const configured = Number(env.ZOHO_CPAAS_RETENTION_DAYS);
    const days =
      Number.isSafeInteger(configured) && configured >= 1 && configured <= 3650 ? configured : 30;
    const now = Date.now();
    const cutoff = now - days * DAY;
    let remaining = BATCH;
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
        status: "failed",
        terminalAt: now,
        failureDefinitive: false,
        error: {
          class: "permanent",
          code: "ZOHO_CPAAS_STUCK" satisfies ZohoCpaasMessageErrorCode,
          message: "Send remained in progress for more than 24 hours.",
          retryable: false,
        },
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
          .withIndex("by_jobId_and_status", (q) => q.eq("jobId", job._id).eq("status", "queued"))
          .take(1);
        if (queued.length > 0) continue;
        const sending = await ctx.db
          .query("messages")
          .withIndex("by_jobId_and_status", (q) => q.eq("jobId", job._id).eq("status", "sending"))
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
        .take(remaining);
      for (const event of linked) {
        await ctx.db.delete("events", event._id);
        remaining--;
        deleted++;
      }
      if (remaining === 0) return false;
      await ctx.db.delete("messages", message._id);
      remaining--;
      deleted++;
      return true;
    };

    if (remaining > 0) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_receivedAt", (q) => q.lt("receivedAt", cutoff))
        .take(remaining);
      for (const event of events) {
        await ctx.db.delete("events", event._id);
        remaining--;
        deleted++;
      }
    }
    if (remaining > 0) {
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
    if (remaining > 0) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_terminalAt", (q) => q.gt("terminalAt", 0).lt("terminalAt", cutoff))
        .take(remaining);
      for (const message of messages) {
        if (!(await deleteMessageWithEvents(message))) break;
      }
      await finalizeJobs();
    }
    if (remaining > 0) {
      // Accepted provider states (notably WhatsApp) can remain nonterminal forever.
      // Query status + missing terminalAt + createdAt so old active queue rows do not expire.
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
        if (remaining === 0) break;
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
    if (remaining > 0) {
      const receipts = await ctx.db
        .query("webhookReceipts")
        .withIndex("by_createdAt", (q) =>
          q.lt("createdAt", now - Math.max(days, MIN_RECEIPT_RETENTION_DAYS) * DAY),
        )
        .take(remaining);
      for (const receipt of receipts) {
        await ctx.db.delete("webhookReceipts", receipt._id);
        remaining--;
        deleted++;
      }
    }

    if (remaining === 0) await ctx.scheduler.runAfter(0, internal.cleanup.run, {});
    return { deleted, hasMore: remaining === 0 };
  },
});
