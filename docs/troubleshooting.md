# Troubleshooting

## Required secrets are missing

Version 1 requires `MCP_AUTH_TOKEN`, `ADMIN_TOKEN`, `DATA_ENCRYPTION_KEY`, and
`SPLIIT_GROUPS_JSON`. New installs use `[]` for the last value. The first deploy
can upload all four atomically:

```bash
npx wrangler deploy --secrets-file .dev.vars
```

Both tokens need at least 32 characters and must differ. The encryption key must
be exactly 64 hexadecimal characters. `wrangler secret list` shows names, not
values.

## `/healthz` is unhealthy

Common causes:

- missing, short, or identical bearer tokens;
- malformed encryption key;
- malformed legacy import JSON;
- an imported group host absent from `ALLOWED_SPLIIT_HOSTNAMES`;
- invalid timeout, draft TTL, or hostname allowlist.

Health does not contact Spliit or reveal the failing value.

## `/mcp` or `/admin` returns 401

- `/mcp` uses `MCP_AUTH_TOKEN`.
- `/admin/groups` and `/setup` actions use `ADMIN_TOKEN`.
- Both use `Authorization: Bearer` and the exact Worker host.
- Restart the MCP client after changing its environment.

If uncertain, rotate the affected token. Token rotation does not change the
stable `primary` Durable Object. Never rotate the data key as a token fix.

## Setup or `add_group_from_link` rejects a group hostname

Only exact hostnames in `ALLOWED_SPLIIT_HOSTNAMES` are permitted. The default is
`spliit.app`. Add an explicit self-hosted name in `wrangler.jsonc`, run checks,
and redeploy. Do not use a broad proxy host as a shortcut.

## Setup or MCP group import cannot reach Spliit

Confirm the group opens in a browser and its server still exposes Spliit's tRPC
interface. Responses that Cloudflare redirected are rejected rather than parsed
as Spliit data. Sanitized errors intentionally omit the private URL and group ID.

For a safe server-side connectivity check, send an authenticated `POST` request
to `/admin/probe` with the admin bearer token. A successful response reports
only the active alias, hostname, and read-status booleans for the group and its
balances; it never returns the stored group URL, ID, or balance values.

## No groups appear after upgrading

The import happens only once. If the first authenticated version-1 request used
`SPLIIT_GROUPS_JSON=[]`, add each group through `/setup`. If the old JSON was
present, verify its hosts were allowed and the Worker was healthy before that
first request. Never paste the old secret into a ticket or chat.

## A group is not active

Call `list_groups`, then `select_group` with a returned alias. Reads do not
accept group arguments in version 1. Selection is shared across conversations
that use this personal Worker.

## Write tools are missing

They are registered by default. Confirm `WRITES_ENABLED` is not explicitly set
to `"false"`, review [Security](../SECURITY.md#write-safety), set it to `"true"`,
run `npm run check`, and redeploy. Keep it false only for an intentionally
read-only Worker. `create_group` follows this switch;
`add_group_from_link` remains available because it only changes the encrypted
Cloudflare registry.

## A created group says its details were not verified

The upstream creation succeeded and the Worker safely remembered the group, but
the immediate follow-up read failed. Do not call `create_group` again. Call
`list_groups`, select the returned alias if needed, and retry `get_group`.

## A draft expired

Prepare it again. `DRAFT_TTL_SECONDS` defaults to ten minutes and accepts 60 to
3,600 seconds. Updating/removing its group also invalidates that group's drafts.

## A draft reports an ambiguous commit

The Worker claimed the draft but could not safely prove completion, commonly
because execution was interrupted. Inspect Spliit for the expense before doing
anything else. The locked draft will not retry automatically. If no expense
exists, prepare a new draft; if it exists, do not create another.

## Stored state cannot be decrypted

The deployed `DATA_ENCRYPTION_KEY` no longer matches the key that encrypted the
registry. Restore the original key from the password manager. There is no
automatic key-rotation path. If it is lost, stored links must be added again
through setup under a new empty deployment/state migration strategy.

## Build fails after UI deployment

- Use Node.js 22+, `npm ci`, and `npx wrangler deploy`.
- Confirm all four secret names are present.
- Confirm `wrangler.jsonc` still contains the `SpliitState` binding and `v1`
  SQLite migration.
- Redact secrets and private data before sharing build output.

## A secret was exposed

Rotate exposed MCP/admin tokens immediately. If a data key was exposed, take
the Worker offline and plan an explicit decrypt/re-encrypt migration; simply
changing it makes records unreadable. A leaked Spliit group ID cannot be rotated
independently, so replace the group and migrate its data.
