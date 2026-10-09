/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    files: {
      uploadFile: FunctionReference<
        "action",
        "internal",
        {
          content: ArrayBuffer;
          mimeType: string;
          name: string;
          testMode?: boolean;
        },
        string,
        Name
      >;
    };
    messages: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { messageId: string },
        boolean,
        Name
      >;
      getMessage: FunctionReference<
        "query",
        "internal",
        { messageId: string },
        {
          _creationTime: number;
          _id: string;
          attempts: number;
          channel: "email" | "sms" | "whatsapp";
          clientReference: string;
          createdAt: number;
          error?: {
            class: "retryable" | "permanent" | "account-state";
            code?: string;
            message: string;
            retryable: boolean;
            subCode?: string;
          };
          failureDefinitive?: boolean;
          from: string;
          jobId?: string;
          providerMessageId?: string;
          providerRequestId?: string;
          region: string;
          sendingAt?: number;
          sentAt?: number;
          status:
            | "queued"
            | "sending"
            | "accepted"
            | "delivered"
            | "read"
            | "failed"
            | "bounced"
            | "complained"
            | "suppressed"
            | "canceled";
          terminalAt?: number;
          testMode?: boolean;
          to: string;
          warning?: string;
        } | null,
        Name
      >;
      listEvents: FunctionReference<
        "query",
        "internal",
        {
          messageId: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            ambiguous?: boolean;
            channel: "email" | "sms" | "whatsapp" | "unknown";
            clientReference?: string;
            messageId?: string;
            occurredAt: number;
            providerEventId: string;
            providerMessageId?: string;
            providerRequestId?: string;
            raw: string;
            receivedAt: number;
            recipient?: string;
            testMode?: boolean;
            type: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      listMessages: FunctionReference<
        "query",
        "internal",
        {
          channel?: "email" | "sms" | "whatsapp";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          recipient?: string;
          status?:
            | "queued"
            | "sending"
            | "accepted"
            | "delivered"
            | "read"
            | "failed"
            | "bounced"
            | "complained"
            | "suppressed"
            | "canceled";
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            attempts: number;
            channel: "email" | "sms" | "whatsapp";
            clientReference: string;
            createdAt: number;
            error?: {
              class: "retryable" | "permanent" | "account-state";
              code?: string;
              message: string;
              retryable: boolean;
              subCode?: string;
            };
            failureDefinitive?: boolean;
            from: string;
            jobId?: string;
            providerMessageId?: string;
            providerRequestId?: string;
            region: string;
            sendingAt?: number;
            sentAt?: number;
            status:
              | "queued"
              | "sending"
              | "accepted"
              | "delivered"
              | "read"
              | "failed"
              | "bounced"
              | "complained"
              | "suppressed"
              | "canceled";
            terminalAt?: number;
            testMode?: boolean;
            to: string;
            warning?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      send: FunctionReference<
        "mutation",
        "internal",
        {
          attachments?: Array<{
            content?: string;
            fileCacheKey?: string;
            mimeType?: string;
            name: string;
          }>;
          bcc?: Array<{ address: string; name?: string }>;
          cc?: Array<{ address: string; name?: string }>;
          clientReference?: string;
          from: { address: string; name?: string };
          html?: string;
          idempotencyKey?: string;
          inlineImages?: Array<{
            cid: string;
            content?: string;
            fileCacheKey?: string;
            mimeType?: string;
          }>;
          mimeHeaders?: Record<string, string>;
          replyTo?: Array<{ address: string; name?: string }>;
          subject: string;
          testMode?: boolean;
          text?: string;
          to: Array<{ address: string; name?: string }>;
          trackClicks?: boolean;
          trackOpens?: boolean;
        },
        Array<string>,
        Name
      >;
      sendBatch: FunctionReference<
        "mutation",
        "internal",
        {
          attachments?: Array<{
            content?: string;
            fileCacheKey?: string;
            mimeType?: string;
            name: string;
          }>;
          bcc?: Array<{ address: string; name?: string }>;
          cc?: Array<{ address: string; name?: string }>;
          clientReference?: string;
          from: { address: string; name?: string };
          html?: string;
          idempotencyKey?: string;
          inlineImages?: Array<{
            cid: string;
            content?: string;
            fileCacheKey?: string;
            mimeType?: string;
          }>;
          mergeInfo?: Record<string, string>;
          mimeHeaders?: Record<string, string>;
          replyTo?: Array<{ address: string; name?: string }>;
          subject: string;
          testMode?: boolean;
          text?: string;
          to: Array<{
            emailAddress: { address: string; name?: string };
            mergeInfo?: Record<string, string>;
          }>;
          trackClicks?: boolean;
          trackOpens?: boolean;
        },
        Array<string>,
        Name
      >;
      sendSmsTemplate: FunctionReference<
        "mutation",
        "internal",
        {
          clientReference?: string;
          idempotencyKey?: string;
          mergeInfo?: Record<
            string,
            | string
            | number
            | boolean
            | null
            | Array<
                | string
                | number
                | boolean
                | null
                | Array<
                    | string
                    | number
                    | boolean
                    | null
                    | Array<string | number | boolean | null>
                    | Record<string, string | number | boolean | null>
                  >
                | Record<
                    string,
                    | string
                    | number
                    | boolean
                    | null
                    | Array<string | number | boolean | null>
                    | Record<string, string | number | boolean | null>
                  >
              >
            | Record<
                string,
                | string
                | number
                | boolean
                | null
                | Array<
                    | string
                    | number
                    | boolean
                    | null
                    | Array<string | number | boolean | null>
                    | Record<string, string | number | boolean | null>
                  >
                | Record<
                    string,
                    | string
                    | number
                    | boolean
                    | null
                    | Array<string | number | boolean | null>
                    | Record<string, string | number | boolean | null>
                  >
              >
          >;
          senderKey: string;
          templateAlias?: string;
          templateKey?: string;
          testMode?: boolean;
          to: string;
        },
        string,
        Name
      >;
      sendTemplate: FunctionReference<
        "mutation",
        "internal",
        {
          attachments?: Array<{
            content?: string;
            fileCacheKey?: string;
            mimeType?: string;
            name: string;
          }>;
          bcc?: Array<{ address: string; name?: string }>;
          cc?: Array<{ address: string; name?: string }>;
          clientReference?: string;
          from: { address: string; name?: string };
          idempotencyKey?: string;
          inlineImages?: Array<{
            cid: string;
            content?: string;
            fileCacheKey?: string;
            mimeType?: string;
          }>;
          mergeInfo?: Record<string, string>;
          mimeHeaders?: Record<string, string>;
          replyTo?: Array<{ address: string; name?: string }>;
          templateAlias?: string;
          templateKey?: string;
          testMode?: boolean;
          to: Array<{ address: string; name?: string }>;
          trackClicks?: boolean;
          trackOpens?: boolean;
        },
        Array<string>,
        Name
      >;
      sendTemplateBatch: FunctionReference<
        "mutation",
        "internal",
        {
          attachments?: Array<{
            content?: string;
            fileCacheKey?: string;
            mimeType?: string;
            name: string;
          }>;
          bcc?: Array<{ address: string; name?: string }>;
          cc?: Array<{ address: string; name?: string }>;
          clientReference?: string;
          from: { address: string; name?: string };
          idempotencyKey?: string;
          inlineImages?: Array<{
            cid: string;
            content?: string;
            fileCacheKey?: string;
            mimeType?: string;
          }>;
          mergeInfo?: Record<string, string>;
          mimeHeaders?: Record<string, string>;
          replyTo?: Array<{ address: string; name?: string }>;
          templateAlias?: string;
          templateKey?: string;
          testMode?: boolean;
          to: Array<{
            emailAddress: { address: string; name?: string };
            mergeInfo?: Record<string, string>;
          }>;
          trackClicks?: boolean;
          trackOpens?: boolean;
        },
        Array<string>,
        Name
      >;
      sendWhatsappTemplate: FunctionReference<
        "mutation",
        "internal",
        {
          agentId?: string;
          clientReference?: string;
          from: string;
          idempotencyKey?: string;
          mergeInfo?: Record<
            string,
            | string
            | number
            | boolean
            | null
            | Array<
                | string
                | number
                | boolean
                | null
                | Array<
                    | string
                    | number
                    | boolean
                    | null
                    | Array<string | number | boolean | null>
                    | Record<string, string | number | boolean | null>
                  >
                | Record<
                    string,
                    | string
                    | number
                    | boolean
                    | null
                    | Array<string | number | boolean | null>
                    | Record<string, string | number | boolean | null>
                  >
              >
            | Record<
                string,
                | string
                | number
                | boolean
                | null
                | Array<
                    | string
                    | number
                    | boolean
                    | null
                    | Array<string | number | boolean | null>
                    | Record<string, string | number | boolean | null>
                  >
                | Record<
                    string,
                    | string
                    | number
                    | boolean
                    | null
                    | Array<string | number | boolean | null>
                    | Record<string, string | number | boolean | null>
                  >
              >
          >;
          templateAlias?: string;
          templateKey?: string;
          testMode?: boolean;
          to: string;
        },
        string,
        Name
      >;
      status: FunctionReference<
        "query",
        "internal",
        {},
        { configured: boolean; region: string; testMode: boolean },
        Name
      >;
    };
    suppressions: {
      list: FunctionReference<
        "query",
        "internal",
        {
          channel: "email" | "sms" | "whatsapp";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            address: string;
            channel: "email" | "sms" | "whatsapp";
            createdAt: number;
            reason: string;
            sourceMessageId?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { address: string; channel: "email" | "sms" | "whatsapp" },
        boolean,
        Name
      >;
    };
    webhooks: {
      receive: FunctionReference<
        "action",
        "internal",
        {
          callbackHandle?: string;
          contentType: string;
          rawBody: string;
          signature?: string;
        },
        {
          duplicate: boolean;
          reason:
            | "accepted"
            | "duplicate"
            | "invalid_signature"
            | "missing_secret"
            | "oversized_body"
            | "invalid_payload";
        },
        Name
      >;
    };
  };
