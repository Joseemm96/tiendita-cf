import astroWorker from "@astrojs/cloudflare/entrypoints/server";
import { isGoogleSheetsConfigured, syncInventoryToGoogleSheets } from "./lib/google-sheets";

export default {
  fetch: astroWorker.fetch,
  async scheduled(_controller, env, context) {
    if (!isGoogleSheetsConfigured(env)) return;
    context.waitUntil(syncInventoryToGoogleSheets(env.DB, env, "cron"));
  },
} satisfies ExportedHandler<CloudflareEnv>;
