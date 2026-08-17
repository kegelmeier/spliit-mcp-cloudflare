# Instructions for coding agents

Read this file and `docs/agentic-install.md` completely before changing or
deploying this project.

## Non-negotiable boundaries

1. Treat group URLs/IDs, participant IDs, bearer tokens, encryption keys, draft
   IDs, and returned private group data as sensitive.
2. Never print them to agent output, logs, chat, screenshots, fixtures, command
   arguments, commits, pull requests, or issues.
3. Never put secrets in `wrangler.jsonc` or another tracked file.
4. Keep `WRITES_ENABLED` `true` by default. Set it to `false` only when the user
   explicitly requests a read-only deployment. Tool availability is not write
   approval: always present the prepared preview and obtain separate approval
   before `commit_draft`.
5. Do not enable request tracing. Spliit tRPC URLs can contain group IDs.
6. Deploy only after the user authenticates the intended Cloudflare account or
   explicitly supplies a scoped CI credential through a secure channel.
7. Never expose `/mcp` without `MCP_AUTH_TOKEN` or `/admin` without a distinct
   `ADMIN_TOKEN`.
8. Never rotate `DATA_ENCRYPTION_KEY` without an explicit data-migration plan.

If a secret appears in output, stop, identify only the class of exposed value,
and tell the user how to rotate or replace it without repeating it.

## New installation contract

The user does not need to give the agent a Spliit group URL. Use this order:

1. Confirm Git state and read the documentation.
2. Verify Node.js 22+, run `npm ci`, and run `npm run check`.
3. Run `npx wrangler whoami`; use interactive `npx wrangler login` if needed.
4. Generate two different random 32-byte bearer tokens plus one 32-byte key
   encoded as 64 hexadecimal characters. Do not display any value.
5. Put them in a mode-0600 file outside the repository, or ignored `.dev.vars`,
   with `SPLIIT_GROUPS_JSON=[]`. Never pass them as command arguments.
6. Deploy using `npx wrangler deploy --secrets-file <secure-file>`.
7. Remove the temporary file unless the user explicitly wants ignored local
   development configuration and has another recovery copy.
8. Validate `/healthz`, missing-token rejection for `/mcp` and `/admin`, and the
   deployment metadata without showing secrets.
9. Give the user `https://WORKER_HOST/setup`. The user enters the admin token
   and group links directly in the browser; the agent does not request them.
10. Configure one Streamable HTTP MCP client with `/mcp` and an
    environment-backed MCP token.
11. Confirm `list_groups`, `select_group`, and an active-group read. Never paste
    returned private contents into chat.
12. Report URLs and validation status, never credentials.

## Upgrade contract for 0.x

Before the first version-1 deployment, preserve the exact existing
`SPLIIT_GROUPS_JSON` value in the secure secrets file. Add the three new secrets,
deploy, and confirm the aliases through the admin endpoint or `list_groups`.
Only after durable import succeeds may `SPLIIT_GROUPS_JSON` be replaced by `[]`.
Do not re-enter or print its contents. Do not deploy version 1 with `[]` first on
an existing deployment or the import will be permanently marked complete.

## Development rules

- Preserve the stateless MCP transport plus SQLite Durable Object boundary.
- Every security, state-machine, migration, or tool-contract change needs a
  regression test.
- Use placeholder domains and IDs in tests.
- Never log request bodies, authorization headers, upstream URLs, or errors that
  might embed them.
- Keep the outbound hostname allowlist and response/body size bounds.
- Generate Worker binding types with Wrangler; do not hand-maintain them.
- Run `npm run check` before handoff.
- Keep the lockfile current.
- Never commit `.dev.vars`, `.env`, secrets files, Wrangler state, credentials,
  logs, or CPU profiles.

## Definition of done

- strict types, tests, startup check, and deployment dry-run pass;
- a SQLite Durable Object migration is present;
- health is 200 with valid secrets;
- unauthenticated MCP/admin requests are rejected;
- setup stores a group without returning its URL/ID;
- active-group reads work through one MCP connection;
- changing active group cannot redirect a prepared draft;
- concurrent or replayed commits cannot create a second automatic mutation;
- write tools are present by default and absent only in explicit read-only mode;
- no draft is committed without preview review and separate approval;
- no secret value appears in source control or the final response.
