# MCP client setup

Use one remote Streamable HTTP endpoint for every remembered group:

```text
https://YOUR_WORKER_HOST/mcp
```

Every request requires `Authorization: Bearer <MCP_AUTH_TOKEN>`. The separate
admin token is never configured in an MCP client.

## Codex CLI

Make the MCP token available to the process that launches Codex, then run:

```bash
codex mcp add spliit \
  --url https://YOUR_WORKER_HOST/mcp \
  --bearer-token-env-var SPLIIT_MCP_TOKEN
```

Check it with `codex mcp list` and `codex mcp get spliit`. Store the environment
value through the operating system's secret manager or an environment manager,
not a repository or generic synchronized document.

## Codex configuration

```toml
[mcp_servers.spliit]
url = "https://YOUR_WORKER_HOST/mcp"
bearer_token_env_var = "SPLIIT_MCP_TOKEN"
default_tools_approval_mode = "writes"
```

Open **Settings → MCP servers** and restart after editing. The `writes` approval
mode allows read tools without prompting while requiring approval for durable
selection and write preparation/commit tools.

## Other clients

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `https://YOUR_WORKER_HOST/mcp` |
| Authentication | Bearer token |
| Token | the value of the Worker's `MCP_AUTH_TOKEN` |

The client must send authorization on every MCP request. Do not disable auth if
the client lacks remote bearer-token support.

## Normal use

1. Call `list_groups`.
2. To import an existing group through MCP, call `add_group_from_link` with its
   full link and optionally an alias, active participant, and `makeActive`.
3. To create a group, call `create_group` with its name, three-letter currency
   code, participant names, and optional active participant/alias. Approve this
   immediate upstream mutation when the MCP client asks.
4. Call `select_group` only when the desired alias is not active.
5. Call read tools without a group argument.
6. For an expense or reimbursement, call a prepare tool and inspect its preview.
7. Approve `commit_draft` with the returned draft ID.

`add_group_from_link` intentionally sends the credential through the MCP client
and model. Use `/setup` instead when that is not acceptable. Neither group tool
returns the stored URL or group ID. A created group becomes active, and its
first supplied participant is the default active participant unless another
participant name is specified.

Selection persists across client reconnects and conversations because this is a
single personal registry. That convenience makes immutable drafts important:
changing selection after preparation does not change a draft's destination.

## Safe verification

After reconnecting, call `list_groups`, select a known alias, and call
`get_group`. Verify aliases and expected data without copying private group
contents into chat, logs, or bug reports.
