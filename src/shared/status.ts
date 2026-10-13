import type { Infer } from "convex/values";
import { channelValidator, statusValidator } from "./validators.js";

/** A Zoho communication channel supported by this component. */
export type Channel = Infer<typeof channelValidator>;
/** The stored lifecycle state of an outbound message. */
export type MessageStatus = Infer<typeof statusValidator>;

const rank: Partial<Record<MessageStatus, number>> = {
  queued: 0,
  sending: 1,
  unknown: 1,
  accepted: 2,
  delivered: 3,
  read: 4,
};

const terminal = new Set<MessageStatus>([
  "read",
  "failed",
  "bounced",
  "complained",
  "suppressed",
  "canceled",
]);

export function canTransitionStatus(
  current: MessageStatus,
  next: MessageStatus,
  channel: Channel,
): boolean {
  if (current === next) return false;
  if (terminal.has(current)) return false;
  if (next === "canceled" || next === "suppressed") return current === "queued";
  if (next === "bounced" || next === "complained") return channel === "email";
  if (next === "unknown") return current === "sending" || current === "queued";
  if (next === "failed")
    return (
      current === "queued" ||
      current === "sending" ||
      current === "accepted" ||
      current === "unknown"
    );
  if (channel === "email" && (next === "delivered" || next === "read")) return false;
  if (channel === "sms" && next === "read") return false;
  return (rank[next] ?? -1) > (rank[current] ?? -1);
}
