import { ZohoCpaas, channelValidator, statusValidator } from "@operatornest/convex-zoho-cpaas";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api.js";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server.js";

const zohoCpaas = new ZohoCpaas(components.zohoCpaas, {
  defaultFrom: { address: "notifications@example.test", name: "Example" },
});

export const status = query({
  args: {},
  returns: v.object({ configured: v.boolean(), testMode: v.boolean(), region: v.string() }),
  handler: (ctx) => zohoCpaas.messages.status(ctx),
});

export const sendEmail = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) =>
    zohoCpaas.email.send(ctx, {
      to: [{ address: args.to }],
      subject: args.subject,
      text: args.text,
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

export const getMessage = internalQuery({
  args: { messageId: v.string() },
  returns: v.union(
    v.object({
      to: v.string(),
      status: statusValidator,
      providerRequestId: v.optional(v.string()),
      testMode: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const message = await zohoCpaas.messages.get(ctx, { messageId: args.messageId });
    return message
      ? {
          to: message.to,
          status: message.status,
          ...(message.providerRequestId ? { providerRequestId: message.providerRequestId } : {}),
          ...(message.testMode === undefined ? {} : { testMode: message.testMode }),
        }
      : null;
  },
});

export const cancel = internalMutation({
  args: { messageId: v.string() },
  returns: v.boolean(),
  handler: (ctx, args) => zohoCpaas.messages.cancel(ctx, { messageId: args.messageId }),
});

export const uploadFile = internalAction({
  args: { name: v.string(), mimeType: v.string(), content: v.bytes() },
  returns: v.string(),
  handler: (ctx, args) => zohoCpaas.email.uploadFile(ctx, args),
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
  handler: (ctx, args) => zohoCpaas.experimental.whatsapp.sendTemplate(ctx, args),
});

export const sendSmsTemplate = internalMutation({
  args: { senderKey: v.string(), to: v.string(), templateKey: v.string() },
  returns: v.string(),
  handler: (ctx, args) => zohoCpaas.experimental.sms.sendTemplate(ctx, args),
});

export const listMessages = internalQuery({
  args: {
    recipient: v.optional(v.string()),
    channel: v.optional(channelValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(v.object({ id: v.string(), to: v.string(), status: statusValidator })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await zohoCpaas.messages.list(ctx, args);
    return {
      page: result.page.map((m) => ({ id: m._id, to: m.to, status: m.status })),
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
  args: { providerEventId: v.string() },
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
        .withIndex("by_providerEventId", (q) => q.eq("providerEventId", args.providerEventId))
        .take(501)
    ).map((row) => ({
      type: row.type,
      channel: row.channel,
      messageId: row.messageId,
      ambiguous: row.ambiguous,
    })),
});

// The maintainer runner invokes these internal wrappers through the same client as a consumer.
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
      text: `Open this email and visit https://example.com/?verification=${args.tag}`,
      html: `<p>End-to-end verification ${args.tag}</p><a href="https://example.com/?verification=${args.tag}">Click to verify tracking</a>`,
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
      text: `End-to-end batch verification ${args.tag}`,
      html: `<p>End-to-end batch verification ${args.tag}</p>`,
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
    zohoCpaas.experimental.whatsapp.sendTemplate(ctx, {
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
    zohoCpaas.experimental.sms.sendTemplate(ctx, {
      senderKey: args.senderKey,
      to: args.to,
      templateKey: args.templateKey,
      ...(args.mergeInfo ? { mergeInfo: args.mergeInfo } : {}),
    }),
});
