# Spliit MCP for Cloudflare Workers

[![CI](https://github.com/kegelmeier/spliit-mcp-cloudflare/actions/workflows/ci.yml/badge.svg)](https://github.com/kegelmeier/spliit-mcp-cloudflare/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kegelmeier/spliit-mcp-cloudflare)

An unofficial, security-focused MCP server that lets an AI assistant read and,
when explicitly enabled, create data in [Spliit](https://spliit.app). It runs as
a stateless Cloudflare Worker and is designed to fit the Workers Free plan for
personal use.

A normal Spliit group link is all it needs. It uses Spliit's existing interface;
no modified Spliit backend, Spliit account, or separate database is required.

> [!IMPORTANT]
> A Spliit group link grants access to the group. Treat it like a password. Put
> it only in a Cloudflare Worker secret, never in source control, screenshots,
> issues, logs, or prompts sent to an untrusted service.

## Install with an AI coding agent (recommended)

Give your agent access to a terminal and a browser, then paste this prompt:

```text
Install Spliit MCP from https://github.com/kegelmeier/spliit-mcp-cloudflare
into my Cloudflare account. Read AGENTS.md and docs/agentic-install.md completely
before acting. Keep writes disabled. Never print, log, commit, or place my Spliit
group URL or MCP bearer token in a command argument. Use Wrangler's interactive
Cloudflare login. Ask me only for a safe group alias, the Spliit group URL, and
optionally my participant ID. Generate a new 32-byte random MCP bearer token,
store both required values as Cloudflare Worker secrets, deploy, validate
/healthz and the read-only MCP tools, and configure my MCP client using an
environment-backed bearer token. Stop before enabling writes.
```

The detailed agent runbook includes security boundaries, success criteria, and
recovery steps: [Agentic installation](docs/agentic-install.md).

## Other installation paths

- [Terminal installation](docs/terminal-install.md) — clone, validate, deploy,
  and connect using explicit commands.
- [Cloudflare and MCP client UI](docs/ui-install.md) — use the deployment button
  and dashboard forms without a local development environment.
- [MCP client setup](docs/mcp-clients.md) — Codex configuration plus a generic
  Streamable HTTP client checklist.
- [Troubleshooting](docs/troubleshooting.md) — common authentication,
  configuration, upstream, and deployment errors.

## Available tools

| Tool | Default | Purpose |
| --- | --- | --- |
| `list_groups` | Read-only | List safe aliases without exposing group links or IDs |
| `get_group` | Read-only | Read group metadata and participants |
| `get_balances` | Read-only | Read balances and suggested reimbursements |
| `list_expenses` | Read-only | Page and filter expenses |
| `get_expense` | Read-only | Read one expense in detail |
| `list_categories` | Read-only | Read the Spliit server's categories |
| `list_activities` | Read-only | Read recent group activity |
| `create_expense` | Opt-in | Create an evenly split expense |
| `create_reimbursement` | Opt-in | Record a reimbursement |

Write tools are not registered unless `WRITES_ENABLED` is changed to `"true"`
and the Worker is redeployed. There are no update or delete tools.

## Configuration

Two encrypted Worker secrets are required:

| Name | Purpose |
| --- | --- |
| `MCP_AUTH_TOKEN` | A unique random bearer token with at least 32 characters |
| `SPLIIT_GROUPS_JSON` | A JSON array containing up to 20 group configurations |

Example structure—replace every placeholder and keep the real value secret:

```json
[
  {
    "alias": "holiday",
    "url": "https://spliit.app/groups/REPLACE_WITH_GROUP_ID",
    "participantId": "OPTIONAL_PARTICIPANT_ID"
  }
]
```

`participantId` is optional for reading. It identifies you in activity records
and is the default payer for `create_expense`. After deployment, `get_group`
returns the participant IDs. Multiple groups may use the same or different
Spliit hosts.

Non-secret variables are defined in `wrangler.jsonc`:

| Name | Default | Meaning |
| --- | --- | --- |
| `WRITES_ENABLED` | `false` | Registers the two write tools when `true` |
| `SPLIIT_TIMEOUT_MS` | `15000` | Upstream timeout, from 1,000 to 30,000 ms |
| `ALLOWED_HOSTNAMES` | empty | Optional comma-separated Worker hostname allowlist |

## Security model

- Every `/mcp` request requires the separate MCP bearer token.
- Spliit group URLs are stored only as encrypted Worker secrets.
- MCP tools accept safe aliases; group links and IDs are never returned.
- Only HTTPS Spliit URLs are accepted.
- Browser CORS is disabled, responses are non-cacheable, and upstream errors
  are sanitized.
- Request tracing is intentionally disabled because Spliit's tRPC query URLs
  contain the group ID.
- No D1, KV, R2, Durable Objects, or other persistent storage is used.

Cloudflare executes the Worker and the configured Spliit host receives the
group ID on each upstream request. This design does not hide those values from
the infrastructure required to process them. Read [SECURITY.md](SECURITY.md)
before deployment.

## Limits and cost

The application limits are 20 configured groups, 50 records per page, a 2 MiB
maximum upstream response, and a configurable 1–30 second Spliit timeout.

Cloudflare currently documents 100,000 requests per day and 10 ms of CPU time
per HTTP request on Workers Free. Waiting for Spliit over the network does not
count as CPU time. Verify the current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [platform limits](https://developers.cloudflare.com/workers/platform/limits/)
before relying on those figures. Normal personal use should be far below the
request allowance.

## Compatibility and non-goals

- Spliit has no account API that discovers all of a person's groups. Each group
  is configured explicitly from its link.
- The Worker calls Spliit's existing, unofficial tRPC procedures. An upstream
  Spliit change may require an update here.
- Attachments, recurring-expense creation, custom split modes, expense updates,
  and expense deletion are intentionally omitted.
- This project is not affiliated with or endorsed by Spliit or Cloudflare.

## Development

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
npm run check
```

Replace the placeholders in `.dev.vars` before running locally. The populated
file is ignored by Git. See [CONTRIBUTING.md](CONTRIBUTING.md) for project rules
and [docs/architecture.md](docs/architecture.md) for the request flow.

## License

[MIT](LICENSE)
