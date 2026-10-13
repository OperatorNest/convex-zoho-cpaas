import { v } from "convex/values";
import {
  emailSendArgs,
  emailTemplateArgs,
  emailBatchArgs,
  emailTemplateBatchArgs,
} from "../shared/validators.js";
import { mutation } from "./_generated/server.js";
import { enqueueEmail } from "./enqueue.js";

export const send = mutation({
  args: emailSendArgs.fields,
  returns: v.array(v.id("messages")),
  handler: (ctx, args) => enqueueEmail(ctx, args, "/email", false),
});

export const sendTemplate = mutation({
  args: emailTemplateArgs.fields,
  returns: v.array(v.id("messages")),
  handler: (ctx, args) => enqueueEmail(ctx, args, "/email/template", false),
});

export const sendBatch = mutation({
  args: emailBatchArgs.fields,
  returns: v.array(v.id("messages")),
  handler: (ctx, args) => enqueueEmail(ctx, args, "/email/batch", true),
});

export const sendTemplateBatch = mutation({
  args: emailTemplateBatchArgs.fields,
  returns: v.array(v.id("messages")),
  handler: (ctx, args) => enqueueEmail(ctx, args, "/email/template/batch", true),
});
