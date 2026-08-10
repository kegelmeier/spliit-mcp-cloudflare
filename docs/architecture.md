# Architecture

The Worker is a stateless authenticated adapter between an MCP client and one
or more Spliit deployments.

```text
MCP client
  │  Streamable HTTP + bearer token
  ▼
Cloudflare Worker /mcp
  ├─ validates MCP_AUTH_TOKEN
  ├─ resolves a safe alias from SPLIIT_GROUPS_JSON
  ├─ enforces read-only/write registration
  └─ calls the configured Spliit tRPC endpoint over HTTPS
       │
       ▼
     Spliit
```

## Trust boundaries

- The MCP client knows the Worker URL, bearer token, aliases, and returned group
  data. It does not receive configured Spliit URLs or group IDs.
- Cloudflare stores and executes with both Worker secrets.
- Each configured Spliit host receives its group ID and the requested operation.
- GitHub stores source code and placeholders only.

## Request handling

`src/server.ts` creates the Worker-facing MCP server and public health routes.
`src/auth.ts` validates the bearer token and optional hostname allowlist.
`src/config.ts` validates secrets and resolves aliases. `src/tools.ts` registers
the read tools and conditionally registers writes. `src/spliit/client.ts`
contains the bounded, sanitized tRPC client.

There is no database, cache, session store, analytics pipeline, or background
job. Each MCP call reads current data from Spliit.

## Intentional constraints

- Group discovery by Spliit account is impossible because Spliit group links,
  rather than accounts, are the access model.
- The MCP server supports up to 20 explicit group configurations.
- Only evenly split expense creation and reimbursement recording are available
  as mutations.
- Browser CORS is not enabled because this is an MCP client integration, not a
  public browser API.
