# MCP client setup

The Worker exposes a remote Streamable HTTP MCP endpoint at:

```text
https://YOUR_WORKER_HOST/mcp
```

Every request requires `Authorization: Bearer <MCP_AUTH_TOKEN>`.

## Codex CLI

Make the token available to the process that launches Codex, then run:

```bash
codex mcp add spliit \
  --url https://YOUR_WORKER_HOST/mcp \
  --bearer-token-env-var SPLIIT_MCP_TOKEN
```

Check the registration:

```bash
codex mcp list
codex mcp get spliit
```

The environment variable is deliberately named differently from the Worker
secret. Its value is the same bearer token, but it belongs in the client host's
secret storage, not in this repository.

## Codex configuration file

The equivalent user-level configuration is:

```toml
[mcp_servers.spliit]
url = "https://YOUR_WORKER_HOST/mcp"
bearer_token_env_var = "SPLIIT_MCP_TOKEN"
default_tools_approval_mode = "writes"
```

`default_tools_approval_mode = "writes"` permits read tools without prompting
while still requiring approval for mutating tools if writes are later enabled.
The named environment variable must exist before Codex starts.

## Codex UI

Open **Settings** → **Configuration** → **Open config.toml**, add the
environment-backed configuration above, then open **Settings** → **MCP
servers**. Confirm `spliit` appears and select **Restart**. Codex shares this MCP
configuration across the desktop app, CLI, and IDE extension on the same host.

The **Add server** form can add a Streamable HTTP URL directly. If the installed
client version exposes an environment-backed bearer-token source, it can be used
instead of editing `config.toml`; do not save the token in a generic notes field.

## Other clients

Use these settings:

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `https://YOUR_WORKER_HOST/mcp` |
| Authentication | Bearer token |
| Token | the value stored as `MCP_AUTH_TOKEN` in Cloudflare |

If a client cannot attach an Authorization header to a remote Streamable HTTP
server, it is not compatible with this deployment's authentication model. Do
not remove authentication to accommodate it.

## Safe verification

After reconnecting, run `list_groups`. It should return aliases only. Then call
`get_group` with an alias. Keep writes disabled until both calls work and the
returned data matches the intended group.
