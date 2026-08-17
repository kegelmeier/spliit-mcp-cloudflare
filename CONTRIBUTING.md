# Contributing

Contributions are welcome.

1. Never use a real Spliit group URL, ID, participant name, or expense in tests.
2. Keep reads and the prepare/commit workflow available by default. Gate every
   mutation behind active-group selection, draft claims, encryption boundaries,
   preview review, and separate commit approval. Preserve
   `WRITES_ENABLED=false` as an explicit read-only mode.
3. Sanitize upstream errors and avoid logging request bodies or query URLs.
4. Add regression tests for behavior and security boundaries.
5. Run `npm ci` and `npm run check` before opening a pull request.
6. Keep installation documentation usable by both coding agents and people.

Do not commit `.dev.vars`, `.env`, Wrangler state, build output, or generated
credentials. Keep changes focused; do not add persistent storage unless the
security and cost model is documented first.

## Development setup

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Use placeholder Spliit data in `.dev.vars` unless you are testing a private
deployment. Before submitting a change:

```bash
npm run check
git diff --check
```

Describe security-impacting behavior explicitly in the pull request. Do not
include production logs or MCP responses from a real group.
