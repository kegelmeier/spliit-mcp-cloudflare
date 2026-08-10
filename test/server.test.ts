/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Worker HTTP boundary", () => {
  it("publishes non-secret service metadata", async () => {
    const response = await SELF.fetch("https://worker.test/");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("spliit-mcp-cloudflare");
    expect(body).not.toContain("group-secret");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reports healthy configuration without contacting Spliit", async () => {
    const response = await SELF.fetch("https://worker.test/healthz");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("requires bearer authentication at the MCP endpoint", async () => {
    const response = await SELF.fetch("https://worker.test/mcp", { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("returns 404 outside its declared routes", async () => {
    const response = await SELF.fetch("https://worker.test/nope");
    expect(response.status).toBe(404);
  });
});
