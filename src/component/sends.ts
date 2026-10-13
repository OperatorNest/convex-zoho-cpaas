import { isRecord } from "../shared/record.js";
import { v } from "convex/values";
import { classifyNetworkError, classifyProviderError, retryBackoffMs } from "../shared/retry.js";
import { isZohoCpaasError, zohoCpaasError, type ZohoCpaasErrorCode } from "../shared/errors.js";
import { readBoundedText } from "../shared/bounds.js";
import { maxProviderBodyBytes, normalizeEmail } from "../shared/provider.js";
import { canTransitionStatus } from "../shared/status.js";
import { reconcileRequestEvents } from "./webhooks.js";
import { internal } from "./_generated/api.js";
import type { DataModel, Doc } from "./_generated/dataModel.js";
import { internalAction, internalMutation } from "./_generated/server.js";
import { errorValidator } from "./schema.js";
import { channelValidator } from "../shared/validators.js";
import { pool } from "./pool.js";
import { providerBaseUrl, providerConfiguration } from "./config.js";

const completionContext = v.object({ jobId: v.id("sendJobs"), attempt: v.number() });
const outcomeValidator = v.object({
  kind: v.union(v.literal("skipped"), v.literal("accepted"), v.literal("failed")),
  zohoRequestId: v.optional(v.string()),
  zohoMessageId: v.optional(v.string()),
  warning: v.optional(v.string()),
  error: v.optional(errorValidator),
  retryable: v.optional(v.boolean()),
  failureDefinitive: v.optional(v.boolean()),
  retryAfterMs: v.optional(v.number()),
  explicitResponse: v.optional(v.boolean()),
  suppressionReason: v.optional(v.string()),
});
type Outcome = typeof outcomeValidator.type;

