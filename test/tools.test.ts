import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import type { ConfiguredGroup } from "../src/config";
import { SpliitClient } from "../src/spliit/client";
import type {
  ClaimedDraft,
  ExpenseDraft,
  GroupRegistryItem,
  JsonObject
} from "../src/state";
import { createSpliitMcpServer, type SpliitStateStore } from "../src/tools";

const holiday: ConfiguredGroup = {
  alias: "holiday",
  groupId: "holiday-secret",
  participantId: "p1",
  trpcBaseUrl: "https://spliit.test/api/trpc",
  webUrl: "https://spliit.test/groups/holiday-secret"
};
const work: ConfiguredGroup = {
  alias: "work",
  groupId: "work-secret",
  participantId: "p1",
  trpcBaseUrl: "https://spliit.test/api/trpc",
  webUrl: "https://spliit.test/groups/work-secret"
};

describe("MCP tool registration", () => {
  it("supports an explicitly read-only tool set", async () => {
    const { names } = await listedTools(false);
    expect(names).toEqual([
      "add_group_from_link",
      "get_balances",
      "get_expense",
      "get_group",
      "list_activities",
      "list_categories",
      "list_expenses",
      "list_groups",
      "select_group"
    ]);
  });

  it("registers prepare/commit tools when writes are enabled", async () => {
    const { names } = await listedTools(true);
    expect(names).toContain("prepare_expense");
    expect(names).toContain("prepare_reimbursement");
    expect(names).toContain("commit_draft");
    expect(names).toContain("create_group");
    expect(names).not.toContain("create_expense");
    expect(names).toHaveLength(13);
  });

  it("adds a supplied group link under a derived alias without returning credentials", async () => {
    const state = new MemoryState([holiday]);
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.pathname).toBe("/api/trpc/groups.get");
      return trpcResponse({
        group: {
          id: "imported-placeholder-id",
          name: "Weekend Trip",
          currency: "€",
          currencyCode: "EUR",
          participants: [
            { id: "imported-p1", name: "Ada" },
            { id: "imported-p2", name: "Linus" }
          ]
        }
      });
    };
    const { client, close } = await connectedClient(state, false, fetcher);
    try {
      const result = await client.callTool({
        name: "add_group_from_link",
        arguments: {
          url: "https://spliit.test/groups/imported-placeholder-id",
          activeParticipant: "Ada"
        }
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        added: true,
        alias: "weekend-trip",
        name: "Weekend Trip",
        currency: "EUR",
        participantCount: 2,
        activeParticipant: "Ada",
        active: true
      });
      expect(JSON.stringify(result.structuredContent)).not.toContain("imported-placeholder-id");
      expect(await state.listGroups()).toContainEqual({ alias: "weekend-trip", active: true });
      await expect(state.getActiveGroup()).resolves.toMatchObject({
        alias: "weekend-trip",
        participantId: "imported-p1"
      });
    } finally {
      await close();
    }
  });

  it("rejects a group link outside the outbound allowlist before fetching it", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return trpcResponse({});
    };
    const { client, close } = await connectedClient(
      new MemoryState([holiday]),
      false,
      fetcher
    );
    try {
      const result = await client.callTool({
        name: "add_group_from_link",
        arguments: { url: "https://untrusted.test/groups/placeholder-id" }
      });
      expect(result.isError).toBe(true);
      expect(
        result.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n")
      ).toContain("not permitted");
      expect(calls).toBe(0);
    } finally {
      await close();
    }
  });

  it("creates a group on the active Spliit host and remembers it as active", async () => {
    const state = new MemoryState([holiday]);
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (init?.method === "POST") {
        expect(url.pathname).toBe("/api/trpc/groups.create");
        expect(JSON.parse(String(init.body))).toEqual({
          json: {
            groupFormValues: {
              name: "Family Budget",
              information: "Shared household costs",
              currency: "€",
              currencyCode: "EUR",
              participants: [{ name: "Ada" }, { name: "Linus" }]
            }
          }
        });
        return trpcResponse({ groupId: "created-placeholder-id" });
      }
      expect(url.pathname).toBe("/api/trpc/groups.get");
      return trpcResponse({
        group: {
          id: "created-placeholder-id",
          name: "Family Budget",
          information: "Shared household costs",
          currency: "€",
          currencyCode: "EUR",
          participants: [
            { id: "created-p1", name: "Ada" },
            { id: "created-p2", name: "Linus" }
          ]
        }
      });
    };
    const { client, close } = await connectedClient(state, true, fetcher);
    try {
      const result = await client.callTool({
        name: "create_group",
        arguments: {
          name: "Family Budget",
          information: "Shared household costs",
          currencyCode: "EUR",
          participants: ["Ada", "Linus"]
        }
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        created: true,
        alias: "family-budget",
        name: "Family Budget",
        currency: "EUR",
        participants: ["Ada", "Linus"],
        activeParticipant: "Ada",
        active: true,
        detailsVerified: true
      });
      expect(JSON.stringify(result.structuredContent)).not.toContain("created-placeholder-id");
      await expect(state.getActiveGroup()).resolves.toMatchObject({
        alias: "family-budget",
        participantId: "created-p1",
        trpcBaseUrl: "https://spliit.test/api/trpc"
      });
    } finally {
      await close();
    }
  });

  it("keeps a created public group recoverable when its detail refresh fails", async () => {
    const state = new MemoryState([]);
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.hostname).toBe("spliit.app");
      if (init?.method === "POST") {
        return trpcResponse({ groupId: "recoverable-placeholder-id" });
      }
      throw new TypeError("temporary read failure");
    };
    const { client, close } = await connectedClient(state, true, fetcher);
    try {
      const result = await client.callTool({
        name: "create_group",
        arguments: {
          name: "Solo Costs",
          currencyCode: "EUR",
          participants: ["Ada"]
        }
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        created: true,
        alias: "solo-costs",
        name: "Solo Costs",
        currency: "EUR",
        participants: ["Ada"],
        activeParticipant: null,
        active: true,
        detailsVerified: false
      });
      await expect(state.getActiveGroup()).resolves.toMatchObject({
        alias: "solo-costs",
        trpcBaseUrl: "https://spliit.app/api/trpc"
      });
    } finally {
      await close();
    }
  });

  it("commits a draft to its immutable group after the active group changes", async () => {
    const state = new MemoryState([holiday, work]);
    const mutationGroups: string[] = [];
    const mutationExpenses: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          json: {
            groupId: string;
            expenseFormValues: Record<string, unknown>;
          };
        };
        mutationGroups.push(body.json.groupId);
        mutationExpenses.push(body.json.expenseFormValues);
        return trpcResponse({ expenseId: "expense-created" });
      }
      const inputValue = JSON.parse(url.searchParams.get("input") ?? "{}") as {
        json?: { groupId?: string };
      };
      return trpcResponse({
        group: {
          id: inputValue.json?.groupId ?? "unknown",
          name: inputValue.json?.groupId === holiday.groupId ? "Holiday" : "Work",
          currency: "€",
          currencyCode: "EUR",
          participants: [
            { id: "p1", name: "Ada" },
            { id: "p2", name: "Linus" }
          ]
        }
      });
    };
    const { client, close } = await connectedClient(state, true, fetcher);
    try {
      const prepared = await client.callTool({
        name: "prepare_expense",
        arguments: { title: "Dinner", amount: "42.00" }
      });
      const draftId = (prepared.structuredContent as { draftId: string }).draftId;
      await state.selectGroup("work");
      const committed = await client.callTool({
        name: "commit_draft",
        arguments: { draftId }
      });
      expect(committed.isError).not.toBe(true);
      expect(committed.structuredContent).toMatchObject({
        committed: true,
        group: "holiday",
        expenseId: "expense-created"
      });
      expect(mutationGroups).toEqual([holiday.groupId]);
      expect(mutationExpenses[0]).not.toHaveProperty("originalAmount");
      expect(mutationExpenses[0]).not.toHaveProperty("conversionRate");

      const replay = await client.callTool({
        name: "commit_draft",
        arguments: { draftId }
      });
      expect(replay.structuredContent).toMatchObject({ alreadyCommitted: true });
      expect(mutationGroups).toEqual([holiday.groupId]);
    } finally {
      await close();
    }
  });
});

