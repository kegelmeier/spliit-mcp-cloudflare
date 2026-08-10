import { createMcpHandler } from "agents/mcp/server";

import { isAuthorized, unauthorizedResponse } from "./auth";
import { parseConfiguredGroups } from "./config";
import { createSpliitMcpServer } from "./tools";

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8"
} as const;

export default {
  async fetch(request, env, context): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json(
        {
          name: "spliit-mcp-cloudflare",
          version: "0.1.0",
          mcpEndpoint: "/mcp",
          authentication: "Bearer token required",
          writesEnabled: parseBoolean(env.WRITES_ENABLED)
        },
        { headers: JSON_HEADERS }
      );
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      return healthResponse(env);
    }

    if (url.pathname !== "/mcp") {
      return Response.json(
        { error: "Not found" },
        { status: 404, headers: JSON_HEADERS }
      );
    }

    if (!(await isAuthorized(request, env.MCP_AUTH_TOKEN))) {
      return unauthorizedResponse();
    }

    try {
      const groups = parseConfiguredGroups(env.SPLIIT_GROUPS_JSON);
      const timeoutMs = parseTimeout(env.SPLIIT_TIMEOUT_MS);
      const allowedHostnames = parseAllowedHostnames(env.ALLOWED_HOSTNAMES);
      const handler = createMcpHandler(
        () =>
          createSpliitMcpServer({
            groups,
            timeoutMs,
            writesEnabled: parseBoolean(env.WRITES_ENABLED)
          }),
        {
          route: "/mcp",
          corsOptions: false,
          ...(allowedHostnames.length === 0 ? {} : { allowedHostnames })
        }
      );
      return handler(request, env, context);
    } catch {
      console.error(
        JSON.stringify({
          event: "mcp_configuration_error",
          message: "The MCP request could not be initialized"
        })
      );
      return Response.json(
        { error: "Server configuration is invalid" },
        { status: 503, headers: JSON_HEADERS }
      );
    }
  }
} satisfies ExportedHandler<Env>;

function healthResponse(env: Env): Response {
  try {
    if (env.MCP_AUTH_TOKEN.length < 32) throw new Error("token too short");
    parseConfiguredGroups(env.SPLIIT_GROUPS_JSON);
    parseTimeout(env.SPLIIT_TIMEOUT_MS);
    parseAllowedHostnames(env.ALLOWED_HOSTNAMES);
    return Response.json({ status: "ok" }, { headers: JSON_HEADERS });
  } catch {
    return Response.json(
      { status: "unhealthy" },
      { status: 503, headers: JSON_HEADERS }
    );
  }
}

function parseBoolean(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

function parseTimeout(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 30_000) {
    throw new Error("SPLIIT_TIMEOUT_MS must be between 1000 and 30000");
  }
  return parsed;
}

function parseAllowedHostnames(value: string): string[] {
  const hostnames = value
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter((hostname) => hostname !== "");
  for (const hostname of hostnames) {
    if (
      hostname.includes(":") ||
      hostname.includes("/") ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        hostname
      )
    ) {
      throw new Error("ALLOWED_HOSTNAMES contains an invalid hostname");
    }
  }
  return [...new Set(hostnames)];
}
