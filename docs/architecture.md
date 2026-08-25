# Architecture

One personal Worker serves one MCP client identity and one durable group
registry. The MCP protocol handler remains stateless; business state lives in a
SQLite Durable Object named `primary`, so rotating either bearer token does not
orphan the registry.

```text
Browser /setup -- ADMIN_TOKEN --> Worker admin boundary
                                      |
                                      | validated group configuration
                                      v
MCP client ------ MCP_AUTH_TOKEN --> Worker /mcp
               add link/create group  |
                                      |
                                      | Durable Object RPC
                                      v
                               SQLite Durable Object
                               - encrypted groups
                               - active alias
                               - encrypted drafts/results
                                      |
                                      | active read or draft-bound commit
                                      v
                                    Spliit
```

## State model

The Durable Object creates three SQLite tables:

- `groups`: plaintext safe alias plus AES-GCM encrypted configuration;
- `settings`: the active alias and one-time bootstrap marker;
- `drafts`: safe group alias, status, expiry, and encrypted payload/result.

The `DATA_ENCRYPTION_KEY` Worker secret never enters SQLite. Every encrypted
record uses a random 96-bit IV and record-specific associated data. Updating or
removing a group invalidates pending drafts for that alias.

`SPLIIT_GROUPS_JSON` is an import bridge, not the live registry. On the first
authenticated request, its entries are validated, encrypted, inserted, and a
durable bootstrap marker is written. Later secret changes are not re-imported.

## Active selection and writes

Read tools resolve `getActiveGroup()` for every call. Selection is therefore
shared across reconnects and MCP conversations that use this Worker.

`add_group_from_link` applies the same URL parsing, outbound-host allowlist,
upstream verification, encryption, and durable storage used by the admin
boundary. `create_group` writes to the active group's Spliit host (or public
`spliit.app` for an empty registry), persists the new capability, refreshes its
participants, and selects it. Neither path returns the capability URL or ID.

Write preparation resolves participants and amounts, creates the exact Spliit
mutation input, and encrypts it together with the current group configuration.
`commit_draft` never consults the active alias. It atomically claims the draft,
performs the upstream mutation, then stores an encrypted completion result.
Concurrent claims cannot both proceed; completed calls replay their stored
result. If execution becomes ambiguous after claiming, the draft stays locked.

## Trust boundaries

- The MCP client knows the Worker URL, MCP token, aliases, and Spliit data
  returned by tools. It also sees a link explicitly supplied to
  `add_group_from_link`, but the link is not returned or logged by the Worker.
- The browser setup page receives an admin token and group link in memory.
- Cloudflare executes code with all secrets and stores encrypted application
  data plus unavoidable metadata such as aliases and timestamps.
- Each configured Spliit host receives its group ID and requested operation.
- GitHub stores source and placeholders only.

## Source layout

- `src/server.ts`: HTTP, auth boundaries, bootstrap, configuration validation
- `src/setup.ts`: protected same-origin setup client
- `src/state.ts`: SQLite Durable Object and draft state machine
- `src/crypto.ts`: AES-GCM envelope helpers
- `src/config.ts`: group URL and hostname validation
- `src/tools.ts`: active-group MCP tools and prepare/commit workflow
- `src/spliit/client.ts`: bounded, sanitized tRPC client

## Intentional constraints

- One durable registry exists per Worker deployment, matching the personal-use
  authentication model.
- Group discovery by account is unavailable because Spliit uses group links.
- Only evenly split expenses and reimbursements can be created.
- The browser admin API intentionally has no CORS support.
