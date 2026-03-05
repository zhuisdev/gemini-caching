---
name: "gemini-explicit-cache-test"
description: "Create, query, inspect, list, and delete Gemini explicit cache entries from local files."
---

# Gemini Explicit Cache

Use this skill for Gemini explicit caching on stable local text files.

## Runtime

- Script: `./gemini-explicit-cache.ts`
- Runtime: `bun` (preferred), `node`, or `deno`
- Auth: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- Auto-loads local `./.env` if present
- Defaults: model `gemini-3-flash-preview`, TTL `1620s`

## Agent Workflow

1. Ensure API key is available (`.env` or process env).
2. Create cache:

```bash
bun run ./gemini-explicit-cache.ts create [files...] [--file <path> ...] [--display-name <name>] [--model <id>] [--ttl <duration>] [--out <path>]
```

3. Query cache:

```bash
bun run ./gemini-explicit-cache.ts query --cache <cachedContents/...> --prompt "<text>"
```

4. Inspect/manage cache:

```bash
bun run ./gemini-explicit-cache.ts get --cache <cachedContents/...>
bun run ./gemini-explicit-cache.ts list --page-size 20
bun run ./gemini-explicit-cache.ts delete --cache <cachedContents/...>
```

5. Add `--json` for machine-readable output.

Use `README.md` for full setup and CLI reference.
