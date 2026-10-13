import {
  createFunctionHandle,
  httpActionGeneric,
  type FunctionReference_future,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type HttpRouter,
  type PaginationOptions,
} from "convex/server";
import type { Infer } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";
import type { Doc } from "../component/_generated/dataModel.js";
import type { EmailAddress } from "../shared/provider.js";
import { zohoError } from "../shared/errors.js";
import type { Channel, MessageStatus } from "../shared/status.js";
import type { NormalizedWebhookEvent } from "../shared/webhook.js";
import { maxWebhookBodyBytes } from "../shared/webhook.js";
import {
  emailBatchArgs,
  emailSendArgs,
  emailTemplateArgs,
  emailTemplateBatchArgs,
  smsTemplateArgs,
  whatsappTemplateArgs,
} from "../shared/validators.js";

export type { Channel, MessageStatus } from "../shared/status.js";
export type Message = Doc<"messages">;
export type MessageEvent = Doc<"events">;
export type Suppression = Doc<"suppressions">;
export type { EmailAddress, EmailAttachment, InlineImage, Region } from "../shared/provider.js";
export { regionValidator } from "../shared/provider.js";
export {
  emailAddressValidator,
  attachmentValidator,
  inlineImageValidator,
  statusValidator,
  channelValidator,
} from "../shared/validators.js";
export type { ZohoCpaasErrorCode, ZohoCpaasMessageErrorCode } from "../shared/errors.js";
export { normalizedWebhookEventValidator } from "../shared/webhook.js";

export type EmailSend = Omit<Infer<typeof emailSendArgs>, "from" | "testMode"> & {
  from?: EmailAddress;
};
export type EmailTemplateSend = Omit<Infer<typeof emailTemplateArgs>, "from" | "testMode"> & {
  from?: EmailAddress;
};
export type EmailBatchSend = Omit<Infer<typeof emailBatchArgs>, "from" | "testMode"> & {
  from?: EmailAddress;
};
export type EmailTemplateBatchSend = Omit<
  Infer<typeof emailTemplateBatchArgs>,
  "from" | "testMode"
> & { from?: EmailAddress };
export type SmsTemplateSend = Omit<Infer<typeof smsTemplateArgs>, "testMode">;
export type WhatsappTemplateSend = Omit<Infer<typeof whatsappTemplateArgs>, "testMode">;

export type QueryContext = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
export type MutationContext = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
export type ActionContext = Pick<GenericActionCtx<GenericDataModel>, "runAction">;
export type ZohoCpaasEventArgs = {
  event: NormalizedWebhookEvent;
  messageId?: string;
  ambiguous: boolean;
};

export { isZohoCpaasError } from "../shared/errors.js";

export type ZohoCpaasOptions = {
  testMode?: boolean;
  defaultFrom?: EmailAddress;
  onEvent?: FunctionReference_future<"mutation", "internal", ZohoCpaasEventArgs, null>;
};

export class ZohoCpaas {
  constructor(
    private readonly component: ComponentApi,
    private readonly options: ZohoCpaasOptions = {},
  ) {}

  private from(from: EmailAddress | undefined): EmailAddress {
    const address = from ?? this.options.defaultFrom;
    if (!address) throw zohoError("ZOHO_CPAAS_VALIDATION_FAILED");
    return { address: address.address, name: address.name };
  }

  readonly email = {
    send: (ctx: MutationContext, args: EmailSend) =>
      ctx.runMutation(this.component.messages.send, {
        from: this.from(args.from),
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        replyTo: args.replyTo,
        trackOpens: args.trackOpens,
        trackClicks: args.trackClicks,
        clientReference: args.clientReference,
        mimeHeaders: args.mimeHeaders,
        attachments: args.attachments,
        inlineImages: args.inlineImages,
        idempotencyKey: args.idempotencyKey,
        subject: args.subject,
        html: args.html,
        text: args.text,
        testMode: this.options.testMode,
      }),
    sendTemplate: (ctx: MutationContext, args: EmailTemplateSend) =>
      ctx.runMutation(this.component.messages.sendTemplate, {
        from: this.from(args.from),
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        replyTo: args.replyTo,
        trackOpens: args.trackOpens,
        trackClicks: args.trackClicks,
        clientReference: args.clientReference,
        mimeHeaders: args.mimeHeaders,
        attachments: args.attachments,
        inlineImages: args.inlineImages,
        idempotencyKey: args.idempotencyKey,
        templateKey: args.templateKey,
        templateAlias: args.templateAlias,
        mergeInfo: args.mergeInfo,
        testMode: this.options.testMode,
      }),
    sendBatch: (ctx: MutationContext, args: EmailBatchSend) =>
      ctx.runMutation(this.component.messages.sendBatch, {
        from: this.from(args.from),
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        replyTo: args.replyTo,
        trackOpens: args.trackOpens,
        trackClicks: args.trackClicks,
        clientReference: args.clientReference,
        mimeHeaders: args.mimeHeaders,
        attachments: args.attachments,
        inlineImages: args.inlineImages,
        idempotencyKey: args.idempotencyKey,
        subject: args.subject,
        html: args.html,
        text: args.text,
        mergeInfo: args.mergeInfo,
        testMode: this.options.testMode,
      }),
    sendTemplateBatch: (ctx: MutationContext, args: EmailTemplateBatchSend) =>
      ctx.runMutation(this.component.messages.sendTemplateBatch, {
        from: this.from(args.from),
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        replyTo: args.replyTo,
        trackOpens: args.trackOpens,
        trackClicks: args.trackClicks,
        clientReference: args.clientReference,
        mimeHeaders: args.mimeHeaders,
        attachments: args.attachments,
        inlineImages: args.inlineImages,
        idempotencyKey: args.idempotencyKey,
        templateKey: args.templateKey,
        templateAlias: args.templateAlias,
        mergeInfo: args.mergeInfo,
        testMode: this.options.testMode,
      }),
    uploadFile: (
      ctx: ActionContext,
      args: { name: string; mimeType: string; content: ArrayBuffer },
    ) =>
      ctx.runAction(this.component.files.uploadFile, {
        name: args.name,
        mimeType: args.mimeType,
        content: args.content,
        testMode: this.options.testMode,
      }),
  };

