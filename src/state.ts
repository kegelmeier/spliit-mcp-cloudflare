import { DurableObject } from "cloudflare:workers";

import type { ConfiguredGroup } from "./config";
import { decryptJson, encryptJson } from "./crypto";

export interface GroupRegistryItem {
  alias: string;
  active: boolean;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ExpenseDraft {
  kind: "expense" | "reimbursement";
  group: ConfiguredGroup;
  mutationInput: JsonObject;
  preview: JsonObject;
}

export interface ClaimedDraft {
  id: string;
  claimToken: string;
  payload: ExpenseDraft;
}

interface GroupRow extends Record<string, SqlStorageValue> {
  alias: string;
  encrypted_config: string;
}

interface DraftRow extends Record<string, SqlStorageValue> {
  encrypted_payload: string;
  status: string;
  expires_at: number;
  claim_token: string | null;
  encrypted_result: string | null;
}

export class StateError extends Error {
  override name = "StateError";
}

export class SpliitState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        alias TEXT PRIMARY KEY,
        encrypted_config TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        group_alias TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'complete')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        claim_token TEXT,
        encrypted_result TEXT
      );
      CREATE INDEX IF NOT EXISTS drafts_expires_at ON drafts(expires_at);
      CREATE INDEX IF NOT EXISTS drafts_group_alias ON drafts(group_alias);
    `);
  }

  isBootstrapped(): boolean {
    return this.setting("bootstrap_complete") === "1";
  }

  async bootstrap(groups: readonly ConfiguredGroup[]): Promise<void> {
    if (this.isBootstrapped()) return;
    const now = Date.now();
    const encryptedGroups = await Promise.all(
      groups.map(async (group) => ({
        group,
        encryptedConfig: await encryptJson(
          group,
          this.env.DATA_ENCRYPTION_KEY,
          groupAssociatedData(group.alias)
        )
      }))
    );
    this.ctx.storage.transactionSync(() => {
      // Another bootstrap RPC may have completed while Web Crypto was running.
      if (this.isBootstrapped()) return;
      for (const { group, encryptedConfig } of encryptedGroups) {
        this.ctx.storage.sql.exec(
          `INSERT INTO groups(alias, encrypted_config, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(alias) DO NOTHING`,
          group.alias,
          encryptedConfig,
          now,
          now
        );
      }
      this.selectFirstGroupWhenUnset();
      this.setSetting("bootstrap_complete", "1");
    });
  }

  async putGroup(group: ConfiguredGroup): Promise<void> {
    const encrypted = await encryptJson(
      group,
      this.env.DATA_ENCRYPTION_KEY,
      groupAssociatedData(group.alias)
    );
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      const replacing = this.hasGroup(group.alias);
      this.ctx.storage.sql.exec(
        `INSERT INTO groups(alias, encrypted_config, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(alias) DO UPDATE SET encrypted_config = excluded.encrypted_config,
           updated_at = excluded.updated_at`,
        group.alias,
        encrypted,
        now,
        now
      );
      if (replacing) {
        // A capability prepared with the old credential must not survive a
        // registry edit. Drafts for unrelated aliases stay valid.
        this.ctx.storage.sql.exec("DELETE FROM drafts WHERE group_alias = ?", group.alias);
      }
      this.selectFirstGroupWhenUnset();
    });
  }

  removeGroup(alias: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const result = this.ctx.storage.sql.exec("DELETE FROM groups WHERE alias = ?", alias);
      if (result.rowsWritten === 0) return false;
      // A draft embeds its exact group configuration. Removing that credential
      // invalidates only its capabilities.
      this.ctx.storage.sql.exec("DELETE FROM drafts WHERE group_alias = ?", alias);
      if (this.setting("active_group") === alias) {
        this.ctx.storage.sql.exec("DELETE FROM settings WHERE key = 'active_group'");
        this.selectFirstGroupWhenUnset();
      }
      return true;
    });
  }

  listGroups(): GroupRegistryItem[] {
    const active = this.setting("active_group");
    return this.ctx.storage.sql
      .exec<{ alias: string }>("SELECT alias FROM groups ORDER BY alias")
      .toArray()
      .map((row) => ({ alias: row.alias, active: row.alias === active }));
  }

  selectGroup(alias: string): GroupRegistryItem {
    if (!this.hasGroup(alias)) throw new StateError("Unknown group alias. Call list_groups first.");
    this.setSetting("active_group", alias);
    return { alias, active: true };
  }

  async getActiveGroup(): Promise<ConfiguredGroup> {
    const alias = this.setting("active_group");
    if (alias === undefined) {
      throw new StateError(
        "No active group. Call add_group_from_link or use /setup; create_group is available when writes are enabled."
      );
    }
    return this.getGroup(alias);
  }

  async createDraft(payload: ExpenseDraft, ttlSeconds: number): Promise<{
    draftId: string;
    expiresAt: string;
  }> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1_000;
    const encrypted = await encryptJson(
      payload,
      this.env.DATA_ENCRYPTION_KEY,
      draftAssociatedData(id)
    );
    this.deleteExpiredDrafts(now);
    this.ctx.storage.sql.exec(
      `INSERT INTO drafts(id, group_alias, encrypted_payload, status, created_at, expires_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      id,
      payload.group.alias,
      encrypted,
      now,
      expiresAt
    );
    return { draftId: id, expiresAt: new Date(expiresAt).toISOString() };
  }

  async claimDraft(id: string): Promise<
    | { state: "claimed"; draft: ClaimedDraft }
    | { state: "complete"; result: JsonObject }
  > {
    const now = Date.now();
    const row = this.draftRow(id);
    if (row === undefined || row.expires_at <= now) {
      throw new StateError("Draft not found or expired. Prepare the write again.");
    }
    if (row.status === "complete") {
      if (row.encrypted_result === null) throw new StateError("Completed draft result is unavailable.");
      return {
        state: "complete",
        result: await decryptJson<JsonObject>(
          row.encrypted_result,
          this.env.DATA_ENCRYPTION_KEY,
          resultAssociatedData(id)
        )
      };
    }
    if (row.status === "processing") {
      throw new StateError(
        "This draft has an in-progress or ambiguous commit. Verify Spliit before preparing another write."
      );
    }
    const claimToken = crypto.randomUUID();
    const updated = this.ctx.storage.sql.exec(
      `UPDATE drafts SET status = 'processing', claim_token = ?
       WHERE id = ? AND status != 'complete'`,
      claimToken,
      id
    );
    if (updated.rowsWritten !== 1) throw new StateError("This draft could not be claimed.");
    const payload = await decryptJson<ExpenseDraft>(
      row.encrypted_payload,
      this.env.DATA_ENCRYPTION_KEY,
      draftAssociatedData(id)
    );
    return { state: "claimed", draft: { id, claimToken, payload } };
  }

  async completeDraft(
    id: string,
    claimToken: string,
    result: JsonObject
  ): Promise<void> {
    const encrypted = await encryptJson(
      result,
      this.env.DATA_ENCRYPTION_KEY,
      resultAssociatedData(id)
    );
    const update = this.ctx.storage.sql.exec(
      `UPDATE drafts SET status = 'complete', encrypted_result = ?, claim_token = NULL
       WHERE id = ? AND status = 'processing' AND claim_token = ?`,
      encrypted,
      id,
      claimToken
    );
    if (update.rowsWritten !== 1) throw new StateError("The draft claim expired before completion.");
  }

  releaseDraft(id: string, claimToken: string): void {
    this.ctx.storage.sql.exec(
      `UPDATE drafts SET status = 'pending', claim_token = NULL
       WHERE id = ? AND status = 'processing' AND claim_token = ?`,
      id,
      claimToken
    );
  }

  private async getGroup(alias: string): Promise<ConfiguredGroup> {
    const row = this.ctx.storage.sql
      .exec<GroupRow>(
        "SELECT alias, encrypted_config FROM groups WHERE alias = ? LIMIT 1",
        alias
      )
      .toArray()[0];
    if (row === undefined) throw new StateError("The active group no longer exists.");
    return decryptJson<ConfiguredGroup>(
      row.encrypted_config,
      this.env.DATA_ENCRYPTION_KEY,
      groupAssociatedData(row.alias)
    );
  }

  private draftRow(id: string): DraftRow | undefined {
    return this.ctx.storage.sql
      .exec<DraftRow>(
        `SELECT encrypted_payload, status, expires_at, claim_token,
         encrypted_result FROM drafts WHERE id = ? LIMIT 1`,
        id
      )
      .toArray()[0];
  }

  private hasGroup(alias: string): boolean {
    return this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM groups WHERE alias = ?", alias)
      .one().count === 1;
  }

  private setting(key: string): string | undefined {
    return this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM settings WHERE key = ? LIMIT 1", key)
      .toArray()[0]?.value;
  }

  private setSetting(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO settings(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value
    );
  }

  private selectFirstGroupWhenUnset(): void {
    if (this.setting("active_group") !== undefined) return;
    const first = this.ctx.storage.sql
      .exec<{ alias: string }>("SELECT alias FROM groups ORDER BY created_at, alias LIMIT 1")
      .toArray()[0];
    if (first !== undefined) this.setSetting("active_group", first.alias);
  }

  private deleteExpiredDrafts(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM drafts WHERE expires_at <= ?", now);
  }
}

function groupAssociatedData(alias: string): string {
  return `spliit-mcp:v1:group:${alias}`;
}

function draftAssociatedData(id: string): string {
  return `spliit-mcp:v1:draft:${id}`;
}

function resultAssociatedData(id: string): string {
  return `spliit-mcp:v1:result:${id}`;
}
