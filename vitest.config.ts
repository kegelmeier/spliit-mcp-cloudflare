import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          MCP_AUTH_TOKEN: "test-token-with-at-least-thirty-two-chars",
          SPLIIT_GROUPS_JSON: JSON.stringify([
            {
              alias: "holiday",
              url: "https://spliit.test/groups/group-secret",
              participantId: "p1"
            }
          ])
        }
      }
    })
  ]
});
