import { defineApp } from "convex/server";
import { v } from "convex/values";
import zohoCpaas from "@operatornest/convex-zoho-cpaas/convex.config.js";
import { regionValidator } from "@operatornest/convex-zoho-cpaas";

const app = defineApp({
  env: {
    ZOHO_CPAAS_REGION: v.optional(regionValidator),
    ZOHO_CPAAS_BASE_URL: v.optional(v.string()),
    ZOHO_CPAAS_TOKEN: v.optional(v.string()),
    ZOHO_CPAAS_EMAIL_TOKEN: v.optional(v.string()),
    ZOHO_CPAAS_SMS_TOKEN: v.optional(v.string()),
    ZOHO_CPAAS_WHATSAPP_TOKEN: v.optional(v.string()),
    ZOHO_CPAAS_WEBHOOK_SECRET: v.optional(v.string()),
    ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS: v.optional(v.string()),
    ZOHO_CPAAS_RETENTION_DAYS: v.optional(v.string()),
    ZOHO_CPAAS_TEST_MODE: v.optional(v.string()),
  },
});

app.use(zohoCpaas, {
  env: {
    ZOHO_CPAAS_REGION: app.env.ZOHO_CPAAS_REGION,
    ZOHO_CPAAS_BASE_URL: app.env.ZOHO_CPAAS_BASE_URL,
    ZOHO_CPAAS_TOKEN: app.env.ZOHO_CPAAS_TOKEN,
    ZOHO_CPAAS_EMAIL_TOKEN: app.env.ZOHO_CPAAS_EMAIL_TOKEN,
    ZOHO_CPAAS_SMS_TOKEN: app.env.ZOHO_CPAAS_SMS_TOKEN,
    ZOHO_CPAAS_WHATSAPP_TOKEN: app.env.ZOHO_CPAAS_WHATSAPP_TOKEN,
    ZOHO_CPAAS_WEBHOOK_SECRET: app.env.ZOHO_CPAAS_WEBHOOK_SECRET,
    ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS: app.env.ZOHO_CPAAS_WEBHOOK_SECRET_PREVIOUS,
    ZOHO_CPAAS_RETENTION_DAYS: app.env.ZOHO_CPAAS_RETENTION_DAYS,
    ZOHO_CPAAS_TEST_MODE: app.env.ZOHO_CPAAS_TEST_MODE,
  },
});

export default app;
