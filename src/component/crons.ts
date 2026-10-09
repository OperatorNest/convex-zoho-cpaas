import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();
crons.interval("Zoho CPaaS retention", { hours: 24 }, internal.cleanup.run, {});
export default crons;
