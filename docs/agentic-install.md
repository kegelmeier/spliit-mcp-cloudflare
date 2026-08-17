# Agentic installation

This is the recommended path. The repository `AGENTS.md` is the authoritative
safety contract.

## What the user supplies

The agent needs access to the intended Cloudflare account and the chosen MCP
client. The user adds Spliit links later in the protected browser page, so links
and participant IDs do not need to enter the agent conversation.

## Copy-paste prompt

```text
Install Spliit MCP from https://github.com/kegelmeier/spliit-mcp-cloudflare
into my Cloudflare account. Read AGENTS.md and docs/agentic-install.md completely.
Keep the default prepare/commit write workflow enabled, but do not invoke it
during installation. Never request or expose a Spliit group URL, bearer token,
or encryption key in chat, output, command arguments, logs, or Git. Authenticate
with Wrangler interactively. Generate separate random MCP/admin tokens and a
32-byte hexadecimal data key without displaying them. Deploy with
SPLIIT_GROUPS_JSON=[], validate the boundaries, give me the /setup URL, and
configure one environment-authenticated Streamable HTTP MCP connection. Confirm
the write tools are present without invoking them.
```

## Expected actions

1. Inspect Git state and install locked dependencies.
2. Run the complete local check.
3. Verify the Cloudflare account through Wrangler.
4. Generate three independent 32-byte random values. Encode the encryption key
   as exactly 64 hexadecimal characters.
5. Store the values and `SPLIIT_GROUPS_JSON=[]` in a restrictive temporary
   secrets file outside the repository.
6. Deploy atomically with Wrangler's `--secrets-file` option.
7. Validate root metadata, `/healthz`, and 401 responses at both protected
   boundaries.
8. Return `/setup` to the user. The user privately enters the admin token, a safe
   alias, group URL, and optional participant ID.
9. Configure `<worker-url>/mcp` with an environment-backed MCP bearer token.
10. Verify alias listing, selection, and one read; remove the temporary file.
11. Confirm the three write tools are present without invoking them.

The agent should never invoke a write tool during installation.

## Upgrade an existing 0.x deployment

Use this prompt instead:

```text
Upgrade my existing Spliit MCP Worker to version 1. Read AGENTS.md and the full
upgrade section first. Preserve the existing SPLIIT_GROUPS_JSON secret exactly
and never print or re-enter it. Generate the new distinct ADMIN_TOKEN and
DATA_ENCRYPTION_KEY securely, keep the existing MCP token, run all checks, and
deploy the Durable Object migration. Confirm the old aliases imported into
durable state before replacing SPLIIT_GROUPS_JSON with []. Do not invoke writes
or change the live Worker if any migration check fails.
```

The first authenticated version-1 request writes a permanent bootstrap marker.
Therefore the existing group JSON must be present on that first request. After
aliases are visible in the registry, replacing the legacy secret with `[]` is
safe and does not delete durable groups.

## Safe follow-up prompts

Add groups without exposing links:

```text
Open my Spliit MCP /setup page and let me enter the admin token and group link
myself. Then verify only the safe alias appears through list_groups.
```

Rotate the MCP token:

```text
Rotate MCP_AUTH_TOKEN securely, update my MCP client, confirm the old token is
rejected, and never display either value. Do not change DATA_ENCRYPTION_KEY.
```

Review the default write workflow:

```text
Review the prepare_expense, prepare_reimbursement, and commit_draft contracts
and regression tests. Explain previews, expiry, group binding, replay behavior,
and ambiguous commits. Confirm WRITES_ENABLED=true and those three tools are
present. Do not call commit_draft without a separately approved preview.
```

## Acceptance checklist

- Correct Cloudflare account and Worker URL
- Four required secret names present; no values exposed
- `WRITES_ENABLED=true`
- `/healthz` returns 200
- `/mcp` and `/admin/groups` reject missing authorization
- `/setup` has no-store and anti-framing headers
- One MCP connection lists and selects remembered aliases
- Active-group read returns expected data
- Prepare and commit tools are present but not invoked during installation
- No private value entered Git history or agent output
