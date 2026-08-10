# Terminal installation

This path works on macOS or Linux with Git, Node.js 22 or newer, npm, and a web
browser for Cloudflare authorization.

## 1. Clone and validate

```bash
git clone https://github.com/kegelmeier/spliit-mcp-cloudflare.git
cd spliit-mcp-cloudflare
npm ci
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

Open `.dev.vars` in a local editor. Replace the two placeholder values:

```dotenv
MCP_AUTH_TOKEN=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS
SPLIIT_GROUPS_JSON=[{"alias":"holiday","url":"https://spliit.app/groups/REPLACE_WITH_GROUP_ID","participantId":"OPTIONAL_PARTICIPANT_ID"}]
```

Generate the bearer token with a password manager, or run the following and
immediately save its output in a password manager:

```bash
openssl rand -hex 32
```

Do not paste the real `.dev.vars` contents into chat, shell command arguments,
issues, or commits. The file is ignored by Git.

Run the complete local check:

```bash
npm run check
```

## 2. Authenticate and deploy

```bash
npx wrangler whoami
npx wrangler login
npx wrangler deploy --secrets-file .dev.vars
```

If `whoami` already shows the intended account, skip `login`. The deployment
command uploads both required secrets alongside the code, which is necessary on
the first deployment because `wrangler.jsonc` declares them as required.

Wrangler prints the Worker URL. Check the non-secret health endpoint:

```bash
curl --fail --silent --show-error https://YOUR_WORKER_HOST/healthz
```

The result should report `ok: true`. Keep `.dev.vars` only if you need local
development; otherwise remove it after the token is safely stored elsewhere.

## 3. Connect the MCP client

The endpoint is the Worker URL plus `/mcp`:

```text
https://YOUR_WORKER_HOST/mcp
```

For Codex CLI, load the token into the environment without placing it in the
repository, then add the remote server:

```bash
codex mcp add spliit \
  --url https://YOUR_WORKER_HOST/mcp \
  --bearer-token-env-var SPLIIT_MCP_TOKEN
```

`SPLIIT_MCP_TOKEN` must be available in the environment that launches Codex.
Use your operating system's secret manager or an environment manager rather
than committing it to a shell startup file. See [MCP client setup](mcp-clients.md)
for the equivalent configuration file and UI paths.

## 4. Verify read-only operation

Restart the MCP client, then ask it to:

1. list the configured Spliit group aliases;
2. read the chosen group;
3. show which tools are available.

The two write tools should be absent. Do not enable writes until the read-only
deployment behaves as expected.

## Updating

```bash
git pull --ff-only
npm ci
npm run check
npx wrangler deploy
```

Existing Worker secrets are preserved. Review release notes and configuration
changes before every deployment.
