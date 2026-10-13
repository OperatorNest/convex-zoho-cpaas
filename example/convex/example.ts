import {
  ZohoCpaas,
  channelValidator,
  configurationValidator,
  statusValidator,
} from "@operatornest/convex-zoho-cpaas";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api.js";
import { internalAction, internalMutation, internalQuery } from "./_generated/server.js";

const zohoCpaas = new ZohoCpaas(components.zohoCpaas, {
  defaultFrom: { address: "notifications@example.test", name: "Example" },
});

export const getConfig = internalQuery({
  args: {},
  returns: configurationValidator,
  handler: (ctx) => zohoCpaas.config.get(ctx),
});

export const sendEmail = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    textbody: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) =>
    zohoCpaas.email.send(ctx, {
      to: [{ address: args.to }],
      subject: args.subject,
      textbody: args.textbody,
      idempotencyKey: args.idempotencyKey,
    }),
});

export const sendTemplate = internalMutation({
  args: { to: v.string(), templateKey: v.string() },
  returns: v.array(v.string()),
  handler: (ctx, args) =>
    zohoCpaas.email.sendTemplate(ctx, {
      to: [{ address: args.to }],
      templateKey: args.templateKey,
    }),
});

export const get = internalQuery({
  args: { messageId: v.string() },
  returns: v.object({
    to: v.string(),
    status: statusValidator,
    zohoRequestId: v.optional(v.string()),
    testMode: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const message = await zohoCpaas.messages.get(ctx, { messageId: args.messageId });
    return {
      to: message.to,
      status: message.status,
      zohoRequestId: message.zohoRequestId,
      testMode: message.testMode,
    };
  },
});

export const cancel = internalMutation({
  args: { messageId: v.string() },
  returns: v.boolean(),
  handler: (ctx, args) => zohoCpaas.messages.cancel(ctx, { messageId: args.messageId }),
});

export const upload = internalAction({
  args: { name: v.string(), mimeType: v.string(), content: v.bytes() },
  returns: v.string(),
  handler: (ctx, args) => zohoCpaas.files.upload(ctx, args),
});

export const sendTemplateBatch = internalMutation({
  args: {
    recipients: v.array(v.string()),
    templateKey: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.array(v.string()),
  handler: (ctx, args) =>
    zohoCpaas.email.sendTemplateBatch(ctx, {
      to: args.recipients.map((address) => ({
        emailAddress: { address },
        mergeInfo: { name: address.split("@")[0] ?? address },
      })),
      templateKey: args.templateKey,
      idempotencyKey: args.idempotencyKey,
    }),
});

export const sendWhatsappTemplate = internalMutation({
  args: { from: v.string(), to: v.string(), templateKey: v.string() },
  returns: v.string(),
  handler: (ctx, args) => zohoCpaas.whatsapp.sendTemplate(ctx, args),
});

export const sendSmsTemplate = internalMutation({
  args: { senderKey: v.string(), to: v.string(), templateKey: v.string() },
  returns: v.string(),
  handler: (ctx, args) => zohoCpaas.sms.sendTemplate(ctx, args),
});

export const list = internalQuery({
  args: {
    recipient: v.optional(v.string()),
    channel: v.optional(channelValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(v.object({ messageId: v.string(), to: v.string(), status: statusValidator })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await zohoCpaas.messages.list(ctx, args);
    return {
      page: result.page.map((m) => ({ messageId: m._id, to: m.to, status: m.status })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listSuppressions = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.array(v.object({ address: v.string(), reason: v.string() })),
  handler: async (ctx, args) => {
    const result = await zohoCpaas.suppressions.list(ctx, {
      channel: "email",
      paginationOpts: args.paginationOpts,
    });
    return result.page.map((s) => ({ address: s.address, reason: s.reason }));
  },
});

export const removeSuppression = internalMutation({
  args: { address: v.string() },
  returns: v.boolean(),
  handler: (ctx, args) =>
    zohoCpaas.suppressions.remove(ctx, { channel: "email", address: args.address }),
});

export const webhookCallbackCount = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await ctx.db.query("webhookEvents").take(1000)).length,
});

export const e2eCallbacksFor = internalQuery({
  args: { zohoEventId: v.string() },
  returns: v.array(
    v.object({
      type: v.string(),
      channel: v.optional(v.string()),
      messageId: v.optional(v.string()),
      ambiguous: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("webhookEvents")
        .withIndex("by_zohoEventId", (q) => q.eq("zohoEventId", args.zohoEventId))
        .take(501)
    ).map((row) => ({
      type: row.type,
      channel: row.channel,
      messageId: row.messageId,
      ambiguous: row.ambiguous,
    })),
});

export const e2eSendEmail = internalMutation({
  args: {
    from: v.string(),
    to: v.string(),
    tag: v.string(),
    attachmentKey: v.optional(v.string()),
  },
  returns: v.array(v.string()),
  handler: (ctx, args) =>
    zohoCpaas.email.send(ctx, {
      from: { address: args.from },
      to: [{ address: args.to }],
      subject: `End-to-end verification ${args.tag}`,
      textbody: `Open this email and visit https://example.com/?verification=${args.tag}`,
      htmlbody: `<p>End-to-end verification ${args.tag}</p><a href="https://example.com/?verification=${args.tag}">Click to verify tracking</a>`,
      trackOpens: true,
      trackClicks: true,
      clientReference: args.tag,
      ...(args.attachmentKey
        ? { attachments: [{ name: "verification.txt", fileCacheKey: args.attachmentKey }] }
        : {}),
    }),
});

export const e2eSendTemplate = internalMutation({
  args: {
    from: v.string(),
    to: v.string(),
    templateKey: v.string(),
    mergeInfo: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.array(v.string()),
  handler: (ctx, args) =>
    zohoCpaas.email.sendTemplate(ctx, {
      from: { address: args.from },
      to: [{ address: args.to }],
      templateKey: args.templateKey,
      ...(args.mergeInfo ? { mergeInfo: args.mergeInfo } : {}),
    }),
});

export const e2eSendBatch = internalMutation({
  args: { from: v.string(), recipients: v.array(v.string()), tag: v.string() },
  returns: v.array(v.string()),
  handler: (ctx, args) =>
    zohoCpaas.email.sendBatch(ctx, {
      from: { address: args.from },
      to: args.recipients.map((address) => ({ emailAddress: { address } })),
      subject: `End-to-end batch verification ${args.tag}`,
      textbody: `End-to-end batch verification ${args.tag}`,
      htmlbody: `<p>End-to-end batch verification ${args.tag}</p>`,
    }),
});

export const e2eSendWhatsapp = internalMutation({
  args: {
    from: v.string(),
    to: v.string(),
    templateKey: v.string(),
    mergeInfo: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.string(),
  handler: (ctx, args) =>
    zohoCpaas.whatsapp.sendTemplate(ctx, {
      from: args.from,
      to: args.to,
      templateKey: args.templateKey,
      ...(args.mergeInfo ? { mergeInfo: args.mergeInfo } : {}),
    }),
});

export const e2eSendSms = internalMutation({
  args: {
    senderKey: v.string(),
    to: v.string(),
    templateKey: v.string(),
    mergeInfo: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.string(),
  handler: (ctx, args) =>
    zohoCpaas.sms.sendTemplate(ctx, {
      senderKey: args.senderKey,
      to: args.to,
      templateKey: args.templateKey,
      ...(args.mergeInfo ? { mergeInfo: args.mergeInfo } : {}),
    }),
});
