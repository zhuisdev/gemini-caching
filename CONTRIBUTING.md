# Contributing

Thanks for contributing to `gemini-caching`.

## Prerequisites

- `bun` (recommended for runtime)
- `deno` (for type checking)
- Gemini API key for optional live API validation (`GEMINI_API_KEY` or `GOOGLE_API_KEY`)

## Local Setup

```bash
cd /path/to/gemini-caching
cp .env.example .env
```

Set your key in `.env` if you want to run live API commands.

## Required Checks Before PR

Run these commands from the repository root:

```bash
deno check ./gemini-explicit-cache.ts
bun run ./gemini-explicit-cache.ts --help
```

## Optional Live API Check

Run a full flow when you want runtime verification:

1. `create` with enough source content
2. `query`
3. `get` or `list`
4. `delete`

Note: Gemini explicit cache has a minimum content-size requirement. If `create` fails with `Cached content is too small`, include more files.

## Pull Request Guidelines

- Keep changes focused and minimal.
- Update `README.md` and `SKILL.md` when behavior changes.
- Do not commit `.env`, cache output artifacts, or secrets.
