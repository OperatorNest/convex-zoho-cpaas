import { v } from "convex/values";
import {
  emailSendArgsValidator,
  emailTemplateArgsValidator,
  emailBatchArgsValidator,
  emailTemplateBatchArgsValidator,
} from "../shared/validators.js";
import { mutation } from "./_generated/server.js";
import { enqueueEmail } from "./enqueue.js";

export const send = mutation({
  args: emailSendArgsValidator.fields,
  returns: v.array(v.id("messages")),
  handler: (ctx, args) => enqueueEmail(ctx, args, "/email", false),
});

export const sendTemplate = mutation({
  args: emailTemplateArgsValidator.fields,
  returns: v.array(v.id("messages")),
  handler: (ctx, args) => enqueueEmail(ctx, args, "/email/template", false),
});

export const sendBatch = mutation({
  args: emailBatchArgsValidator.fields,
  returns: v.array(v.id("messages")),
  handler: (ctx, args) => enqueueEmail(ctx, args, "/email/batch", true),
});

export const sendTemplateBatch = mutation({
  args: emailTemplateBatchArgsValidator.fields,
  returns: v.array(v.id("messages")),
  handler: (ctx, args) => enqueueEmail(ctx, args, "/email/template/batch", true),
});
