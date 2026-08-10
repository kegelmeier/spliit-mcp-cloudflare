# Agentic installation

This is the recommended path when an AI coding agent can use a local terminal
and open Cloudflare's browser login. The repository-level `AGENTS.md` is the
authoritative safety contract.

## What the user supplies

The agent needs only:

- a short alias such as `holiday`;
- the full Spliit group URL;
- optionally, the participant ID representing the user.

The alias is safe to expose to the MCP client. The URL and participant ID should
remain private. The agent generates the separate MCP bearer token.

## Copy-paste prompt

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

If the repository is already cloned, replace the first line with its local path.

## Expected agent actions

The agent should:

1. inspect the project and verify its Git state;
2. install dependencies from the lockfile;
3. validate the code and deployment bundle;
4. authenticate Cloudflare through Wrangler;
5. create a strong, unique bearer token without displaying it;
6. upload both required secrets alongside the first deployment;
7. verify health, authentication rejection, MCP initialization, and read tools;
8. add the remote Streamable HTTP server to the selected MCP client;
9. return the Worker and MCP URLs, but no credentials or Spliit identifiers.

Cloudflare's current Wrangler supports `deploy --secrets-file`, which lets the
first deployment and its required secrets be uploaded together. The secure file
must be ignored or outside the repository and have restrictive permissions.

## Safe agent follow-up prompts

Add another group:

```text
Add one group to my existing Spliit MCP deployment. Preserve the existing secret
entries, do not reveal any group URL or ID, validate the new alias, update only
SPLIIT_GROUPS_JSON, and confirm list_groups returns the alias.
```

Rotate the MCP token:

```text
Rotate MCP_AUTH_TOKEN for my Spliit MCP Worker. Generate it securely, update the
Worker secret and my MCP client, validate the new token, confirm the old token is
rejected, and never print either token.
```

Enable writes only after read-only use has been reviewed:

```text
Review the write-tool implementation and its tests. Explain exactly what
create_expense and create_reimbursement can change. If validation passes, set
WRITES_ENABLED to true, redeploy, and confirm only those two write tools appear.
Do not invoke either write tool during validation.
```

## Acceptance checklist

- The deployment uses the intended Cloudflare account.
- Both required values are Worker secrets, not plaintext variables.
- `WRITES_ENABLED` remains `false`.
- `/healthz` returns HTTP 200.
- `/mcp` rejects missing or incorrect authorization.
- An authenticated MCP client can list safe group aliases and read one group.
- No Spliit URL, group ID, participant ID, or bearer token entered Git history or
  the agent conversation.
