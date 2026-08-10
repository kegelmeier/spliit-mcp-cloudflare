# Spliit MCP for Cloudflare Workers

[![CI](https://github.com/kegelmeier/spliit-mcp-cloudflare/actions/workflows/ci.yml/badge.svg)](https://github.com/kegelmeier/spliit-mcp-cloudflare/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kegelmeier/spliit-mcp-cloudflare)

An unofficial, security-focused MCP server for [Spliit](https://spliit.app).
One remote MCP connection can remember many groups, keep one active group, and
read or deliberately create Spliit data. It is designed for a personal
Cloudflare Worker deployment.

A normal Spliit group link is sufficient. No modified Spliit backend or Spliit
account is required.

> [!IMPORTANT]
> A Spliit group link grants access to its group. Add links only through the
> protected `/setup` page. Never paste a real link into an AI prompt, commit,
> issue, screenshot, or log.

## Version 1 breaking change

Version 1 replaces per-call group arguments with a durable active-group model:

- `list_groups` lists remembered aliases and the active alias;
- `select_group` changes the active group for later reads and preparations;
- read tools no longer accept a `group` argument;
- direct create tools are replaced by `prepare_expense`,
  `prepare_reimbursement`, and `commit_draft`;
- group credentials and drafts are encrypted inside a SQLite Durable Object;
- the old `SPLIIT_GROUPS_JSON` secret is imported once for a safe upgrade.

Prepared drafts contain an immutable encrypted copy of their target. Selecting
another group before `commit_draft` cannot redirect the write.

## Install with an AI coding agent (recommended)

Give a trusted coding agent terminal and browser access, then paste:

```text
Install Spliit MCP from https://github.com/kegelmeier/spliit-mcp-cloudflare
into my Cloudflare account. Read AGENTS.md and docs/agentic-install.md completely
before acting. Keep writes disabled. Never ask me to paste a Spliit group URL
into chat, a command argument, source control, or logs. Use Wrangler's
interactive Cloudflare login. Generate separate 32-byte MCP and admin tokens
and a 32-byte data-encryption key without displaying them. Deploy with an empty
SPLIIT_GROUPS_JSON bootstrap value, validate /healthz and authentication, then
give me the /setup URL so I can add group links privately in my browser.
Configure one Streamable HTTP MCP connection with an environment-backed bearer
token. Stop before enabling writes.
```

Existing 0.x deployments need the upgrade variant in
[Agentic installation](docs/agentic-install.md#upgrade-an-existing-0x-deployment).

## Other installation paths

- [Terminal installation](docs/terminal-install.md)
- [Cloudflare and MCP client UI](docs/ui-install.md)
- [MCP client setup](docs/mcp-clients.md)
- [Troubleshooting](docs/troubleshooting.md)

## Tools

| Tool | Default | Purpose |
| --- | --- | --- |
| `list_groups` | Read-only | List aliases and show which one is active |
| `select_group` | State change | Remember the active alias |
| `get_group` | Read-only | Read active-group metadata and participants |
| `get_balances` | Read-only | Read balances and suggested reimbursements |
| `list_expenses` | Read-only | Page and filter active-group expenses |
| `get_expense` | Read-only | Read one active-group expense |
| `list_categories` | Read-only | Read categories from the active Spliit host |
| `list_activities` | Read-only | Read recent active-group activity |
| `prepare_expense` | Opt-in | Validate and store an expiring group-bound draft |
| `prepare_reimbursement` | Opt-in | Validate and store an expiring group-bound draft |
| `commit_draft` | Opt-in | Commit a prepared draft exactly to its bound group |

Write tools are absent unless `WRITES_ENABLED` is set to `"true"` and the
Worker is redeployed. There are no update or delete tools.

## Configuration

Four encrypted Worker secrets are required:

| Name | Purpose |
| --- | --- |
| `MCP_AUTH_TOKEN` | Bearer token used by the MCP client; at least 32 characters |
| `ADMIN_TOKEN` | Different bearer token used only by `/setup` |
| `DATA_ENCRYPTION_KEY` | Exactly 64 hexadecimal characters used for AES-256-GCM |
| `SPLIIT_GROUPS_JSON` | Import-only 0.x migration value; use `[]` on a new install |

Do not change `DATA_ENCRYPTION_KEY` after groups are stored. There is no
automatic key-rotation migration in version 1.

Non-secret variables live in `wrangler.jsonc`:

| Name | Default | Meaning |
| --- | --- | --- |
| `WRITES_ENABLED` | `false` | Registers prepare and commit tools when true |
| `SPLIIT_TIMEOUT_MS` | `15000` | Upstream timeout, 1,000–30,000 ms |
| `DRAFT_TTL_SECONDS` | `600` | Draft lifetime, 60–3,600 seconds |
| `ALLOWED_SPLIIT_HOSTNAMES` | `spliit.app` | Exact outbound Spliit hostname allowlist |
| `ALLOWED_HOSTNAMES` | empty | Optional inbound Worker hostname allowlist |

Self-hosted Spliit installations must be explicitly added to
`ALLOWED_SPLIIT_HOSTNAMES` before their links can be stored.

## Security and persistence

- `/mcp` and `/admin` use separate bearer tokens.
- The MCP client receives aliases, never stored group URLs or IDs.
- Group records, draft payloads, and completed draft results are encrypted with
  AES-256-GCM and record-specific associated data before SQLite persistence.
- The setup page is same-origin, non-cacheable, frame-protected, and stores the
  admin token only in the current page's memory.
- One-time draft claims prevent concurrent duplicate commits. A completed draft
  is replay-safe. An interrupted ambiguous commit remains locked so the user can
  verify Spliit instead of risking an automatic duplicate.
- MCP transport requests remain stateless; only application state is durable.
- Request tracing is intentionally disabled because Spliit tRPC URLs can contain
  group IDs.

Read [SECURITY.md](SECURITY.md) before deployment.

## Limits and cost

There is no application-level group-count cap. Practical capacity and cost are
bounded by Cloudflare Durable Objects storage/request limits and the Spliit
server. Expense/activity pages remain limited to 50 records and upstream
responses to 2 MiB.

The design is intended to fit ordinary personal use on Cloudflare's Free plan,
but platform limits can change. Check current [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
and [platform limits](https://developers.cloudflare.com/workers/platform/limits/).

## Compatibility and non-goals

- Spliit has no account API for discovering every group; each link is added once
  through setup.
- The Worker calls Spliit's unofficial tRPC procedures. Upstream changes can
  require an update.
- Attachments, recurring creation, custom splits, updates, and deletion are not
  implemented.
- This project is not affiliated with Spliit or Cloudflare.

## Development

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
npm run check
```

Use placeholders only in tracked files and tests. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [Architecture](docs/architecture.md).

## License

[MIT](LICENSE)