class MemoryState implements SpliitStateStore {
  private active: ConfiguredGroup | undefined;
  private readonly groups: ConfiguredGroup[];
  private readonly drafts = new Map<
    string,
    { payload: ExpenseDraft; claimToken?: string; result?: JsonObject }
  >();

  constructor(groups: readonly ConfiguredGroup[]) {
    this.groups = [...groups];
    this.active = this.groups[0];
  }

  async listGroups(): Promise<GroupRegistryItem[]> {
    return this.groups.map((group) => ({
      alias: group.alias,
      active: group.alias === this.active?.alias
    }));
  }

  async selectGroup(alias: string): Promise<GroupRegistryItem> {
    const group = this.groups.find((candidate) => candidate.alias === alias);
    if (group === undefined) throw new Error("unknown group");
    this.active = group;
    return { alias, active: true };
  }

  async putGroup(group: ConfiguredGroup): Promise<void> {
    const existing = this.groups.findIndex((candidate) => candidate.alias === group.alias);
    if (existing === -1) this.groups.push(group);
    else this.groups[existing] = group;
    this.active ??= group;
  }

  async getActiveGroup(): Promise<ConfiguredGroup> {
    if (this.active === undefined) throw new Error("no active group");
    return this.active;
  }

  async createDraft(payload: ExpenseDraft): Promise<{ draftId: string; expiresAt: string }> {
    const draftId = crypto.randomUUID();
    this.drafts.set(draftId, { payload });
    return { draftId, expiresAt: new Date(Date.now() + 600_000).toISOString() };
  }

