import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vWorkId } from "@convex-dev/workpool";
import { ZOHO_CPAAS_ERROR_CODES } from "../shared/errors.js";
import { channelValidator, statusValidator } from "../shared/validators.js";
import { normalizedWebhookEventValidator } from "../shared/webhook.js";

export const eventChannelValidator = normalizedWebhookEventValidator.fields.channel;
export { channelValidator, statusValidator };
export const errorValidator = v.object({
  code: v.union(...ZOHO_CPAAS_ERROR_CODES.map((code) => v.literal(code))),
  message: v.string(),
  retryable: v.optional(v.boolean()),
  providerStatus: v.optional(v.number()),
  providerCode: v.optional(v.string()),
});

export default defineSchema({
  messages: defineTable({
    channel: channelValidator,
    to: v.string(),
    from: v.string(),
    status: statusValidator,
    jobId: v.optional(v.id("sendJobs")),
    zohoMessageId: v.optional(v.string()),
    zohoRequestId: v.optional(v.string()),
    clientReference: v.string(),
    attempts: v.number(),
    failureDefinitive: v.optional(v.boolean()),
    error: v.optional(errorValidator),
    warning: v.optional(v.string()),
    testMode: v.boolean(),
    region: v.string(),
    createdAt: v.number(),
    sendingAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    terminalAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
  })
    .index("by_zohoRequestId_and_to", ["zohoRequestId", "to"])
    .index("by_zohoMessageId", ["zohoMessageId"])
    .index("by_channel_and_clientReference_and_to", ["channel", "clientReference", "to"])
    .index("by_to_and_createdAt", ["to", "createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_status_and_sendingAt_and_createdAt", ["status", "sendingAt", "createdAt"])
    .index("by_terminalAt", ["terminalAt"])
    .index("by_status_and_terminalAt_and_createdAt", ["status", "terminalAt", "createdAt"])
    .index("by_jobId_and_status_and_canceledAt", ["jobId", "status", "canceledAt"]),
  sendJobs: defineTable({
    channel: channelValidator,
    path: v.string(),
    payload: v.string(),
    idempotencyKey: v.optional(v.string()),
    requestHash: v.string(),
    messageIds: v.array(v.id("messages")),
    workId: v.optional(vWorkId),
    attempts: v.number(),
    testMode: v.boolean(),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_finishedAt", ["finishedAt"])
    .index("by_idempotencyKey", ["idempotencyKey"]),
  events: defineTable({
    messageId: v.optional(v.id("messages")),
    channel: eventChannelValidator,
    type: v.string(),
    occurredAt: v.number(),
    receivedAt: v.number(),
    zohoEventId: v.string(),
    raw: v.string(),
    zohoRequestId: v.optional(v.string()),
    zohoMessageId: v.optional(v.string()),
    clientReference: v.optional(v.string()),
    recipient: v.optional(v.string()),
    ambiguous: v.optional(v.boolean()),
    testMode: v.boolean(),
  })
    .index("by_messageId_and_occurredAt", ["messageId", "occurredAt"])
    .index("by_receivedAt", ["receivedAt"])
    .index("by_zohoRequestId_and_recipient", ["zohoRequestId", "recipient"]),
  webhookReceipts: defineTable({
    testMode: v.boolean(),
    zohoEventId: v.string(),
    createdAt: v.number(),
    reason: v.optional(v.string()),
    bodyHash: v.string(),
  })
    .index("by_zohoEventId_and_reason", ["zohoEventId", "reason"])
    .index("by_bodyHash_and_reason", ["bodyHash", "reason"])
    .index("by_createdAt", ["createdAt"]),
  suppressions: defineTable({
    testMode: v.boolean(),
    channel: channelValidator,
    address: v.string(),
    reason: v.string(),
    sourceMessageId: v.optional(v.id("messages")),
    createdAt: v.number(),
  }).index("by_channel_and_address", ["channel", "address"]),
});
