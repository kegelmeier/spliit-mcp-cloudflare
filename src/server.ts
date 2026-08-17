import { createMcpHandler } from "agents/mcp/server";

import { isAuthorized, unauthorizedResponse } from "./auth";
import {
  assertAllowedUpstreamHost,
  ConfigurationError,
  parseConfiguredGroup,
  parseConfiguredGroups,
  parseHostnameAllowlist
} from "./config";
import { validateEncryptionKey } from "./crypto";
import { SpliitAPIError, SpliitClient } from "./spliit/client";
import { balancesResponseSchema, groupResponseSchema } from "./spliit/schemas";
import { SpliitState, StateError } from "./state";
import { setupHtml, setupJavaScript } from "./setup";
import { createSpliitMcpServer, type SpliitStateStore } from "./tools";

export { SpliitState } from "./state";

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
} as const;

export default {
  async fetch(request, env, context): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json(
        {
          name: "spliit-mcp-cloudflare",
          version: "1.0.1",
          mcpEndpoint: "/mcp",
          setupEndpoint: "/setup",
          authentication: "Bearer token required",
          writesEnabled: parseWritesEnabled(env.WRITES_ENABLED)
        },
        { headers: JSON_HEADERS }
      );
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      return healthResponse(env);
    }

    if (request.method === "GET" && url.pathname === "/setup") {
      return setupHtml();
    }
    if (request.method === "GET" && url.pathname === "/setup.js") {
      return setupJavaScript();
    }

    if (url.pathname === "/mcp") {
      return handleMcp(request, env, context);
    }

    if (
      url.pathname === "/admin/probe" ||
      url.pathname === "/admin/groups" ||
      url.pathname.startsWith("/admin/groups/")
    ) {
      return handleAdmin(request, env, url);
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: JSON_HEADERS });
  }
} satisfies ExportedHandler<Env>;

async function handleMcp(
  request: Request,
  env: Env,
  context: ExecutionContext
): Promise<Response> {
  if (!(await isAuthorized(request, env.MCP_AUTH_TOKEN))) return unauthorizedResponse();

  try {
    validateEnvironment(env);
    const state = (await initializedState(env)) as unknown as SpliitStateStore;
    const allowedHostnames = parseHostnameAllowlist(env.ALLOWED_HOSTNAMES, "ALLOWED_HOSTNAMES");
    const handler = createMcpHandler(
      () =>
        createSpliitMcpServer({
          state,
          timeoutMs: parseTimeout(env.SPLIIT_TIMEOUT_MS),
          draftTtlSeconds: parseDraftTtl(env.DRAFT_TTL_SECONDS),
          writesEnabled: parseWritesEnabled(env.WRITES_ENABLED)
        }),
      {
        route: "/mcp",
        corsOptions: false,
        ...(allowedHostnames.length === 0 ? {} : { allowedHostnames })
      }
    );
    return handler(request, env, context);
  } catch {
    logSafe("mcp_initialization_error");
    return Response.json(
      { error: "Server configuration is invalid" },
      { status: 503, headers: JSON_HEADERS }
    );
  }
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await isAuthorized(request, env.ADMIN_TOKEN))) {
    return unauthorizedResponse("spliit-mcp-admin");
  }

  try {
    validateEnvironment(env);
    const state = await initializedState(env);
    if (url.pathname === "/admin/probe" && request.method === "POST") {
      const configured = await state.getActiveGroup();
      assertAllowedUpstreamHost(
        configured,
        parseHostnameAllowlist(
          env.ALLOWED_SPLIIT_HOSTNAMES,
          "ALLOWED_SPLIIT_HOSTNAMES"
        )
      );
      const client = new SpliitClient(configured, parseTimeout(env.SPLIIT_TIMEOUT_MS));
      await Promise.all([
        client.query(
          "groups.get",
          { groupId: configured.groupId },
          groupResponseSchema
        ),
        client.query(
          "groups.balances.list",
          { groupId: configured.groupId },
          balancesResponseSchema
        )
      ]);
      return Response.json(
        {
          reachable: true,
          groupReadable: true,
          balancesReadable: true,
          alias: configured.alias,
          hostname: new URL(configured.webUrl).hostname
        },
        { headers: JSON_HEADERS }
      );
    }
    if (url.pathname === "/admin/groups" && request.method === "GET") {
      return Response.json({ groups: await state.listGroups() }, { headers: JSON_HEADERS });
    }
    if (url.pathname === "/admin/groups" && request.method === "POST") {
      const configured = parseConfiguredGroup(await readLimitedJson(request));
      assertAllowedUpstreamHost(
        configured,
        parseHostnameAllowlist(
          env.ALLOWED_SPLIIT_HOSTNAMES,
          "ALLOWED_SPLIIT_HOSTNAMES"
        )
      );
      const response = await new SpliitClient(
        configured,
        parseTimeout(env.SPLIIT_TIMEOUT_MS)
      ).query("groups.get", { groupId: configured.groupId }, groupResponseSchema);
      await state.putGroup(configured);
      return Response.json(
        {
          saved: true,
          alias: configured.alias,
          name: response.group.name,
          participantCount: response.group.participants?.length ?? 0
        },
        { status: 201, headers: JSON_HEADERS }
      );
    }

    const actionMatch = url.pathname.match(/^\/admin\/groups\/([^/]+)\/(select)$/);
    if (request.method === "POST" && actionMatch?.[1] !== undefined) {
      const alias = normalizePathAlias(actionMatch[1]);
      await state.selectGroup(alias);
      return Response.json({ selected: alias }, { headers: JSON_HEADERS });
    }

    const groupMatch = url.pathname.match(/^\/admin\/groups\/([^/]+)$/);
    if (request.method === "DELETE" && groupMatch?.[1] !== undefined) {
      const alias = normalizePathAlias(groupMatch[1]);
      const removed = await state.removeGroup(alias);
      if (!removed) {
        return Response.json(
          { error: "Unknown group alias" },
          { status: 404, headers: JSON_HEADERS }
        );
      }
      return Response.json({ removed: true, alias }, { headers: JSON_HEADERS });
    }
  } catch (error) {
    const safe = safeAdminError(error);
    return Response.json({ error: safe.message }, { status: safe.status, headers: JSON_HEADERS });
  }

  return Response.json(
    { error: "Method not allowed" },
    { status: 405, headers: { ...JSON_HEADERS, Allow: "GET, POST, DELETE" } }
  );
}