  async claimDraft(id: string): Promise<
    | { state: "claimed"; draft: ClaimedDraft }
    | { state: "complete"; result: JsonObject }
  > {
    const value = this.drafts.get(id);
    if (value === undefined) throw new Error("missing draft");
    if (value.result !== undefined) return { state: "complete", result: value.result };
    const claimToken = crypto.randomUUID();
    value.claimToken = claimToken;
    return { state: "claimed", draft: { id, claimToken, payload: value.payload } };
  }

  async completeDraft(
    id: string,
    claimToken: string,
    result: JsonObject
  ): Promise<void> {
    const value = this.drafts.get(id);
    if (value?.claimToken !== claimToken) throw new Error("invalid claim");
    value.result = result;
  }

  async releaseDraft(id: string, claimToken: string): Promise<void> {
    const value = this.drafts.get(id);
    if (value?.claimToken === claimToken) delete value.claimToken;
  }
}

async function listedTools(writesEnabled: boolean): Promise<{ names: string[] }> {
  const { client, close } = await connectedClient(
    new MemoryState([holiday]),
    writesEnabled,
    fetch
  );
  try {
    const result = await client.listTools();
    return { names: result.tools.map((tool) => tool.name).sort() };
  } finally {
    await close();
  }
}

async function connectedClient(
  state: SpliitStateStore,
  writesEnabled: boolean,
  fetcher: typeof fetch
): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createSpliitMcpServer({
    state,
    timeoutMs: 5_000,
    draftTtlSeconds: 600,
    writesEnabled,
    allowedSpliitHostnames: ["spliit.test", "spliit.app"],
    clientFactory: (group, timeoutMs) => new SpliitClient(group, timeoutMs, fetcher)
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
    }
  };
}

function trpcResponse(value: unknown): Response {
  return Response.json({ result: { data: { json: value } } });
}
