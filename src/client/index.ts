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
import { readBoundedText } from "../shared/bounds.js";
import { zohoCpaasError } from "../shared/errors.js";
import type { Channel, MessageStatus } from "../shared/status.js";
import type { NormalizedWebhookEvent } from "../shared/webhook.js";
import { maxWebhookBodyBytes } from "../shared/webhook.js";
import {
  emailBatchArgsValidator,
  emailSendArgsValidator,
  emailTemplateArgsValidator,
  emailTemplateBatchArgsValidator,
  smsTemplateArgsValidator,
  whatsappTemplateArgsValidator,
} from "../shared/validators.js";

export type { Channel, MessageStatus } from "../shared/status.js";
/** A stored outbound message with its delivery state and Zoho identifiers. */
export type Message = Doc<"messages">;
/** A stored event received from Zoho for an outbound message. */
export type MessageEvent = Doc<"events">;
/** A persistent channel address excluded from future sends. */
export type Suppression = Doc<"suppressions">;
export type { EmailAddress, EmailAttachment, InlineImage, Region } from "../shared/provider.js";
export { regionValidator } from "../shared/provider.js";
export {
  emailAddressValidator,
  attachmentValidator,
  inlineImageValidator,
  statusValidator,
  channelValidator,
  configurationValidator,
} from "../shared/validators.js";
export type { ZohoCpaasErrorCode, ZohoCpaasErrorData } from "../shared/errors.js";
export type { NormalizedWebhookEvent, WebhookEventType } from "../shared/webhook.js";
export { normalizedWebhookEventValidator } from "../shared/webhook.js";

/** Arguments for an inline transactional email. */
export type EmailSend = Omit<Infer<typeof emailSendArgsValidator>, "from" | "testMode"> & {
  from?: EmailAddress;
};
/** Arguments for an email using a pre-created Zoho template. */
export type EmailTemplateSend = Omit<
  Infer<typeof emailTemplateArgsValidator>,
  "from" | "testMode"
> & {
  from?: EmailAddress;
};
/** Arguments for one email batch with recipient merge values. */
export type EmailBatchSend = Omit<Infer<typeof emailBatchArgsValidator>, "from" | "testMode"> & {
  from?: EmailAddress;
};
/** Arguments for one template email batch with recipient merge values. */
export type EmailTemplateBatchSend = Omit<
  Infer<typeof emailTemplateBatchArgsValidator>,
  "from" | "testMode"
> & { from?: EmailAddress };
/** Arguments for an experimental India DLT template SMS. */
export type SmsTemplateSend = Omit<Infer<typeof smsTemplateArgsValidator>, "testMode">;
/** Arguments for an experimental pre-approved WhatsApp template message. */
export type WhatsappTemplateSend = Omit<Infer<typeof whatsappTemplateArgsValidator>, "testMode">;

// shared-block:begin
/** Runs component queries; app queries, mutations and actions provide it. */
export type QueryContext = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
/** Runs component mutations; app mutations and actions provide it. */
export type MutationContext = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
/** Runs component actions; app actions provide it. */
export type ActionContext = Pick<GenericActionCtx<GenericDataModel>, "runAction">;
// shared-block:end
/** A verified Zoho event and its message correlation passed to the internal callback. */
export type ZohoCpaasEventArgs = {
  event: NormalizedWebhookEvent;
  messageId?: string;
  ambiguous: boolean;
};

export { ZOHO_CPAAS_ERROR_CODES, isZohoCpaasError } from "../shared/errors.js";

/** Sender, simulation and verified-event callback options for the Zoho CPaaS client. */
export type ZohoCpaasOptions = {
  testMode?: boolean;
  defaultFrom?: EmailAddress;
  onEvent?: FunctionReference_future<"mutation", "internal", ZohoCpaasEventArgs, null>;
};

/** A Convex client for Zoho messaging, stored messages, suppressions and file caches. */
export class ZohoCpaas {
  /** Create a Zoho CPaaS client with optional sender, simulation and event callback settings. */
  constructor(
    private readonly component: ComponentApi,
    private readonly options: ZohoCpaasOptions = {},
  ) {}

