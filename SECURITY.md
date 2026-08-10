# Security

## Treat group links as credentials

Possession of a Spliit group link grants access to that group. Never commit a
real group URL or ID. Do not include one in a bug report, log excerpt,
screenshot, test fixture, pull request, or MCP prompt. The examples in this
repository are placeholders.

If a group link is exposed, create a replacement group in Spliit and migrate
the data; Spliit group IDs cannot be rotated independently. If the MCP bearer
token is exposed, replace the `MCP_AUTH_TOKEN` Worker secret immediately.

## Deployment checklist

1. Keep `WRITES_ENABLED` set to `"false"` until read-only behavior is verified.
2. Use a unique token with at least 32 random characters.
3. Store `MCP_AUTH_TOKEN` and `SPLIIT_GROUPS_JSON` as Worker secrets. For a
   first deployment, use Wrangler's `deploy --secrets-file` support.
4. Set `ALLOWED_HOSTNAMES` after the deployment hostname is known.
5. Do not enable Cloudflare request tracing; Spliit tRPC query URLs contain the
   group ID.
6. Keep dependencies and Wrangler current, and run `npm run check` before each
   deployment.
7. Give the bearer token only to MCP clients you trust to invoke the tools.

Cloudflare Worker secrets are encrypted at rest, but the Worker can read them
at runtime by design. The configured Spliit service receives its group ID on
each API call.

## Reporting a vulnerability

Do not open a public issue containing secrets or reproduction data from a real
group. Use the repository's **Security → Report a vulnerability** flow. If
private vulnerability reporting is unavailable, open a public issue containing
only a request for a private contact channel—never include vulnerability details
or real credentials in that issue.

## Supported versions

Until a stable release exists, only the latest commit on the default branch is
supported.
