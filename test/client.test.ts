import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ConfiguredGroup } from "../src/config";
import { SpliitAPIError, SpliitClient } from "../src/spliit/client";

const group: ConfiguredGroup = {
  alias: "holiday",
  groupId: "group-secret",
  trpcBaseUrl: "https://spliit.test/api/trpc",
  webUrl: "https://spliit.test/groups/group-secret"
};

describe("Spliit tRPC client", () => {
  it("invokes a supplied fetch function without an object receiver", async () => {
    let receiver: unknown = "not called";
    const fetcher = function (this: unknown): Promise<Response> {
      receiver = this;
      return Promise.resolve(
        Response.json({ result: { data: { json: { value: "ok" } } } })
      );
    } as typeof fetch;
    const client = new SpliitClient(group, 5_000, fetcher);
    await client.query("groups.get", {}, z.object({ value: z.string() }));
    expect(receiver).toBeUndefined();
  });

  it("sends the correct tRPC query envelope and validates output", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(init?.redirect).toBeUndefined();
      expect(new Headers(init?.headers).get("User-Agent")).toBeNull();
      expect(url.pathname).toBe("/api/trpc/groups.get");
      expect(JSON.parse(url.searchParams.get("input") ?? "null")).toEqual({
        json: { groupId: "group-secret" }
      });
      return Response.json({ result: { data: { json: { value: "ok" } } } });
    });
    const client = new SpliitClient(group, 5_000, fetcher);
    await expect(
      client.query("groups.get", { groupId: group.groupId }, z.object({ value: z.string() }))
    ).resolves.toEqual({ value: "ok" });
  });

  it("sends mutations as JSON", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ json: { amount: 1250 } }));
      expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
      return Response.json({ result: { data: { json: { id: "expense-1" } } } });
    });
    const client = new SpliitClient(group, 5_000, fetcher);
    await expect(
      client.mutation("groups.expenses.create", { amount: 1250 }, z.object({ id: z.string() }))
    ).resolves.toEqual({ id: "expense-1" });
  });

  it("rejects incompatible output", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ result: { data: { json: { value: 1 } } } })
    );
    const client = new SpliitClient(group, 5_000, fetcher);
    await expect(
      client.query("groups.get", {}, z.object({ value: z.string() }))
    ).rejects.toThrow("incompatible response");
  });

  it("does not expose upstream messages that may contain secret identifiers", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { json: { message: "group-secret must never be returned" } } },
        { status: 404 }
      )
    );
    const client = new SpliitClient(group, 5_000, fetcher);
    const error = await client
      .query("groups.get", {}, z.object({ value: z.string() }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SpliitAPIError);
    expect(String(error)).not.toContain("group-secret");
    expect(String(error)).toContain("HTTP 404");
  });

  it("rejects a response that the runtime redirected", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      const response = Response.json({
        result: { data: { json: { value: "untrusted" } } }
      });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    });
    const client = new SpliitClient(group, 5_000, fetcher);
    const error = await client
      .query("groups.get", {}, z.object({ value: z.string() }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SpliitAPIError);
    expect(String(error)).toContain("redirected unexpectedly");
    expect(String(error)).not.toContain("group-secret");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
