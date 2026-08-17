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
    expect(names).not.toContain("create_expense");
    expect(names).toHaveLength(11);
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
  private active: ConfiguredGroup;
  private readonly drafts = new Map<
    string,
    { payload: ExpenseDraft; claimToken?: string; result?: JsonObject }
  >();

  constructor(private readonly groups: readonly ConfiguredGroup[]) {
    const first = groups[0];
    if (first === undefined) throw new Error("test needs a group");
    this.active = first;
  }

  async listGroups(): Promise<GroupRegistryItem[]> {
    return this.groups.map((group) => ({
      alias: group.alias,
      active: group.alias === this.active.alias
    }));
  }

  async selectGroup(alias: string): Promise<GroupRegistryItem> {
    const group = this.groups.find((candidate) => candidate.alias === alias);
    if (group === undefined) throw new Error("unknown group");
    this.active = group;
    return { alias, active: true };
  }

  async getActiveGroup(): Promise<ConfiguredGroup> {
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
