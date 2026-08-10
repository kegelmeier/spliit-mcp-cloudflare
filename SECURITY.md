# Security

## Treat group links as credentials

Possession of a Spliit group link grants group access. Never commit a real URL,
group ID, participant ID, bearer token, encryption key, draft ID, or private
group content. Do not put those values in prompts, issues, logs, screenshots,
tests, pull requests, or command arguments.

If a group link is exposed, create a replacement group and migrate the data;
the group ID cannot be rotated independently. If a bearer token is exposed,
replace that token in Cloudflare and its clients immediately.

## Secret roles

- `MCP_AUTH_TOKEN` authorizes MCP use.
- `ADMIN_TOKEN` authorizes group setup and removal. It must be different.
- `DATA_ENCRYPTION_KEY` encrypts durable records. Losing it makes stored groups
  and drafts unreadable; changing it without a migration has the same effect.
- `SPLIIT_GROUPS_JSON` is imported once for upgrades. New installs use `[]`.

Use unique random 32-byte values for the first three roles. Store them in a
password manager or secret store. Worker secrets are encrypted by Cloudflare,
but the Worker can read them at runtime by design.

## Deployment checklist

1. Keep `WRITES_ENABLED` `false` until reads are verified.
2. Generate distinct MCP/admin tokens and one 64-character hexadecimal key.
3. Upload all required values through a mode-0600 secrets file or Cloudflare's
   secret UI; never plaintext variables.
4. Keep `ALLOWED_SPLIIT_HOSTNAMES` as narrow as possible.
5. Add links only through `/setup`, over HTTPS, on the expected Worker host.
6. Do not enable request tracing; upstream query URLs contain group IDs.
7. Run `npm run check` before deployment.
8. Give each token only to software or people that need its specific role.

The setup page uses no third-party assets, does not persist the admin token, and
sets CSP, anti-framing, no-referrer, and no-store headers. The admin API validates
and size-limits JSON, accepts only HTTPS group URLs, rejects redirects through
the upstream client, and restricts outbound hosts.

## Write safety

Preparation does not mutate Spliit. It stores an expiring encrypted draft bound
to one group. Commit atomically claims it before contacting Spliit. Successful
drafts return the stored result on replay. Failed upstream requests release the
claim; ambiguous interrupted commits remain locked to avoid automatic duplicate
expenses. Always inspect the preview and approve the commit separately.

Spliit's unofficial create procedure does not expose an idempotency key. No
system can prove exactly-once delivery after every possible network failure;
the locked ambiguous state deliberately favors avoiding duplicates.

## Reporting a vulnerability

Do not open a public issue containing real credentials or group data. Use the
repository's **Security → Report a vulnerability** flow. If private reporting is
unavailable, request a private contact channel without disclosing details.

## Supported versions

Only the latest stable major version and current default branch are supported.
