import { v } from "convex/values";

/** A messaging channel: `email`, `sms` or `whatsapp`. */
export const channelValidator = v.union(
  v.literal("email"),
  v.literal("sms"),
  v.literal("whatsapp"),
);

/** A stored message lifecycle status, defined in Concepts. */
export const statusValidator = v.union(
  v.literal("queued"),
  v.literal("sending"),
  v.literal("accepted"),
  v.literal("unknown"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("failed"),
  v.literal("bounced"),
  v.literal("complained"),
  v.literal("suppressed"),
  v.literal("canceled"),
);

/** An email address with an optional display name. */
export const emailAddressValidator = v.object({
  address: v.string(),
  name: v.optional(v.string()),
});

export const emailRecipientValidator = v.object({
  emailAddress: emailAddressValidator,
  mergeInfo: v.optional(v.record(v.string(), v.string())),
});

/** An email attachment given as base64 `content` with `mimeType`, or as a Zoho `fileCacheKey`. */
export const attachmentValidator = v.object({
  name: v.string(),
  mimeType: v.optional(v.string()),
  content: v.optional(v.string()),
  fileCacheKey: v.optional(v.string()),
});

/** An inline email image referenced by content ID `cid`, given as base64 `content` with `mimeType`, or as a Zoho `fileCacheKey`. */
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
  htmlbody: v.optional(v.string()),
  textbody: v.optional(v.string()),
};

const emailTemplate = {
  templateKey: v.optional(v.string()),
  templateAlias: v.optional(v.string()),
  mergeInfo: v.optional(v.record(v.string(), v.string())),
};

export const emailSendArgsValidator = v.object({
  ...emailCommon,
  ...emailBody,
  to: v.array(emailAddressValidator),
});

export const emailTemplateArgsValidator = v.object({
  ...emailCommon,
  ...emailTemplate,
  to: v.array(emailAddressValidator),
});

export const emailBatchArgsValidator = v.object({
  ...emailCommon,
  ...emailBody,
  mergeInfo: v.optional(v.record(v.string(), v.string())),
  to: v.array(emailRecipientValidator),
});

export const emailTemplateBatchArgsValidator = v.object({
  ...emailCommon,
  ...emailTemplate,
  to: v.array(emailRecipientValidator),
});

export const smsTemplateArgsValidator = v.object({
  senderKey: v.string(),
  to: v.string(),
  templateKey: v.optional(v.string()),
  templateAlias: v.optional(v.string()),
  mergeInfo: v.optional(v.record(v.string(), jsonLevelThree)),
  clientReference: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  testMode: v.optional(v.boolean()),
});

export const whatsappTemplateArgsValidator = v.object({
  from: v.string(),
  to: v.string(),
  zohoAgentId: v.optional(v.string()),
  templateKey: v.optional(v.string()),
  templateAlias: v.optional(v.string()),
  mergeInfo: v.optional(v.record(v.string(), jsonLevelThree)),
  clientReference: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  testMode: v.optional(v.boolean()),
});

/** Component configuration with secrets omitted: whether each channel has a credential, whether test mode is active, and the provider region. */
export const configurationValidator = v.object({
  configured: v.object({ email: v.boolean(), sms: v.boolean(), whatsapp: v.boolean() }),
  testMode: v.boolean(),
  region: v.string(),
});
