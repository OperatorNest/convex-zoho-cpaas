import type { Infer } from "convex/values";
import { channelValidator, statusValidator } from "./validators.js";

export type Channel = Infer<typeof channelValidator>;
export type MessageStatus = Infer<typeof statusValidator>;

const rank: Partial<Record<MessageStatus, number>> = {
  queued: 0,
  sending: 1,
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
  if (next === "failed") return true;
  if (channel === "email" && (next === "delivered" || next === "read")) return false;
  if (channel === "sms" && next === "read") return false;
  return (rank[next] ?? -1) > (rank[current] ?? -1);
}
