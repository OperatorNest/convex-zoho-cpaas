import workpool from "@convex-dev/workpool/convex.config.js";
import { defineComponent } from "convex/server";
import { v } from "convex/values";
import { regionValidator } from "../shared/provider.js";

const component = defineComponent("zohoCpaas", {
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

component.use(workpool);
export default component;
