# Install with Cloudflare and MCP client UIs

This path uses Cloudflare's Deploy to Cloudflare flow and the Worker's protected
setup page.

## 1. Prepare secrets

Create three independent random 32-byte values in a password manager:

- `MCP_AUTH_TOKEN` for the MCP client;
- `ADMIN_TOKEN` for the setup page;
- `DATA_ENCRYPTION_KEY`, encoded as exactly 64 hexadecimal characters.

The two tokens must differ. Also prepare `SPLIIT_GROUPS_JSON` with the literal
value `[]`. Do not add a group link to the deployment form on a new install.

## 2. Deploy in Cloudflare

1. Open [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/kegelmeier/spliit-mcp-cloudflare).
2. Sign in and authorize the GitHub connection.
3. Choose a repository and Worker name.
4. Add all four values as **Secret**, never plaintext variables.
5. Leave `WRITES_ENABLED` at its `true` default and
   `ALLOWED_SPLIIT_HOSTNAMES` as `spliit.app`.
6. Deploy and wait for Workers Builds.
7. Open `https://YOUR_WORKER_HOST/healthz`; it should report `ok`.

If the deployment form does not expose a required value, open **Workers &
Pages → your Worker → Settings → Variables and Secrets**, add it as a secret,
and deploy again.

## 3. Add groups privately

Open `https://YOUR_WORKER_HOST/setup` on the expected HTTPS hostname. Enter:

- the admin token;
- a safe alias such as `holiday`;
- the full group link;
- optionally, your participant ID.

Select **Add or update group**. The page shows the group name returned by Spliit,
but never displays its stored link or ID. Add more groups the same way. The
token remains only in page memory and is lost on reload.

Use **Select** to set the initial active group. Removing or updating an alias
also invalidates pending drafts bound to that alias.

## 4. Add one MCP server

For Codex, the preferred configuration uses an environment-backed token:

1. expose `SPLIIT_MCP_TOKEN` to the environment that launches Codex;
2. open **Settings → Configuration → Open config.toml**;
3. add the configuration in [MCP client setup](mcp-clients.md);
4. open **Settings → MCP servers** and restart `spliit`.

For another client, choose **Streamable HTTP**, use
`https://YOUR_WORKER_HOST/mcp`, and configure `Authorization: Bearer` through a
dedicated secret/token field. Never remove Worker authentication to accommodate
an incompatible client.

## 5. Verify

Ask the client to list aliases, select one, and read its metadata. Confirm
`prepare_expense`, `prepare_reimbursement`, and `commit_draft` are present, but
do not invoke them during installation.

## Existing 0.x deployment

The UI upgrade must preserve the old `SPLIIT_GROUPS_JSON` for the first version-1
request. Add the new admin/encryption secrets first, deploy, authenticate, and
confirm aliases imported. Only then replace the legacy JSON secret with `[]`.
Deploying the first version-1 request with `[]` permanently completes an empty
bootstrap; use `/setup` to recover by adding links individually.