  readonly experimental = {
    whatsapp: {
      sendTemplate: (ctx: MutationContext, args: WhatsappTemplateSend) =>
        ctx.runMutation(this.component.messages.sendWhatsappTemplate, {
          from: args.from,
          to: args.to,
          agentId: args.agentId,
          templateKey: args.templateKey,
          templateAlias: args.templateAlias,
          mergeInfo: args.mergeInfo,
          clientReference: args.clientReference,
          idempotencyKey: args.idempotencyKey,
          testMode: this.options.testMode,
        }),
    },
    sms: {
      sendTemplate: (ctx: MutationContext, args: SmsTemplateSend) =>
        ctx.runMutation(this.component.messages.sendSmsTemplate, {
          senderKey: args.senderKey,
          to: args.to,
          templateKey: args.templateKey,
          templateAlias: args.templateAlias,
          mergeInfo: args.mergeInfo,
          clientReference: args.clientReference,
          idempotencyKey: args.idempotencyKey,
          testMode: this.options.testMode,
        }),
    },
  };

  readonly messages = {
    status: async (ctx: QueryContext) => {
      const status = await ctx.runQuery(this.component.messages.status, {});
      return { ...status, testMode: this.options.testMode === true || status.testMode };
    },
    get: (ctx: QueryContext, args: { messageId: string }) =>
      ctx.runQuery(this.component.messages.getMessage, { messageId: args.messageId }),
    list: (
      ctx: QueryContext,
      args: {
        recipient?: string;
        channel?: Channel;
        status?: MessageStatus;
        paginationOpts: PaginationOptions;
      },
    ) =>
      ctx.runQuery(this.component.messages.listMessages, {
        recipient: args.recipient,
        channel: args.channel,
        status: args.status,
        paginationOpts: pageArgs(args.paginationOpts),
      }),
    listEvents: (
      ctx: QueryContext,
      args: { messageId: string; paginationOpts: PaginationOptions },
    ) =>
      ctx.runQuery(this.component.messages.listEvents, {
        messageId: args.messageId,
        paginationOpts: pageArgs(args.paginationOpts),
      }),
    cancel: (ctx: MutationContext, args: { messageId: string }) =>
      ctx.runMutation(this.component.messages.cancel, { messageId: args.messageId }),
  };
  readonly suppressions = {
    list: (
      ctx: QueryContext,
      args: {
        channel: Channel;
        paginationOpts: PaginationOptions;
      },
    ) =>
      ctx.runQuery(this.component.suppressions.list, {
        channel: args.channel,
        paginationOpts: pageArgs(args.paginationOpts),
      }),
    remove: (ctx: MutationContext, args: { channel: Channel; address: string }) =>
      ctx.runMutation(this.component.suppressions.remove, {
        channel: args.channel,
        address: args.address,
      }),
  };

  registerRoutes(http: HttpRouter, options: { path?: `/${string}` } = {}) {
    registerRoutes(http, this.component, {
      ...options,
      ...(this.options.onEvent ? { onEvent: this.options.onEvent } : {}),
    });
  }
}

function pageArgs(options: PaginationOptions): PaginationOptions {
  return { numItems: options.numItems, cursor: options.cursor, endCursor: options.endCursor };
}

export function registerRoutes(
  http: HttpRouter,
  component: ComponentApi,
  options: {
    path?: `/${string}`;
    onEvent?: FunctionReference_future<"mutation", "internal", ZohoCpaasEventArgs, null>;
  } = {},
): void {
  http.route({
    path: options.path ?? "/zoho-cpaas/webhook",
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      const rawBody = await readBoundedBody(request, maxWebhookBodyBytes);
      if (rawBody === null) return new Response("Webhook body exceeds limit", { status: 413 });
      if (rawBody === undefined)
        return new Response("Webhook body is undecodable", { status: 400 });
      const callbackHandle = options.onEvent
        ? await createFunctionHandle(options.onEvent)
        : undefined;
      let response;
      try {
        response = await ctx.runAction(component.webhooks.receive, {
          rawBody,
          contentType: request.headers.get("content-type") ?? "",
          signature: request.headers.get("producer-signature") ?? undefined,
          callbackHandle,
        });
      } catch {
        return new Response("Webhook processing failed", { status: 500 });
      }
      if (response.reason === "missing_secret")
        return new Response("Webhook secret is not configured", { status: 500 });
      if (response.reason === "oversized_body")
        return new Response("Webhook body exceeds limit", { status: 413 });
      if (response.reason === "invalid_signature")
        return new Response("Invalid webhook signature", { status: 401 });
      return new Response(response.duplicate ? "Duplicate" : "OK", { status: 200 });
    }),
  });
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<string | null | undefined> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) return undefined;
    if (Number(declared) > maxBytes) return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- sequential reads enforce the byte limit
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // oxlint-disable-next-line no-await-in-loop -- cancel the active reader before returning
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
