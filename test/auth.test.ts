import { describe, expect, it } from "vitest";

import { isAuthorized, unauthorizedResponse } from "../src/auth";

const token = "a-valid-test-token-that-is-longer-than-32-characters";

describe("bearer authentication", () => {
  it("accepts the configured bearer token", async () => {
    const request = new Request("https://worker.test/mcp", {
      headers: { Authorization: `Bearer ${token}` }
    });
    await expect(isAuthorized(request, token)).resolves.toBe(true);
  });

  it("rejects missing and incorrect tokens", async () => {
    await expect(
      isAuthorized(new Request("https://worker.test/mcp"), token)
    ).resolves.toBe(false);
    await expect(
      isAuthorized(
        new Request("https://worker.test/mcp", {
          headers: { Authorization: "Bearer definitely-wrong" }
        }),
        token
      )
    ).resolves.toBe(false);
  });

  it("fails closed when the configured token is too short", async () => {
    const request = new Request("https://worker.test/mcp", {
      headers: { Authorization: "Bearer short" }
    });
    await expect(isAuthorized(request, "short")).resolves.toBe(false);
  });

  it("returns a non-cacheable bearer challenge", () => {
    const response = unauthorizedResponse();
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });
});
