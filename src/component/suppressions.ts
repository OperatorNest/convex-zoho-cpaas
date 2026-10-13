import { boundedPage } from "../shared/bounds.js";
import { paginator } from "convex-helpers/server/pagination";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { readTestMode } from "./config.js";
import { normalizeRecipient } from "../shared/provider.js";
import { mutation, query } from "./_generated/server.js";
import schema, { channelValidator } from "./schema.js";

export const list = query({
  args: {
    channel: channelValidator,
    testMode: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("suppressions")),
  handler: (ctx, args) =>
    paginator(ctx.db, schema)
      .query("suppressions")
      .withIndex("by_testMode_and_channel_and_address", (q) =>
        q.eq("testMode", readTestMode(args.testMode)).eq("channel", args.channel),
      )
      .paginate(boundedPage(args.paginationOpts)),
});

export const remove = mutation({
  args: { channel: channelValidator, testMode: v.optional(v.boolean()), address: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const address = normalizeRecipient(args.channel, args.address);
    const row = await ctx.db
      .query("suppressions")
      .withIndex("by_testMode_and_channel_and_address", (q) =>
        q
          .eq("testMode", readTestMode(args.testMode))
          .eq("channel", args.channel)
          .eq("address", address),
      )
      .unique();
    if (!row) return false;
    await ctx.db.delete("suppressions", row._id);
    return true;
  },
});
