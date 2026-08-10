import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const testSecrets = {
  MCP_AUTH_TOKEN: "test-token-with-at-least-thirty-two-chars",
  ADMIN_TOKEN: "different-admin-token-with-at-least-32-chars",
  DATA_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  SPLIIT_GROUPS_JSON: JSON.stringify([
    {
      alias: "holiday",
      url: "https://spliit.test/groups/group-secret",
      participantId: "p1"
    }
  ])
};

Object.assign(process.env, testSecrets);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ...testSecrets,
          ALLOWED_SPLIIT_HOSTNAMES: "spliit.test",
        }
      }
    })
  ]
});
