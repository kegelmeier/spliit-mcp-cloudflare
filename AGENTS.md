# Instructions for coding agents

This repository is designed to be installed safely by an AI coding agent. Read
this file and `docs/agentic-install.md` completely before changing files or
deploying.

## Non-negotiable security boundaries

1. Treat every Spliit group URL, group ID, participant ID, and MCP bearer token
   as sensitive user data.
2. Never print those values to tool output, logs, chat, screenshots, test
   fixtures, command arguments, commits, pull requests, or issues.
3. Never put secrets in `wrangler.jsonc` or any tracked file.
4. Keep `WRITES_ENABLED` set to `"false"` unless the user separately and
   explicitly asks to enable writes after read-only validation.
5. Do not enable request tracing. Spliit tRPC query URLs contain the group ID.
6. Do not deploy to an account until the user has authenticated that account
   through Wrangler's interactive login or has explicitly supplied a scoped CI
   credential through a secure channel.
7. Do not expose the Worker without `MCP_AUTH_TOKEN`, even temporarily.

If a required secret appears in agent output, stop, tell the user which class of
secret was exposed without repeating its value, rotate the MCP token, and advise
replacement of the affected Spliit group if its link was exposed.

## Agent installation contract

The agent may perform the full installation after the user asks it to deploy
this project. The agent still needs three user-provided values that cannot be
discovered safely: a non-secret alias, the Spliit group URL, and optionally the
user's participant ID.

Use this order:

1. Confirm the repository is clean and read the documentation.
2. Verify Node.js 22+ and install locked dependencies with `npm ci`.
3. Run `npx wrangler whoami`; if needed, start `npx wrangler login` and let the
   user complete Cloudflare's browser authorization.
4. Generate a unique token from 32 random bytes. Do not display it. Save it in
   the user's password manager or environment-secret facility so the MCP client
   can use it later.
5. Build `SPLIIT_GROUPS_JSON` in memory from the user-provided values. Validate
   it without emitting the resulting JSON.
6. Put the two values in a mode-0600 temporary dotenv or JSON file outside the
   repository, or in an already-ignored `.dev.vars` file. Never pass either
   secret as a command-line argument.
7. Run `npm run check`, then perform the first deployment with
   `npx wrangler deploy --secrets-file <secure-file>`. This uploads required
   secrets atomically with the code.
8. Remove the temporary file after deployment unless the user explicitly wants
   to retain an ignored local-development file.
9. Verify the root metadata and `/healthz` without revealing secrets. Configure
   the MCP client with `<worker-url>/mcp` and an environment-backed bearer token.
10. Invoke `list_groups`, then a read-only tool such as `get_group`. Confirm only
    aliases and expected group data are returned. Do not paste private group
    contents into the chat.
11. Report the Worker URL, MCP endpoint, validation result, and where the token
    is stored. Never report the token itself.

## Development rules

- Preserve the stateless design unless a task explicitly requires and documents
  storage.
- Every behavior or security-boundary change needs a regression test.
- Use placeholder domains and IDs in tests.
- Sanitize upstream errors and never log request bodies or upstream URLs.
- Run `npm run check` before handing work back.
- Keep dependencies locked with `package-lock.json`.
- Do not commit `.dev.vars`, `.env`, `.secrets*`, Wrangler state, generated
  credentials, logs, or CPU profiles.

## Definition of done for installation

- `npm run check` passes.
- Cloudflare reports both required secrets configured.
- `GET /healthz` returns HTTP 200.
- Unauthenticated `/mcp` requests are rejected.
- Authenticated MCP initialization succeeds.
- `list_groups` and one group-specific read tool succeed.
- Write tools are absent unless the user explicitly enabled them.
- No secret value appears in source control or the agent's final response.
