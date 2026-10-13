import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api.js";

export const pool = new Workpool(components.workpool, { maxParallelism: 10 });
