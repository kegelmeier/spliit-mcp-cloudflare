import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import type { ConfiguredGroup } from "../src/config";
import { createSpliitMcpServer } from "../src/tools";

const group: ConfiguredGroup = {
  alias: "holiday",
  groupId: "group-secret",
  trpcBaseUrl: "https://spliit.test/api/trpc",
  webUrl: "https://spliit.test/groups/group-secret"
};

describe("MCP tool registration", () => {
  it("exposes only read tools by default", async () => {
    const names = await listedToolNames(false);
    expect(names).toEqual([
      "get_balances",
      "get_expense",
      "get_group",
      "list_activities",
      "list_categories",
      "list_expenses",
      "list_groups"
    ]);
  });

  it("adds create tools only when writes are explicitly enabled", async () => {
    const names = await listedToolNames(true);
    expect(names).toContain("create_expense");
    expect(names).toContain("create_reimbursement");
    expect(names).toHaveLength(9);
  });
});

async function listedToolNames(writesEnabled: boolean): Promise<string[]> {
  const server = createSpliitMcpServer({
    groups: [group],
    timeoutMs: 5_000,
    writesEnabled
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  try {
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
  }
}
