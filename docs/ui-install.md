# Install with the Cloudflare and MCP client UIs

This path avoids a local development environment. It uses Cloudflare's official
Deploy to Cloudflare flow, which copies the public repository and deploys it
through Workers Builds.

## 1. Prepare the two secret values

Create and save:

- `MCP_AUTH_TOKEN`: at least 32 random characters, unique to this Worker;
- `SPLIIT_GROUPS_JSON`: a one-line JSON array such as the placeholder below.

```json
[{"alias":"holiday","url":"https://spliit.app/groups/REPLACE_WITH_GROUP_ID","participantId":"OPTIONAL_PARTICIPANT_ID"}]
```

Use a password manager to generate and retain the bearer token. Never put these
real values in the copied GitHub repository.

## 2. Deploy in Cloudflare

1. Select [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/kegelmeier/spliit-mcp-cloudflare).
2. Sign in to Cloudflare and authorize the requested GitHub connection.
3. Choose a repository and Worker name, or keep the suggested names.
4. Replace the example values for `MCP_AUTH_TOKEN` and
   `SPLIIT_GROUPS_JSON` with the values prepared above.
5. Leave `WRITES_ENABLED` set to `false`.
6. Start the deployment and wait for Workers Builds to finish.
7. Open `https://YOUR_WORKER_HOST/healthz`. It should return an `ok` result.

Cloudflare's deployment flow discovers required Worker secrets from
`.dev.vars.example`. The source repository contains placeholders only.

If you need to replace a value later, open Cloudflare Dashboard, then:

1. **Workers & Pages** → your Worker;
2. **Settings** → **Variables and Secrets** → **Add**;
3. select the **Secret** type, enter the exact name and value;
4. select **Deploy**.

Do not use the plaintext variable type for either required value. Secret values
cannot be viewed again after they are saved.

## 3. Add the server in an MCP client UI

Codex supports bearer tokens for Streamable HTTP servers. The safest setup is
to source the token from an environment variable instead of saving it directly
in the configuration:

1. make `SPLIIT_MCP_TOKEN` available to the environment that launches Codex;
2. open **Settings** → **Configuration** → **Open config.toml**;
3. add the environment-backed configuration from
   [MCP client setup](mcp-clients.md#codex-configuration-file);
4. open **Settings** → **MCP servers**, confirm `spliit` appears, and select
   **Restart**.

The **Add server** form can add a Streamable HTTP URL directly. If your client
version also exposes a dedicated bearer-token source, select the environment
variable option; otherwise use `config.toml` as above.

Other MCP clients use different labels. Select a remote or Streamable HTTP
server, use the same `/mcp` URL, and set this request header:

```text
Authorization: Bearer YOUR_MCP_AUTH_TOKEN
```

Use a dedicated bearer-token field when the UI offers one. Avoid a generic
plain-text notes field or synchronized document.

## 4. Confirm the result

Ask the client to list Spliit group aliases, then read one group. Confirm that
`create_expense` and `create_reimbursement` are not listed. If the client cannot
connect, use [Troubleshooting](troubleshooting.md).
