import { paginator } from "convex-helpers/server/pagination";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { normalizeRecipient } from "../shared/provider.js";
import { zohoCpaasError } from "../shared/errors.js";
import { boundedPage } from "../shared/bounds.js";
import { channelValidator } from "../shared/validators.js";
import type { Id } from "./_generated/dataModel.js";
import { mutation, query, type QueryCtx } from "./_generated/server.js";
import schema, { statusValidator } from "./schema.js";
import { pool } from "./pool.js";

function messageIdOrThrow(ctx: Pick<QueryCtx, "db">, value: string): Id<"messages"> {
  const id = ctx.db.normalizeId("messages", value);
  if (!id) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
  return id;
}

export const get = query({
  args: { messageId: v.string() },
  returns: schema.doc("messages"),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get("messages", messageIdOrThrow(ctx, messageId));
    if (!message) throw zohoCpaasError("ZOHO_CPAAS_NOT_FOUND");
    return message;
  },
});
export const list = query({
  args: {
    recipient: v.optional(v.string()),
    channel: v.optional(channelValidator),
    status: v.optional(statusValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("messages")),
  handler: async (ctx, args) => {
    if (Boolean(args.recipient) === Boolean(args.status))
      throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
    if (args.recipient) {
      if (!args.channel) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
      const recipient = normalizeRecipient(args.channel, args.recipient);
      return paginator(ctx.db, schema)
        .query("messages")
        .withIndex("by_to_and_createdAt", (q) => q.eq("to", recipient))
        .order("desc")
        .paginate(boundedPage(args.paginationOpts));
    }
    if (!args.status) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
    if (args.channel) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
    const status = args.status;
    return paginator(ctx.db, schema)
      .query("messages")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
      .order("desc")
      .paginate(boundedPage(args.paginationOpts));
  },
});
export const listEvents = query({
  args: { messageId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("events")),
  handler: async (ctx, args) => {
    const messageId = messageIdOrThrow(ctx, args.messageId);
    if (!(await ctx.db.get("messages", messageId))) throw zohoCpaasError("ZOHO_CPAAS_NOT_FOUND");
    return paginator(ctx.db, schema)
      .query("events")
      .withIndex("by_messageId_and_occurredAt", (q) => q.eq("messageId", messageId))
      .order("desc")
      .paginate(boundedPage(args.paginationOpts));
  },
});
export const cancel = mutation({
  args: { messageId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { messageId }) => {
    const id = messageIdOrThrow(ctx, messageId);
    const row = await ctx.db.get("messages", id);
    if (!row) throw zohoCpaasError("ZOHO_CPAAS_NOT_FOUND");
    if (row.canceledAt !== undefined) return false;
    if (row.status !== "queued") {
      if (row.status !== "unknown" || !row.jobId) return false;
      const job = await ctx.db.get("sendJobs", row.jobId);
      if (!job || job.finishedAt !== undefined) return false;
    }
    await ctx.db.patch("messages", id, {
      status: row.failureDefinitive === false ? "unknown" : "canceled",
      canceledAt: Date.now(),
      terminalAt: Date.now(),
    });
    if (row.jobId) {
      const job = await ctx.db.get("sendJobs", row.jobId);
      if (job) {
        const queuedSibling = await ctx.db
          .query("messages")
          .withIndex("by_jobId_and_status_and_canceledAt", (q) =>
            q.eq("jobId", row.jobId).eq("status", "queued"),
          )
          .take(1);
        const sendingSibling = await ctx.db
          .query("messages")
          .withIndex("by_jobId_and_status_and_canceledAt", (q) =>
            q.eq("jobId", row.jobId).eq("status", "sending"),
          )
          .take(1);
        const unknownSibling = await ctx.db
          .query("messages")
          .withIndex("by_jobId_and_status_and_canceledAt", (q) =>
            q.eq("jobId", row.jobId).eq("status", "unknown").eq("canceledAt", undefined),
          )
          .take(1);
        if (
          queuedSibling.length === 0 &&
          sendingSibling.length === 0 &&
          unknownSibling.length === 0 &&
          job.workId
        ) {
          await pool.cancel(ctx, job.workId);
        }
      }
    }
    return true;
  },
});