async function initializedState(env: Env): Promise<DurableObjectStub<SpliitState>> {
  // This deployment is deliberately one personal registry. Keeping the object
  // name stable allows MCP and admin token rotation without orphaning state.
  const state = env.SPLIIT_STATE.getByName("primary");
  if (!(await state.isBootstrapped())) {
    const groups = parseConfiguredGroups(env.SPLIIT_GROUPS_JSON);
    const allowed = parseHostnameAllowlist(
      env.ALLOWED_SPLIIT_HOSTNAMES,
      "ALLOWED_SPLIIT_HOSTNAMES"
    );
    for (const group of groups) assertAllowedUpstreamHost(group, allowed);
    await state.bootstrap(groups);
  }
  return state;
}

function healthResponse(env: Env): Response {
  try {
    validateEnvironment(env);
    return Response.json({ status: "ok" }, { headers: JSON_HEADERS });
  } catch {
    return Response.json(
      { status: "unhealthy" },
      { status: 503, headers: JSON_HEADERS }
    );
  }
}

function validateEnvironment(env: Env): void {
  if (env.MCP_AUTH_TOKEN.length < 32) throw new Error("MCP token too short");
  if (env.ADMIN_TOKEN.length < 32) throw new Error("admin token too short");
  if (env.MCP_AUTH_TOKEN === env.ADMIN_TOKEN) throw new Error("tokens must be distinct");
  validateEncryptionKey(env.DATA_ENCRYPTION_KEY);
  const groups = parseConfiguredGroups(env.SPLIIT_GROUPS_JSON);
  const allowedSpliitHosts = parseHostnameAllowlist(
    env.ALLOWED_SPLIIT_HOSTNAMES,
    "ALLOWED_SPLIIT_HOSTNAMES"
  );
  if (allowedSpliitHosts.length === 0) {
    throw new Error("ALLOWED_SPLIIT_HOSTNAMES must include at least one host");
  }
  for (const group of groups) assertAllowedUpstreamHost(group, allowedSpliitHosts);
  parseTimeout(env.SPLIIT_TIMEOUT_MS);
  parseDraftTtl(env.DRAFT_TTL_SECONDS);
  parseWritesEnabled(env.WRITES_ENABLED);
  parseHostnameAllowlist(env.ALLOWED_HOSTNAMES, "ALLOWED_HOSTNAMES");
}

function parseWritesEnabled(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("WRITES_ENABLED must be true or false");
}

function parseTimeout(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 30_000) {
    throw new Error("SPLIIT_TIMEOUT_MS must be between 1000 and 30000");
  }
  return parsed;
}

function parseDraftTtl(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 3_600) {
    throw new Error("DRAFT_TTL_SECONDS must be between 60 and 3600");
  }
  return parsed;
}

function normalizePathAlias(encoded: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new ConfigurationError("Invalid group alias");
  }
  const configured = parseConfiguredGroup({
    alias: decoded,
    url: "https://placeholder.invalid/groups/placeholder"
  });
  return configured.alias;
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > 8_192) {
    throw new ConfigurationError("Request body is too large");
  }
  if (request.body === null) throw new ConfigurationError("A JSON body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > 8_192) {
      await reader.cancel("body too large");
      throw new ConfigurationError("Request body is too large");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ConfigurationError("Request body is not valid JSON");
  }
}

function safeAdminError(error: unknown): { status: number; message: string } {
  if (error instanceof ConfigurationError || error instanceof StateError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof SpliitAPIError) return { status: 502, message: error.message };
  logSafe("admin_operation_error");
  return { status: 500, message: "The operation failed without exposing secrets." };
}

function logSafe(event: string): void {
  console.error(JSON.stringify({ event, message: "Operation failed" }));
}
