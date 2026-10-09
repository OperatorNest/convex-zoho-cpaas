import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api.js";

// One pool configuration is shared by enqueues, retries, and cancellation.
export const pool = new Workpool(components.workpool, { maxParallelism: 10 });