export const begin = internalMutation({
  args: { jobId: v.id("sendJobs"), attempt: v.number() },
  returns: v.union(
    v.object({
      channel: channelValidator,
      path: v.string(),
      payload: v.string(),
      testMode: v.boolean(),
      active: v.array(v.string()),
      baseUrl: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { jobId, attempt }) => {
    const job = await ctx.db.get("sendJobs", jobId);
    if (!job || job.finishedAt !== undefined) return null;
    const now = Date.now();
    let baseUrl: string | undefined;
    let configurationError: typeof errorValidator.type | undefined;
    try {
      baseUrl = job.testMode
        ? providerBaseUrl(job.channel)
        : providerConfiguration(job.channel).baseUrl;
    } catch (error) {
      configurationError = isZohoCpaasError(error)
        ? error.data
        : zohoCpaasError("ZOHO_CPAAS_NOT_CONFIGURED").data;
    }
    const active: string[] = [];
    for (const id of job.messageIds) {
      const row = await ctx.db.get("messages", id);
      if (!row || row.canceledAt !== undefined) continue;
      const isResendable = row.status === "queued";
      if (!isResendable) {
        if (row.status === "sending")
          await ctx.db.patch("messages", id, {
            status: "unknown",
            failureDefinitive: false,
            sendingAt: undefined,
          });
        continue;
      }
      const suppression = await ctx.db
        .query("suppressions")
        .withIndex("by_testMode_and_channel_and_address", (q) =>
          q.eq("testMode", job.testMode).eq("channel", row.channel).eq("address", row.to),
        )
        .unique();
      if (suppression) {
        await ctx.db.patch("messages", id, {
          status: row.failureDefinitive === false ? "unknown" : "suppressed",
          sendingAt: undefined,
          terminalAt: now,
        });
        continue;
      }
      if (configurationError) {
        await ctx.db.patch("messages", id, {
          status: row.failureDefinitive === false ? "unknown" : "failed",
          error: configurationError,
          failureDefinitive: row.failureDefinitive !== false,
          sendingAt: undefined,
          terminalAt: now,
        });
        continue;
      }
      active.push(row.to);
      await ctx.db.patch("messages", id, {
        status: "sending",
        sendingAt: now,
        attempts: Math.max(row.attempts, attempt),
      });
    }
    if (!active.length) {
      await ctx.db.patch("sendJobs", jobId, {
        finishedAt: Date.now(),
        payload: "",
      });
      return null;
    }
    await ctx.db.patch("sendJobs", jobId, { attempts: Math.max(job.attempts, attempt) });
    return {
      channel: job.channel,
      path: job.path,
      payload: job.payload,
      testMode: job.testMode,
      active,
      baseUrl,
    };
  },
});

function filterCanceled(
  payload: Record<string, unknown>,
  active: string[],
): Record<string, unknown> {
  const allowed = new Set(active);
  for (const field of ["to", "cc", "bcc"] as const) {
    const value = payload[field];
    if (Array.isArray(value)) {
      payload[field] = value.filter((item: unknown) => {
        if (!isRecord(item) || !isRecord(item.email_address)) return false;
        const address = item.email_address.address;
        return typeof address === "string" && allowed.has(normalizeEmail(address));
      });
    }
  }
  return payload;
}

function responseIds(
  value: unknown,
  channel: Doc<"sendJobs">["channel"],
): {
  requestId?: string;
  messageId?: string;
  accepted: boolean;
} {
  if (!isRecord(value)) return { accepted: false };
  const data = value.data;
  if (channel === "email" && Array.isArray(data)) {
    const accepted = data.some((item: unknown) => isRecord(item) && item.code === "EM_104");
    const requestId =
      typeof value.request_id === "string" && value.request_id.length <= 512
        ? value.request_id
        : undefined;
    return { accepted: accepted && !!requestId, ...(requestId ? { requestId } : {}) };
  }
  if (channel !== "email" && isRecord(data)) {
    const item = data;
    const requestId =
      typeof item.request_id === "string" && item.request_id.length <= 512
        ? item.request_id
        : undefined;
    const messageId =
      typeof item.message_id === "string" && item.message_id.length <= 512
        ? item.message_id
        : undefined;
    return {
      accepted: item.code === "MSG_101" && !!requestId && !!messageId,
      ...(requestId ? { requestId } : {}),
      ...(messageId ? { messageId } : {}),
    };
  }
  return { accepted: false };
}

function recipientFailure(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const error = body.error;
  if (!isRecord(error)) return undefined;
  const details = error.details;
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    if (!isRecord(detail)) continue;
    const value = detail.code;
    if (value === "dnd-number" || value === "inv-number") return value;
  }
  return undefined;
}

export const execute = internalAction({
  args: { jobId: v.id("sendJobs"), attempt: v.number() },
  returns: outcomeValidator,
  handler: async (ctx, { jobId, attempt }): Promise<Outcome> => {
    const job = await ctx.runMutation(internal.sends.begin, { jobId, attempt });
    if (!job) return { kind: "skipped" };
    let requestStarted = false;
    let response: Response | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const parsed: unknown = JSON.parse(job.payload);
      if (!isRecord(parsed))
        return {
          kind: "failed",
          error: zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT").data,
          failureDefinitive: true,
        };
      let payload = parsed;
      if (job.channel === "email") payload = filterCanceled(payload, job.active);
      if (job.channel === "email" && (!Array.isArray(payload.to) || payload.to.length === 0))
        return {
          kind: "failed",
          error: zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT").data,
          failureDefinitive: true,
        };
      if (job.testMode)
        return {
          kind: "accepted",
          zohoRequestId: `test-${jobId}`,
          ...(job.channel === "email" ? {} : { zohoMessageId: `test-${jobId}` }),
        };

      const { authorization } = providerConfiguration(job.channel);
      const baseUrl = job.baseUrl;
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 30_000);
      const request = {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: controller.signal,
      } satisfies RequestInit;
      requestStarted = true;
      response = await fetch(`${baseUrl}${job.path}`, request);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        return {
          kind: "failed",
          explicitResponse: true,
          failureDefinitive: false,
          error: zohoCpaasError("ZOHO_CPAAS_INVALID_RESPONSE").data,
          retryable: false,
        };
      }
      const raw = await readBoundedText(response, maxProviderBodyBytes);
      let body: unknown;
      try {
        body = raw === undefined ? null : JSON.parse(raw);
      } catch {
        body = null;
      }
      if (response.ok) {
        const ids = responseIds(body, job.channel);
        return ids.accepted
          ? {
              kind: "accepted",
              ...(ids.requestId ? { zohoRequestId: ids.requestId } : {}),
              ...(ids.messageId ? { zohoMessageId: ids.messageId } : {}),
            }
          : {
              kind: "accepted",
              warning: "ZOHO_CPAAS_INVALID_RESPONSE" satisfies ZohoCpaasErrorCode,
            };
      }
      const classified = classifyProviderError(
        response.status,
        body,
        response.headers.get("Retry-After"),
        Date.now(),
        job.channel,
      );
      console.warn(classified.code);
      return {
        kind: "failed",
        explicitResponse: true,
        failureDefinitive:
          (response.status < 500 && response.status !== 408) ||
          classified.accountState ||
          (response.status >= 500 && classified.explicitZohoCode === true),
        error: zohoCpaasError(classified.code, classified).data,
        retryable: classified.retryable,
        ...(classified.retryAfterMs === undefined ? {} : { retryAfterMs: classified.retryAfterMs }),
        ...(job.channel === "sms" && !classified.retryable && recipientFailure(body)
          ? { suppressionReason: recipientFailure(body) ?? "" }
          : {}),
      };
    } catch (error) {
      if (!requestStarted)
        return {
          kind: "failed",
          failureDefinitive: true,
          error: isZohoCpaasError(error)
            ? error.data
            : zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT").data,
        };
      if (response?.ok)
        return {
          kind: "accepted",
          warning: "ZOHO_CPAAS_INVALID_RESPONSE" satisfies ZohoCpaasErrorCode,
        };
      const classified = classifyNetworkError();
      console.warn(classified.code);
      return {
        kind: "failed",
        failureDefinitive: false,
        error: zohoCpaasError(classified.code, classified).data,
        retryable: classified.retryable,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});

export const complete = pool.defineOnComplete<
  DataModel,
  typeof completionContext,
  typeof outcomeValidator
>({
  context: completionContext,
  returnValue: outcomeValidator,
  handler: async (ctx, args) => {
    const job = await ctx.db.get("sendJobs", args.context.jobId);
    if (!job || job.finishedAt !== undefined) return;
    const attempt = args.context.attempt;
    const outcome: Outcome =
      args.result.kind === "success"
        ? args.result.returnValue
        : args.result.kind === "canceled"
          ? { kind: "skipped" }
          : {
              kind: "failed",
              error: zohoCpaasError("ZOHO_CPAAS_NETWORK_ERROR", {
                retryable: false,
              }).data,
              retryable: false,
              failureDefinitive: false,
            };

    if (job.attempts < attempt) {
      await ctx.db.patch("sendJobs", job._id, { attempts: attempt });
      for (const id of job.messageIds) {
        const row = await ctx.db.get("messages", id);
        if (row) await ctx.db.patch("messages", id, { attempts: Math.max(row.attempts, attempt) });
      }
    }
    if (outcome.kind === "skipped") {
      await ctx.db.patch("sendJobs", job._id, { finishedAt: Date.now(), payload: "" });
      return;
    }
    const now = Date.now();
    const retry =
      outcome.kind === "failed" &&
      outcome.retryable === true &&
      attempt < 5 &&
      (job.channel === "email" || outcome.explicitResponse === true);
    if (retry) {
      const nextAttempt = attempt + 1;
      const workId = await pool.enqueueAction(
        ctx,
        internal.sends.execute,
        { jobId: job._id, attempt: nextAttempt },
        {
          onComplete: internal.sends.complete,
          context: { jobId: job._id, attempt: nextAttempt },
          retry: false,
          runAfter: Math.max(outcome.retryAfterMs ?? 0, retryBackoffMs(attempt)),
        },
      );
      await ctx.db.patch("sendJobs", job._id, { workId });
      for (const id of job.messageIds) {
        const row = await ctx.db.get("messages", id);
        if (
          row &&
          row.canceledAt === undefined &&
          (row.status === "sending" || row.status === "unknown")
        ) {
          await ctx.db.patch("messages", id, {
            status: outcome.failureDefinitive === false ? "unknown" : "queued",
            sendingAt: undefined,
            ...(outcome.failureDefinitive === false ? { failureDefinitive: false } : {}),
          });
        } else if (row?.status === "queued" && outcome.failureDefinitive === false) {
          await ctx.db.patch("messages", id, { status: "unknown", failureDefinitive: false });
        }
      }
      return;
    }
    for (const id of job.messageIds) {
      const row = await ctx.db.get("messages", id);
      if (
        !row ||
        row.canceledAt !== undefined ||
        row.status === "canceled" ||
        row.status === "suppressed"
      )
        continue;
      const next =
        outcome.kind === "accepted"
          ? "accepted"
          : outcome.failureDefinitive === false || row.failureDefinitive === false
            ? "unknown"
            : "failed";
      const applyStatus = canTransitionStatus(row.status, next, row.channel);
      const failureDefinitive =
        outcome.kind === "failed"
          ? !applyStatus
            ? row.failureDefinitive
            : row.failureDefinitive === false
              ? false
              : outcome.failureDefinitive === true
          : row.failureDefinitive;
      const statusUpdate: { status?: "accepted" | "failed" | "unknown" } = applyStatus
        ? { status: next }
        : {};
      const patch = {
        ...((outcome.zohoRequestId ?? row.zohoRequestId)
          ? { zohoRequestId: outcome.zohoRequestId ?? row.zohoRequestId }
          : {}),
        ...((outcome.zohoMessageId ?? row.zohoMessageId)
          ? { zohoMessageId: outcome.zohoMessageId ?? row.zohoMessageId }
          : {}),
        ...(outcome.warning ? { warning: outcome.warning } : {}),
        ...(failureDefinitive === undefined ? {} : { failureDefinitive }),
        sendingAt: undefined,
        ...statusUpdate,
        ...(applyStatus && next === "accepted" ? { sentAt: now } : {}),
        ...((applyStatus || (row.status === "unknown" && next === "unknown")) &&
        (next === "failed" ||
          next === "unknown" ||
          (next === "accepted" && row.channel !== "whatsapp"))
          ? { terminalAt: now }
          : {}),
        ...(outcome.error && applyStatus
          ? { error: outcome.error }
          : outcome.kind === "accepted"
            ? { error: undefined }
            : {}),
      };
      await ctx.db.patch("messages", id, patch);
      if (row.channel === "sms" && outcome.kind === "failed" && outcome.suppressionReason) {
        const old = await ctx.db
          .query("suppressions")
          .withIndex("by_testMode_and_channel_and_address", (q) =>
            q.eq("testMode", job.testMode).eq("channel", "sms").eq("address", row.to),
          )
          .unique();
        if (!old)
          await ctx.db.insert("suppressions", {
            testMode: job.testMode,
            channel: "sms",
            address: row.to,
            reason: outcome.suppressionReason,
            sourceMessageId: row._id,
            createdAt: now,
          });
      }
    }
    if (outcome.kind === "accepted" && outcome.zohoRequestId)
      await reconcileRequestEvents(ctx, outcome.zohoRequestId, job.messageIds);
    await ctx.db.patch("sendJobs", job._id, { finishedAt: now, payload: "" });
  },
});
