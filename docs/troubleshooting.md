# Troubleshooting

## Deployment says required secrets are missing

The first deployment must upload the two required secrets with the code:

```bash
npx wrangler deploy --secrets-file .dev.vars
```

Confirm `.dev.vars` contains both `MCP_AUTH_TOKEN` and `SPLIIT_GROUPS_JSON`, is
ignored by Git, and is not printed to the terminal. For an existing Worker,
`npx wrangler secret list` shows secret names but not values.

## `/healthz` returns an error

The endpoint validates configuration without contacting Spliit. Common causes:

- bearer token shorter than 32 characters;
- malformed `SPLIIT_GROUPS_JSON`;
- duplicate or invalid aliases;
- a non-HTTPS group URL;
- more than 20 groups;
- a Worker hostname blocked by `ALLOWED_HOSTNAMES`.

Correct the relevant Worker secret or configuration and redeploy. Do not share
the health response together with private configuration values.

## MCP returns 401 Unauthorized

- Confirm the client uses the `/mcp` path, not only the Worker root.
- Confirm it sends `Authorization: Bearer <token>` on every MCP request.
- Make sure the client and Worker use the same token.
- Restart the client after changing its environment.
- If uncertain, rotate the token instead of copying it through extra tools.

## MCP returns 403 Forbidden

The request hostname does not match `ALLOWED_HOSTNAMES`. Use the exact deployed
hostname or clear the allowlist and redeploy while diagnosing.

## A group alias is unknown

Aliases are case-sensitive after normalization and must match the configured
entry. Call `list_groups` to see safe aliases. Never use or ask the agent to
return a raw group ID.

## Spliit requests fail upstream

The MCP server uses Spliit's existing unofficial tRPC interface. Check that the
group still opens in Spliit's web application. An upstream Spliit deployment
can change procedures or response shapes; check this repository for updates.
Sanitized MCP errors intentionally omit the private upstream URL and group ID.

## A write tool is missing

This is expected by default. `create_expense` and `create_reimbursement` are
registered only when `WRITES_ENABLED` is `"true"` at deployment time. Review
their behavior and enable them deliberately; do not enable writes merely to
test connectivity.

## Cloudflare build fails after dashboard deployment

- Confirm the Worker name matches the `name` in `wrangler.jsonc`.
- Use `npm ci` and `npx wrangler deploy` as the install/deploy commands.
- Confirm both required secrets were supplied in the deployment form.
- Open the Workers Builds log, but redact any private values before sharing it.

## A secret was exposed

If the MCP token was exposed, replace `MCP_AUTH_TOKEN` in Cloudflare and every
client immediately. If a Spliit group link or group ID was exposed, the ID
cannot be rotated independently; create a replacement group and migrate the
data. Remove the secret from public history, logs, screenshots, and issues, but
assume it was copied before removal.
