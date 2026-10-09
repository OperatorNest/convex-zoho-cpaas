import { registerRoutes } from "@operatornest/convex-zoho-cpaas";
import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api.js";
import { e2eWebhook } from "./e2eWebhook.js";

const http = httpRouter();
registerRoutes(http, components.zohoCpaas, { onEvent: internal.webhookEvents.record });
http.route({ path: "/zoho-cpaas/e2e-webhook", method: "POST", handler: e2eWebhook });
export default http;
