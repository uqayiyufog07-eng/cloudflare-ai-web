// OpenNext Cloudflare adapter config.
// This app is fully dynamic (chat + API routes), so no incremental cache
// (ISR/SSG) is needed; the default no-op cache avoids extra resource bindings.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