  /** Sends ZeptoMail emails and template emails, singly or in batches. */
  readonly email = {
    /** Enqueue an inline transactional email for each requested recipient. */
    send: (ctx: MutationContext, args: EmailSend) =>
      ctx.runMutation(this.component.email.send, {
        from: resolveEmailFrom(args.from, this.options.defaultFrom),
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
        htmlbody: args.htmlbody,
        textbody: args.textbody,
        testMode: this.options.testMode,
      }),
    /** Enqueue an email using a pre-created Zoho template. */
    sendTemplate: (ctx: MutationContext, args: EmailTemplateSend) =>
      ctx.runMutation(this.component.email.sendTemplate, {
        from: resolveEmailFrom(args.from, this.options.defaultFrom),
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
    /** Enqueue one email batch with recipient merge values. */
    sendBatch: (ctx: MutationContext, args: EmailBatchSend) =>
      ctx.runMutation(this.component.email.sendBatch, {
        from: resolveEmailFrom(args.from, this.options.defaultFrom),
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
        htmlbody: args.htmlbody,
        textbody: args.textbody,
        mergeInfo: args.mergeInfo,
        testMode: this.options.testMode,
      }),
    /** Enqueue one template email batch with recipient merge values. */
    sendTemplateBatch: (ctx: MutationContext, args: EmailTemplateBatchSend) =>
      ctx.runMutation(this.component.email.sendTemplateBatch, {
        from: resolveEmailFrom(args.from, this.options.defaultFrom),
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
  };

  /** Uploads ZeptoMail file attachments. */
  readonly files = {
    /** Upload binary email media and return its Zoho file-cache key. */
    upload: (ctx: ActionContext, args: { name: string; mimeType: string; content: ArrayBuffer }) =>
      ctx.runAction(this.component.files.upload, {
        name: args.name,
        mimeType: args.mimeType,
        content: args.content,
        testMode: this.options.testMode,
      }),
  };

  /** Sends WhatsApp template messages. */
  readonly whatsapp = {
    /** Enqueue an experimental pre-approved WhatsApp template message. */
    sendTemplate: (ctx: MutationContext, args: WhatsappTemplateSend) =>
      ctx.runMutation(this.component.whatsapp.sendTemplate, {
        from: args.from,
        to: args.to,
        zohoAgentId: args.zohoAgentId,
        templateKey: args.templateKey,
        templateAlias: args.templateAlias,
        mergeInfo: args.mergeInfo,
        clientReference: args.clientReference,
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      }),
  };

  /** Sends SMS template messages. */
  readonly sms = {
    /** Enqueue an experimental India DLT template SMS. */
    sendTemplate: (ctx: MutationContext, args: SmsTemplateSend) =>
      ctx.runMutation(this.component.sms.sendTemplate, {
        senderKey: args.senderKey,
        to: args.to,
        templateKey: args.templateKey,
        templateAlias: args.templateAlias,
        mergeInfo: args.mergeInfo,
        clientReference: args.clientReference,
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      }),
  };

  /** Reads the component configuration with secrets omitted. */
  readonly config = {
    /** Read whether each channel has a credential, whether test mode is active, and the provider region. */
    get: async (ctx: QueryContext) => {
      const status = await ctx.runQuery(this.component.config.get, {});
      return { ...status, testMode: this.options.testMode === true || status.testMode };
    },
  };

  /** Reads, lists and cancels sent messages and lists their delivery events. */
  readonly messages = {
    /** Read a stored message by its component message ID. */
    get: (ctx: QueryContext, args: { messageId: string }) =>
      ctx.runQuery(this.component.messages.get, { messageId: args.messageId }),
    /** Read a bounded page of stored messages matching the supplied filters. */
    list: (
      ctx: QueryContext,
      args: {
        recipient?: string;
        channel?: Channel;
        status?: MessageStatus;
        paginationOpts: PaginationOptions;
      },
    ) =>
      ctx.runQuery(this.component.messages.list, {
        recipient: args.recipient,
        channel: args.channel,
        status: args.status,
        paginationOpts: pageArgs(args.paginationOpts),
      }),
    /** Read a bounded page of events for a stored message. */
    listEvents: (
      ctx: QueryContext,
      args: { messageId: string; paginationOpts: PaginationOptions },
    ) =>
      ctx.runQuery(this.component.messages.listEvents, {
        messageId: args.messageId,
        paginationOpts: pageArgs(args.paginationOpts),
      }),
    /** Stop pending attempts for a stored message. */
    cancel: (ctx: MutationContext, args: { messageId: string }) =>
      ctx.runMutation(this.component.messages.cancel, { messageId: args.messageId }),
  };
  /** Lists and removes suppressed recipients. */
  readonly suppressions = {
    /** Read a bounded page of persistent suppressions for a channel in the client's test mode. */
    list: (
      ctx: QueryContext,
      args: {
        channel: Channel;
        paginationOpts: PaginationOptions;
      },
    ) =>
      ctx.runQuery(this.component.suppressions.list, {
        channel: args.channel,
        testMode: this.options.testMode,
        paginationOpts: pageArgs(args.paginationOpts),
      }),
    /** Remove a persistent suppression for the normalized channel address in the client's test mode. */
    remove: (ctx: MutationContext, args: { channel: Channel; address: string }) =>
      ctx.runMutation(this.component.suppressions.remove, {
        channel: args.channel,
        testMode: this.options.testMode,
        address: args.address,
      }),
  };

  /** Register the signed Zoho webhook route with the client event callback. */
  registerRoutes(http: HttpRouter, options: { path?: `/${string}` } = {}): void {
    const { component } = this;
    const { onEvent } = this.options;
    http.route({
      path: options.path ?? "/zoho-cpaas/webhook",
      method: "POST",
      handler: httpActionGeneric(async (ctx, request) => {
        const rawBody = await readBoundedText(request, maxWebhookBodyBytes);
        if (rawBody === undefined)
          return new Response("Webhook body exceeds limit or is not UTF-8", { status: 400 });
        const callbackHandle = onEvent ? await createFunctionHandle(onEvent) : undefined;
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
          return new Response("Webhook body exceeds limit", { status: 400 });
        if (response.reason === "invalid_signature")
          return Response.json(zohoCpaasError("ZOHO_CPAAS_INVALID_WEBHOOK_SIGNATURE").data, {
            status: 401,
          });
        return new Response(response.reason === "duplicate" ? "Duplicate" : "OK", { status: 200 });
      }),
    });
  }
}

/** Resolve the email sender from the send arguments or the client default. */
export function resolveEmailFrom(
  from: EmailAddress | undefined,
  defaultFrom: EmailAddress | undefined,
): EmailAddress {
  const address = from ?? defaultFrom;
  if (!address) throw zohoCpaasError("ZOHO_CPAAS_INVALID_ARGUMENT");
  return { address: address.address, name: address.name };
}

function pageArgs(options: PaginationOptions): PaginationOptions {
  return { numItems: options.numItems, cursor: options.cursor, endCursor: options.endCursor };
}
