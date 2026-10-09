import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  webhookEvents: defineTable({
    providerEventId: v.optional(v.string()),
    type: v.string(),
    recipient: v.optional(v.string()),
    occurredAt: v.number(),
    channel: v.optional(v.string()),
    messageId: v.optional(v.string()),
    ambiguous: v.optional(v.boolean()),
  }).index("by_providerEventId", ["providerEventId"]),
  webhookCallbackControl: defineTable({
    key: v.string(),
    fail: v.boolean(),
  }).index("by_key", ["key"]),
  e2eWebhookAttempts: defineTable({
    sessionId: v.string(),
    rawBody: v.string(),
    contentType: v.string(),
    signature: v.optional(v.string()),
    reason: v.string(),
    duplicate: v.boolean(),
    receivedAt: v.number(),
  }).index("by_sessionId_and_receivedAt", ["sessionId", "receivedAt"]),
  e2eWebhookSession: defineTable({
    key: v.string(),
    sessionId: v.string(),
    expiresAt: v.number(),
    attemptCount: v.number(),
    quotaExceeded: v.boolean(),
  }).index("by_key", ["key"]),
});
