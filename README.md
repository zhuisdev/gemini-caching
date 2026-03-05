# Gemini Explicit Cache CLI

## 1. Introduction

`gemini-explicit-cache.ts` is a small CLI for Gemini explicit caching workflows:

- create a cache from local text files
- include local image files in the cache seed
- query with an existing cache
- inspect, list, and delete cache entries

It is designed for stable local sources (for example skill docs, prompt files, tool references, and images).

## 2. How To Setup

### Prerequisites

- Runtime: `bun` (recommended), `node`, or `deno`
- API key: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- Use the same Gemini key as OpenClaw, or a key from the same Google project as OpenClaw's Gemini key.

### Setup Steps

1. Go to this folder:

```bash
cd /path/to/gemini-caching
```

2. Create local env file:

```bash
cp .env.example .env
```

3. Edit `.env` and set at least one key:

```dotenv
GEMINI_API_KEY=your_key_here
# or
# GOOGLE_API_KEY=your_key_here
```

4. Optional advanced defaults (recommended: skip for first-time use):

```dotenv
# usually-safe optional defaults
# GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
# GEMINI_MODEL=gemini-3-flash-preview
# GEMINI_CACHE_TTL=1200s
# GEMINI_CACHE_OUT=out/${YYYYMMDD-HHMM}.json

# advanced convenience defaults (usually leave unset)
# GEMINI_CACHE_FILES=./README.md,./SKILL.md,./gemini-explicit-cache.ts,/path/to/image.jpg
# GEMINI_QUERY_PROMPT=Summarize this cache in 8 bullets.
# GEMINI_LIST_PAGE_SIZE=20
# GEMINI_SYSTEM_FILE=./system.txt
# GEMINI_SYSTEM=You are a helpful assistant.
# GEMINI_CACHE_NAME=cachedContents/...
```

The script auto-loads `.env` from the script directory when present.
Supported timestamp placeholders in `.env` values: `${YYYYMMDD-HHMM}`, `${YYYYMMDD_HHMM}`, `${YYYYMMDDHHMM}`, `${YYYYMMDD}`, `${HHMM}`.
`GEMINI_CACHE_FILES`, `GEMINI_QUERY_PROMPT`, `GEMINI_LIST_PAGE_SIZE`, `GEMINI_SYSTEM(_FILE)`, and `GEMINI_CACHE_NAME` are optional convenience variables; most users should leave them unset and pass CLI flags instead.

## 3. How To Use

### Create cache

```bash
bun run ./gemini-explicit-cache.ts create \
  --file ./README.md \
  --file ./SKILL.md \
  --file ./gemini-explicit-cache.ts \
  --file /path/to/image.jpg \
  --display-name my-cache
```

### Create and query immediately

```bash
bun run ./gemini-explicit-cache.ts create \
  --file ./README.md \
  --file ./SKILL.md \
  --file ./gemini-explicit-cache.ts \
  --file /path/to/image.jpg \
  --display-name my-cache \
  --prompt "Summarize key points."
```

### Query existing cache

```bash
bun run ./gemini-explicit-cache.ts query \
  --cache cachedContents/your_cache_id \
  --prompt "What are the main rules?"
```

### Inspect, list, delete

```bash
bun run ./gemini-explicit-cache.ts get --cache cachedContents/your_cache_id
bun run ./gemini-explicit-cache.ts list --page-size 20
bun run ./gemini-explicit-cache.ts delete --cache cachedContents/your_cache_id
```

### JSON output mode

Add `--json` to commands for machine-readable output.
`create` accepts UTF-8 text files and image files (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`).
Image inputs are uploaded to the Gemini Files API and referenced from the cache seed.
Gemini explicit cache has a minimum content size requirement. If create fails with `Cached content is too small`, include more files in the cache input.

## 4. Full CLI Reference

### Script

- `./gemini-explicit-cache.ts`

### Base command

```bash
bun run ./gemini-explicit-cache.ts <command> [options]
```

### Commands

- `create [files...] [--file <path> ...] [--model <id>] [--ttl <duration>] [--display-name <name>] [--system <text> | --system-file <path>] [--prompt <text>] [--out <path>] [--json] [--base-url <url>]`
- `query --cache <cachedContents/...> --prompt <text> [--json] [--base-url <url>]`
- `get --cache <cachedContents/...> [--json] [--base-url <url>]`
- `list [--page-size <n>] [--json] [--base-url <url>]`
- `delete --cache <cachedContents/...> [--json] [--base-url <url>]`
- `help` (also `-h`, `--help`)

### Required inputs and fallbacks

- API key: required via `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `create` file input:
  - positional files and/or repeated `--file` (UTF-8 text and image files)
  - fallback: `GEMINI_CACHE_FILES`
- `query` prompt:
  - `--prompt`
  - fallback: `GEMINI_QUERY_PROMPT`
- cache name for `query/get/delete`:
  - `--cache`
  - fallback: `GEMINI_CACHE_NAME`

### Environment variables

- `GEMINI_API_KEY` / `GOOGLE_API_KEY`: authentication
- `GEMINI_BASE_URL`: API base URL (default `https://generativelanguage.googleapis.com/v1beta`)
- `GEMINI_MODEL`: default model for `create` (default `gemini-3-flash-preview`)
- `GEMINI_CACHE_TTL` or `GEMINI_EXPLICIT_CACHE_TTL`: default TTL for `create` (default `1620s`)
- `GEMINI_CACHE_FILES`: default create file list (comma/newline/semicolon separated; UTF-8 text and image paths)
- `GEMINI_SYSTEM` or `GEMINI_SYSTEM_FILE`: default system instruction (mutually exclusive)
- `GEMINI_CACHE_OUT`: default output path for `create --out`
- `GEMINI_QUERY_PROMPT`: default prompt for `query`
- `GEMINI_CACHE_NAME`: default cache name for `query/get/delete`
- `GEMINI_LIST_PAGE_SIZE`: default page size for `list` (default `20`)

### Value normalization rules

- model:
  - `gemini-3-flash-preview` becomes `models/gemini-3-flash-preview`
  - already-prefixed `models/...` is used as-is
- cache name:
  - `abc123` becomes `cachedContents/abc123`
  - already-prefixed `cachedContents/...` is used as-is
- TTL accepted formats:
  - seconds with suffix: `1620s`
  - minutes with suffix: `27m`
  - hours with suffix: `1h`
  - integer seconds: `300`
- image formats accepted for cache seed files:
  - `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`

### Output behavior

- `create`:
  - prints cache summary in pretty mode
  - prints full JSON when `--json` is set
  - writes JSON file when `--out` (or `GEMINI_CACHE_OUT`) is set
  - includes `textFileCount` and `imageFileCount` in JSON mode
- `query`:
  - pretty mode prints extracted text (plus usage metadata when available)
  - `--json` prints full API response
- `get`, `list`, `delete`:
  - `get` and `list` print JSON
  - `delete` prints `ok: deleted` or `{"ok": true}` with `--json`

## 5. How To Uninstall

1. Delete this skill folder.
2. Remove any exported environment variables from your shell profile.
3. Remove local `.env` if still present.
4. Optional: delete remote caches you created:

```bash
bun run ./gemini-explicit-cache.ts list
bun run ./gemini-explicit-cache.ts delete --cache cachedContents/your_cache_id
```
