/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredGroup } from "../src/config";
import { SpliitState, type ExpenseDraft } from "../src/state";
import type { SpliitStateStore } from "../src/tools";

const holiday: ConfiguredGroup = {
  alias: "holiday",
  groupId: "holiday-super-secret-id",
  participantId: "person-secret",
  trpcBaseUrl: "https://private-spliit.test/api/trpc",
  webUrl: "https://private-spliit.test/groups/holiday-super-secret-id"
};
const work: ConfiguredGroup = {
  alias: "work",
  groupId: "work-super-secret-id",
  trpcBaseUrl: "https://private-spliit.test/api/trpc",
  webUrl: "https://private-spliit.test/groups/work-super-secret-id"
};

afterEach(async () => reset());

describe("SQLite Durable Object state", () => {
  it("imports legacy groups once, selects one, and stores credentials encrypted", async () => {
    const state = stub("encrypted-registry");
    await state.bootstrap([holiday]);
    await state.bootstrap([work]);
    expect(await state.listGroups()).toEqual([{ alias: "holiday", active: true }]);

    const stored = await runInDurableObject(state, (_instance, ctx) =>
      ctx.storage.sql
        .exec<{ encrypted_config: string }>("SELECT encrypted_config FROM groups")
        .one().encrypted_config
    );
    expect(stored).not.toContain(holiday.groupId);
    expect(stored).not.toContain(holiday.participantId);
    expect(stored).not.toContain("private-spliit.test");
    await expect(state.getActiveGroup()).resolves.toEqual(holiday);
  });

  it("binds a draft to its original group and makes completion replay-safe", async () => {
    const state = stub("draft-binding");
    const rpc = state as unknown as SpliitStateStore;
    await state.bootstrap([holiday, work]);
    const payload = draft(holiday);
    const created = await rpc.createDraft(payload, 600);
    const storedDraft = await runInDurableObject(state, (_instance, ctx) =>
      ctx.storage.sql
        .exec<{ encrypted_payload: string }>(
          "SELECT encrypted_payload FROM drafts WHERE id = ?",
          created.draftId
        )
        .one().encrypted_payload
    );
    expect(storedDraft).not.toContain(holiday.groupId);
    expect(storedDraft).not.toContain("Dinner");
    await rpc.selectGroup("work");

    const claim = await rpc.claimDraft(created.draftId);
    expect(claim.state).toBe("claimed");
    if (claim.state !== "claimed") throw new Error("expected claim");
    expect(claim.draft.payload.group.alias).toBe("holiday");
    await rpc.completeDraft(created.draftId, claim.draft.claimToken, {
      committed: true,
      group: "holiday"
    });
    await expect(rpc.claimDraft(created.draftId)).resolves.toEqual({
      state: "complete",
      result: { committed: true, group: "holiday" }
    });
  });

  it("allows only one concurrent claim", async () => {
    const state = stub("concurrent-claim");
    const rpc = state as unknown as SpliitStateStore;
    await state.bootstrap([holiday]);
    const created = await rpc.createDraft(draft(holiday), 600);
    const attempts = await runInDurableObject(state, (instance) =>
      Promise.allSettled([
        instance.claimDraft(created.draftId),
        instance.claimDraft(created.draftId)
      ])
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
  });

  it("invalidates only drafts whose group credential is replaced", async () => {
    const state = stub("credential-update");
    const rpc = state as unknown as SpliitStateStore;
    await state.bootstrap([holiday, work]);
    const holidayDraft = await rpc.createDraft(draft(holiday), 600);
    await rpc.selectGroup("work");
    const workDraft = await rpc.createDraft(draft(work), 600);

    await state.putGroup({ ...holiday, groupId: "replacement-secret-id" });
    const removedDraftError = await runInDurableObject(state, async (instance) => {
      try {
        await instance.claimDraft(holidayDraft.draftId);
        return "unexpected success";
      } catch (error) {
        return error instanceof Error ? error.message : "unknown error";
      }
    });
    expect(removedDraftError).toContain(
      "not found or expired"
    );
    await expect(rpc.claimDraft(workDraft.draftId)).resolves.toMatchObject({
      state: "claimed"
    });
  });
});

function stub(name: string): DurableObjectStub<SpliitState> {
  return env.SPLIIT_STATE.getByName(name);
}

function draft(group: ConfiguredGroup): ExpenseDraft {
  return {
    kind: "expense",
    group,
    mutationInput: { groupId: group.groupId },
    preview: { group: group.alias, title: "Dinner" }
  };
}
