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
    email: {
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
          htmlbody?: string;
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
          textbody?: string;
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
          htmlbody?: string;
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
          textbody?: string;
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
    };
    files: {
      upload: FunctionReference<
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
      get: FunctionReference<
        "query",
        "internal",
        { messageId: string },
        {
          _creationTime: number;
          _id: string;
          attempts: number;
          canceledAt?: number;
          channel: "email" | "sms" | "whatsapp";
          clientReference: string;
          createdAt: number;
          error?: {
            code:
              | "ZOHO_CPAAS_IDEMPOTENCY_CONFLICT"
              | "ZOHO_CPAAS_ALL_SUPPRESSED"
              | "ZOHO_CPAAS_INVALID_ARGUMENT"
              | "ZOHO_CPAAS_NOT_FOUND"
              | "ZOHO_CPAAS_INVALID_WEBHOOK_SIGNATURE"
              | "ZOHO_CPAAS_NOT_CONFIGURED"
              | "ZOHO_CPAAS_UNSUPPORTED_REGION"
              | "ZOHO_CPAAS_PROVIDER_ERROR"
              | "ZOHO_CPAAS_NETWORK_ERROR"
              | "ZOHO_CPAAS_WORKPOOL_ACTION_FAILED"
              | "ZOHO_CPAAS_RETRY_AFTER_TOO_LONG"
              | "ZOHO_CPAAS_STUCK"
              | "ZOHO_CPAAS_INVALID_RESPONSE";
            message: string;
            providerCode?: string;
            providerStatus?: number;
            retryable?: boolean;
          };
          failureDefinitive?: boolean;
          from: string;
          jobId?: string;
          region: string;
          sendingAt?: number;
          sentAt?: number;
          status:
            | "queued"
            | "sending"
            | "accepted"
            | "unknown"
            | "delivered"
            | "read"
            | "failed"
            | "bounced"
            | "complained"
            | "suppressed"
            | "canceled";
          terminalAt?: number;
          testMode: boolean;
          to: string;
          warning?: string;
          zohoMessageId?: string;
          zohoRequestId?: string;
        },
        Name
      >;
      getConfig: FunctionReference<
        "query",
        "internal",
        {},
        { configured: boolean; region: string; testMode: boolean },
        Name
      >;
      list: FunctionReference<
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
            | "unknown"
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
            canceledAt?: number;
            channel: "email" | "sms" | "whatsapp";
            clientReference: string;
            createdAt: number;
            error?: {
              code:
                | "ZOHO_CPAAS_IDEMPOTENCY_CONFLICT"
                | "ZOHO_CPAAS_ALL_SUPPRESSED"
                | "ZOHO_CPAAS_INVALID_ARGUMENT"
                | "ZOHO_CPAAS_NOT_FOUND"
                | "ZOHO_CPAAS_INVALID_WEBHOOK_SIGNATURE"
                | "ZOHO_CPAAS_NOT_CONFIGURED"
                | "ZOHO_CPAAS_UNSUPPORTED_REGION"
                | "ZOHO_CPAAS_PROVIDER_ERROR"
                | "ZOHO_CPAAS_NETWORK_ERROR"
                | "ZOHO_CPAAS_WORKPOOL_ACTION_FAILED"
                | "ZOHO_CPAAS_RETRY_AFTER_TOO_LONG"
                | "ZOHO_CPAAS_STUCK"
                | "ZOHO_CPAAS_INVALID_RESPONSE";
              message: string;
              providerCode?: string;
              providerStatus?: number;
              retryable?: boolean;
            };
            failureDefinitive?: boolean;
            from: string;
            jobId?: string;
            region: string;
            sendingAt?: number;
            sentAt?: number;
            status:
              | "queued"
              | "sending"
              | "accepted"
              | "unknown"
              | "delivered"
              | "read"
              | "failed"
              | "bounced"
              | "complained"
              | "suppressed"
              | "canceled";
            terminalAt?: number;
            testMode: boolean;
            to: string;
            warning?: string;
            zohoMessageId?: string;
            zohoRequestId?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
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
            raw: string;
            receivedAt: number;
            recipient?: string;
            testMode: boolean;
            type: string;
            zohoEventId: string;
            zohoMessageId?: string;
            zohoRequestId?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
    };
    sms: {
      sendTemplate: FunctionReference<
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
            testMode: boolean;
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
    whatsapp: {
      sendTemplate: FunctionReference<
        "mutation",
        "internal",
        {
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
          zohoAgentId?: string;
        },
        string,
        Name
      >;
    };
  };
