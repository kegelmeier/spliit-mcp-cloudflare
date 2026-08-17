/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Worker HTTP boundary", () => {
  it("publishes non-secret service metadata", async () => {
    const response = await SELF.fetch("https://worker.test/");
    expect(response.status).toBe(200);
    const body = await response.json<{
      name: string;
      writesEnabled: boolean;
    }>();
    expect(body.name).toBe("spliit-mcp-cloudflare");
    expect(body.writesEnabled).toBe(true);
    expect(JSON.stringify(body)).not.toContain("group-secret");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reports healthy default configuration without contacting Spliit", async () => {
    const response = await SELF.fetch("https://worker.test/healthz");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("requires bearer authentication at the MCP endpoint", async () => {
    const response = await SELF.fetch("https://worker.test/mcp", { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("serves a no-store, frame-protected setup page", async () => {
    const response = await SELF.fetch("https://worker.test/setup");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
    const body = await response.text();
    expect(body).not.toContain("group-secret");
  });

  it("protects group administration with a distinct bearer token", async () => {
    const response = await SELF.fetch("https://worker.test/admin/groups");
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("spliit-mcp-admin");

    const probe = await SELF.fetch("https://worker.test/admin/probe", {
      method: "POST"
    });
    expect(probe.status).toBe(401);
  });

  it("imports legacy groups through the authenticated admin boundary", async () => {
    const response = await SELF.fetch("https://worker.test/admin/groups", {
      headers: {
        Authorization: "Bearer different-admin-token-with-at-least-32-chars"
      }
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      groups: [{ alias: "holiday", active: true }]
    });
  });

  it("returns 404 outside its declared routes", async () => {
    const response = await SELF.fetch("https://worker.test/nope");
    expect(response.status).toBe(404);
  });
});
