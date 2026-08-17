# Terminal installation

Requires macOS or Linux, Git, Node.js 22+, npm, and a browser for Cloudflare
login.

## 1. Clone and validate

```bash
git clone https://github.com/kegelmeier/spliit-mcp-cloudflare.git
cd spliit-mcp-cloudflare
npm ci
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

Generate three independent values in a password manager or with
`openssl rand -hex 32`. Use one as `MCP_AUTH_TOKEN`, a different one as
`ADMIN_TOKEN`, and the third as `DATA_ENCRYPTION_KEY`. Edit `.dev.vars` locally:

```dotenv
MCP_AUTH_TOKEN=REPLACE_WITH_64_RANDOM_HEX_CHARACTERS
ADMIN_TOKEN=REPLACE_WITH_A_DIFFERENT_64_RANDOM_HEX_CHARACTERS
DATA_ENCRYPTION_KEY=REPLACE_WITH_A_THIRD_64_RANDOM_HEX_CHARACTERS
SPLIIT_GROUPS_JSON=[]
```

Do not paste the populated file into chat or shell arguments. It is ignored by
Git. Run:

```bash
npm run check
```

## 2. Authenticate and deploy

```bash
npx wrangler whoami
npx wrangler login
npx wrangler deploy --secrets-file .dev.vars
```

Skip login if `whoami` already shows the intended account. Then check:

```bash
curl --fail --silent --show-error https://YOUR_WORKER_HOST/healthz
```

## 3. Add groups

Open `https://YOUR_WORKER_HOST/setup`. Enter the admin token, a safe alias, the
full Spliit group link, and optionally your participant ID. The participant ID
lets expense preparation choose your participant as the default payer.

The link is validated against `ALLOWED_SPLIIT_HOSTNAMES`, checked against
Spliit, encrypted, and stored. Add any further groups through the same page;
there is no redeploy and no application-level group cap.

For a self-hosted Spliit server, add its exact hostname to the comma-separated
`ALLOWED_SPLIIT_HOSTNAMES` value in `wrangler.jsonc`, run `npm run check`, and
redeploy before using setup.

### Terminal-only setup API

If a browser is unavailable, create two mode-0600 files outside the repository:

- a header file containing `Authorization: Bearer <ADMIN_TOKEN>`;
- a JSON file containing `{"alias":"holiday","url":"FULL_GROUP_URL"}` and
  optional `participantId`.

Then send files rather than secrets as command arguments:

```bash
curl --fail --silent --show-error \
  --header @/SECURE/PATH/admin.headers \
  --header 'Content-Type: application/json' \
  --data-binary @/SECURE/PATH/group.json \
  https://YOUR_WORKER_HOST/admin/groups
```

Delete those temporary files after validation if their values are backed up.

## 4. Connect one MCP client

```bash
codex mcp add spliit \
  --url https://YOUR_WORKER_HOST/mcp \
  --bearer-token-env-var SPLIIT_MCP_TOKEN
```

Make `SPLIIT_MCP_TOKEN` available to the process that launches Codex through an
OS secret manager or environment manager. Restart the client, call
`list_groups`, `select_group`, then `get_group`. Confirm `prepare_expense`,
`prepare_reimbursement`, and `commit_draft` are present without invoking them.

## Upgrade from 0.x

Do not use `[]` for the first version-1 deployment. Copy the exact current
`SPLIIT_GROUPS_JSON` secret into the protected secrets file without printing it,
add `ADMIN_TOKEN` and `DATA_ENCRYPTION_KEY`, and deploy. Make one authenticated
request, confirm all aliases imported, then change the legacy secret to `[]`.
Read the detailed warning in [Agentic installation](agentic-install.md#upgrade-an-existing-0x-deployment).

## Updating version 1

```bash
git pull --ff-only
npm ci
npm run check
npx wrangler deploy
```

Existing secrets and Durable Object data are preserved. Review migrations and
release notes first. Never casually change `DATA_ENCRYPTION_KEY`.
