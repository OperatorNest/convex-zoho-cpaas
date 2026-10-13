import { v } from "convex/values";
import { whatsappTemplateArgsValidator } from "../shared/validators.js";
import { mutation } from "./_generated/server.js";
import { enqueueTemplate } from "./enqueue.js";

export const sendTemplate = mutation({
  args: whatsappTemplateArgsValidator.fields,
  returns: v.id("messages"),
  handler: (ctx, args) => enqueueTemplate(ctx, args, "whatsapp"),
});
