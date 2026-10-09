import { v } from "convex/values";

export const channelValidator = v.union(
  v.literal("email"),
  v.literal("sms"),
  v.literal("whatsapp"),
);

export const statusValidator = v.union(
  v.literal("queued"),
  v.literal("sending"),
  v.literal("accepted"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("failed"),
  v.literal("bounced"),
  v.literal("complained"),
  v.literal("suppressed"),
  v.literal("canceled"),
);

export const emailAddressValidator = v.object({
  address: v.string(),
  name: v.optional(v.string()),
});

export const emailRecipientValidator = v.object({
  emailAddress: emailAddressValidator,
  mergeInfo: v.optional(v.record(v.string(), v.string())),
});

export const attachmentValidator = v.object({
  name: v.string(),
  mimeType: v.optional(v.string()),
  content: v.optional(v.string()),
  fileCacheKey: v.optional(v.string()),
});

export const inlineImageValidator = v.object({
  cid: v.string(),
  mimeType: v.optional(v.string()),
  content: v.optional(v.string()),
  fileCacheKey: v.optional(v.string()),
});

const jsonScalar = v.union(v.string(), v.number(), v.boolean(), v.null());
const jsonLevelOne = v.union(jsonScalar, v.array(jsonScalar), v.record(v.string(), jsonScalar));
const jsonLevelTwo = v.union(jsonScalar, v.array(jsonLevelOne), v.record(v.string(), jsonLevelOne));
const jsonLevelThree = v.union(
  jsonScalar,
  v.array(jsonLevelTwo),
  v.record(v.string(), jsonLevelTwo),
);

const emailCommon = {
  from: emailAddressValidator,
  cc: v.optional(v.array(emailAddressValidator)),
  bcc: v.optional(v.array(emailAddressValidator)),
  replyTo: v.optional(v.array(emailAddressValidator)),
  trackOpens: v.optional(v.boolean()),
  trackClicks: v.optional(v.boolean()),
  clientReference: v.optional(v.string()),
  mimeHeaders: v.optional(v.record(v.string(), v.string())),
  attachments: v.optional(v.array(attachmentValidator)),
  inlineImages: v.optional(v.array(inlineImageValidator)),
  idempotencyKey: v.optional(v.string()),
  testMode: v.optional(v.boolean()),
};

const emailBody = {
  subject: v.string(),
  html: v.optional(v.string()),
  text: v.optional(v.string()),
};

const emailTemplate = {
  templateKey: v.optional(v.string()),
  templateAlias: v.optional(v.string()),
  mergeInfo: v.optional(v.record(v.string(), v.string())),
};

export const emailSendArgs = v.object({
  ...emailCommon,
  ...emailBody,
  to: v.array(emailAddressValidator),
});

export const emailTemplateArgs = v.object({
  ...emailCommon,
  ...emailTemplate,
  to: v.array(emailAddressValidator),
});

export const emailBatchArgs = v.object({
  ...emailCommon,
  ...emailBody,
  mergeInfo: v.optional(v.record(v.string(), v.string())),
  to: v.array(emailRecipientValidator),
});

export const emailTemplateBatchArgs = v.object({
  ...emailCommon,
  ...emailTemplate,
  to: v.array(emailRecipientValidator),
});

export const smsTemplateArgs = v.object({
  senderKey: v.string(),
  to: v.string(),
  templateKey: v.optional(v.string()),
  templateAlias: v.optional(v.string()),
  mergeInfo: v.optional(v.record(v.string(), jsonLevelThree)),
  clientReference: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  testMode: v.optional(v.boolean()),
});

export const whatsappTemplateArgs = v.object({
  from: v.string(),
  to: v.string(),
  agentId: v.optional(v.string()),
  templateKey: v.optional(v.string()),
  templateAlias: v.optional(v.string()),
  mergeInfo: v.optional(v.record(v.string(), jsonLevelThree)),
  clientReference: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  testMode: v.optional(v.boolean()),
});
