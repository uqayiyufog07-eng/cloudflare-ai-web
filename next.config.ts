import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// Makes Cloudflare bindings (including the D1 `DB` binding) available to
// `next dev` via getPlatformProxy. next.config never enters the worker bundle,
// so this does not run in wrangler dev / production.
initOpenNextCloudflareForDev();

export function createNextConfig(isVercel: boolean): NextConfig {
  return {
    // Vercel's adapter assembles the deployment output itself. Combining it
    // with standalone output triggers Next.js issue #96646 during NFT tracing.
    output: isVercel ? undefined : "standalone",
    typedRoutes: true,
    // Stop `next dev` from writing its agent rules into AGENTS.md / CLAUDE.md.
    agentRules: false,
    reactCompiler: true,
    experimental: {
      typedEnv: true,
    },
  };
}

export default createNextConfig(process.env.VERCEL === "1");
