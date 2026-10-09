import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { normalizedWebhookEventValidator } from "@operatornest/convex-zoho-cpaas";

export const record = internalMutation({
  args: {
    event: normalizedWebhookEventValidator,
    messageId: v.optional(v.string()),
    ambiguous: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { event, messageId, ambiguous }) => {
    const control = await ctx.db
      .query("webhookCallbackControl")
      .withIndex("by_key", (q) => q.eq("key", "webhook"))
      .unique();
    if (control?.fail)
      throw new ConvexError({ code: "ZOHO_CPAAS_CALLBACK_FAILED", message: "Retry webhook" });
    await ctx.db.insert("webhookEvents", {
      providerEventId: event.providerEventId,
      type: event.type,
      ...(event.recipient ? { recipient: event.recipient } : {}),
      occurredAt: event.occurredAt,
      channel: event.channel,
      ...(messageId ? { messageId } : {}),
      ambiguous,
    });
    return null;
  },
});
