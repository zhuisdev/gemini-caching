#!/usr/bin/env bun

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_TTL = "1620s"; // 27 minutes
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_ENV_PATH = path.join(SCRIPT_DIR, ".env");

type Command = "create" | "query" | "get" | "list" | "delete" | "help";

type CreateOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  ttl: string;
  displayName?: string;
  systemInstruction?: string;
  filePaths: string[];
  prompt?: string;
  outPath?: string;
  json: boolean;
};

type QueryOptions = {
  apiKey: string;
  baseUrl: string;
  cacheName: string;
  prompt: string;
  json: boolean;
};

type CommonOptions = {
  apiKey: string;
  baseUrl: string;
  cacheName?: string;
  pageSize?: number;
  json: boolean;
};

type FilePayload = {
  displayPath: string;
  sizeBytes: number;
  content: string;
};

function usage(): string {
  return [
    "Gemini Explicit Cache CLI",
    "",
    "Environment:",
    "  GEMINI_API_KEY or GOOGLE_API_KEY",
    "  (auto-loads .env from the script directory if present)",
    "  GEMINI_CACHE_TTL or GEMINI_EXPLICIT_CACHE_TTL (optional default TTL override)",
    "  GEMINI_BASE_URL (optional)",
    "  GEMINI_MODEL (optional default model)",
    "  GEMINI_CACHE_NAME (optional default for query/get/delete)",
    "  GEMINI_CACHE_FILES (optional default files for create; comma-separated)",
    "  GEMINI_SYSTEM_FILE / GEMINI_SYSTEM (optional defaults for create)",
    "  GEMINI_CACHE_OUT (optional default --out path for create)",
    "  GEMINI_QUERY_PROMPT (optional default --prompt for query)",
    "",
    "Commands:",
    "  create [files...] [--file <path> ...] [--model <id>] [--ttl <duration>] [--display-name <name>]",
    "         [--system <text> | --system-file <path>] [--prompt <text>] [--out <path>] [--json]",
    "  query --cache <cachedContents/...> --prompt <text> [--json]",
    "  get --cache <cachedContents/...> [--json]",
    "  list [--page-size <n>] [--json]",
    "  delete --cache <cachedContents/...> [--json]",
    "  help",
    "",
    "TTL format:",
    "  1620s | 27m | 1h | 300 (seconds).",
    "",
    `Defaults: model=${DEFAULT_MODEL}, ttl=${DEFAULT_TTL} (27 minutes).`,
  ].join("\n");
}

function decodeEnvValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
  }
  return trimmed;
}

function parseEnvLine(rawLine: string): { key: string; value: string } | null {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) {
    return null;
  }
  const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
  const equalsIndex = normalized.indexOf("=");
  if (equalsIndex <= 0) {
    return null;
  }
  const key = normalized.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }
  const rawValue = normalized.slice(equalsIndex + 1);
  return { key, value: decodeEnvValue(rawValue) };
}

async function loadLocalEnv(): Promise<void> {
  const content = await readFile(LOCAL_ENV_PATH, "utf8").catch(() => "");
  if (!content) {
    return;
  }
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localDate = new Date(now.getTime() - offset);
  const compact = localDate.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const yyyymmdd = compact.slice(0, 8);
  const hhmm = compact.slice(8, 12);
  const replacements: Record<string, string> = {
    YYYYMMDD_HHMM: `${yyyymmdd}_${hhmm}`,
    "YYYYMMDD-HHMM": `${yyyymmdd}-${hhmm}`,
    YYYYMMDDHHMM: `${yyyymmdd}${hhmm}`,
    YYYYMMDD: yyyymmdd,
    HHMM: hhmm,
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(rawLine);
    if (!parsed) {
      continue;
    }
    let val = parsed.value;
    for (const [k, v] of Object.entries(replacements)) {
      val = val.split(`\${${k}}`).join(v);
    }
    process.env[parsed.key] = val;
  }
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function normalizeModelRef(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    fail("model cannot be empty");
  }
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}

function normalizeCacheName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    fail("cache name cannot be empty");
  }
  return trimmed.startsWith("cachedContents/") ? trimmed : `cachedContents/${trimmed}`;
}

function normalizeTtl(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) {
    fail("ttl cannot be empty");
  }
  if (/^\d+s$/.test(raw)) {
    return raw;
  }
  if (/^\d+m$/.test(raw)) {
    return `${Number.parseInt(raw, 10) * 60}s`;
  }
  if (/^\d+h$/.test(raw)) {
    return `${Number.parseInt(raw, 10) * 3600}s`;
  }
  if (/^\d+$/.test(raw)) {
    return `${raw}s`;
  }
  fail(`invalid ttl "${input}". Use 1620s, 27m, 1h, or seconds integer.`);
}

function resolveConfiguredDefaultTtl(): string {
  const envValue = process.env.GEMINI_CACHE_TTL ?? process.env.GEMINI_EXPLICIT_CACHE_TTL;
  if (!envValue?.trim()) {
    return DEFAULT_TTL;
  }
  return normalizeTtl(envValue);
}

function resolvePathFromEnv(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(SCRIPT_DIR, trimmed);
}

function splitPathList(raw: string): string[] {
  return raw
    .split(/[,\n;]/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolvePathFromEnv(entry));
}

function resolveDefaultCreateFilesFromEnv(): string[] {
  const raw = process.env.GEMINI_CACHE_FILES;
  if (!raw?.trim()) {
    return [];
  }
  return splitPathList(raw);
}

function resolveDefaultCreateSystemFromEnv(): { text?: string; file?: string } {
  const text = process.env.GEMINI_SYSTEM?.trim();
  const file = process.env.GEMINI_SYSTEM_FILE?.trim();
  if (text && file) {
    fail("set only one of GEMINI_SYSTEM or GEMINI_SYSTEM_FILE.");
  }
  return {
    text: text || undefined,
    file: file ? resolvePathFromEnv(file) : undefined,
  };
}

function readApiKey(): string {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    fail("missing API key. Set GEMINI_API_KEY or GOOGLE_API_KEY.");
  }
  return key;
}

function parseFlagMap(args: string[]): { flags: Map<string, string[]>; positionals: string[] } {
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equalsIndex = token.indexOf("=");
    if (equalsIndex >= 0) {
      const key = token.slice(0, equalsIndex);
      const value = token.slice(equalsIndex + 1);
      const existing = flags.get(key) ?? [];
      existing.push(value);
      flags.set(key, existing);
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      const existing = flags.get(token) ?? [];
      existing.push("true");
      flags.set(token, existing);
      continue;
    }
    const existing = flags.get(token) ?? [];
    existing.push(next);
    flags.set(token, existing);
    index += 1;
  }

  return { flags, positionals };
}

function firstFlag(map: Map<string, string[]>, key: string): string | undefined {
  return map.get(key)?.[0];
}

function allFlags(map: Map<string, string[]>, key: string): string[] {
  return map.get(key) ?? [];
}

function parseCommand(argv: string[]): {
  command: Command;
  create?: CreateOptions;
  query?: QueryOptions;
  common?: CommonOptions;
} {
  const rawCommand = argv[0] ?? "help";
  if (rawCommand === "help" || rawCommand === "-h" || rawCommand === "--help") {
    return { command: "help" };
  }
  const command = rawCommand as Command;
  const commandArgs = argv.slice(1);
  const { flags, positionals } = parseFlagMap(commandArgs);
  const json = firstFlag(flags, "--json") === "true";
  const apiKey = readApiKey();
  const baseUrl = firstFlag(flags, "--base-url") ?? process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL;

  if (command === "create") {
    const model = normalizeModelRef(firstFlag(flags, "--model") ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL);
    const ttl = normalizeTtl(firstFlag(flags, "--ttl") ?? resolveConfiguredDefaultTtl());
    const displayName = firstFlag(flags, "--display-name") ?? process.env.GEMINI_CACHE_DISPLAY_NAME;
    const prompt = firstFlag(flags, "--prompt");
    const outPath =
      firstFlag(flags, "--out") ??
      (process.env.GEMINI_CACHE_OUT ? resolvePathFromEnv(process.env.GEMINI_CACHE_OUT) : undefined);
    const envSystemDefaults = resolveDefaultCreateSystemFromEnv();
    const systemText = firstFlag(flags, "--system") ?? envSystemDefaults.text;
    const systemFile = firstFlag(flags, "--system-file") ?? envSystemDefaults.file;
    const cliFilePaths = [...positionals, ...allFlags(flags, "--file")].map((value) => value.trim());
    const filePaths = (cliFilePaths.length > 0 ? cliFilePaths : resolveDefaultCreateFilesFromEnv())
      .map((value) => value.trim())
      .filter(Boolean);

    if (filePaths.length === 0) {
      fail("create requires at least one file (positional, --file, or GEMINI_CACHE_FILES).");
    }
    if (systemText && systemFile) {
      fail("use either --system or --system-file, not both (env included).");
    }

    return {
      command,
      create: {
        apiKey,
        baseUrl,
        model,
        ttl,
        displayName,
        systemInstruction: systemText ?? systemFile,
        filePaths,
        prompt,
        outPath,
        json,
      },
    };
  }

  if (command === "query") {
    const cacheName = normalizeCacheName(firstFlag(flags, "--cache") ?? process.env.GEMINI_CACHE_NAME ?? "");
    const prompt = firstFlag(flags, "--prompt") ?? process.env.GEMINI_QUERY_PROMPT ?? "";
    if (!prompt.trim()) {
      fail("query requires --prompt or GEMINI_QUERY_PROMPT.");
    }
    return {
      command,
      query: {
        apiKey,
        baseUrl,
        cacheName,
        prompt,
        json,
      },
    };
  }

  if (command === "get") {
    const cacheName = normalizeCacheName(firstFlag(flags, "--cache") ?? process.env.GEMINI_CACHE_NAME ?? "");
    return {
      command,
      common: {
        apiKey,
        baseUrl,
        cacheName,
        json,
      },
    };
  }

  if (command === "delete") {
    const cacheName = normalizeCacheName(firstFlag(flags, "--cache") ?? process.env.GEMINI_CACHE_NAME ?? "");
    return {
      command,
      common: {
        apiKey,
        baseUrl,
        cacheName,
        json,
      },
    };
  }

  if (command === "list") {
    const pageSizeRaw = firstFlag(flags, "--page-size") ?? process.env.GEMINI_LIST_PAGE_SIZE ?? "20";
    const pageSize = Number.parseInt(pageSizeRaw, 10);
    if (!Number.isFinite(pageSize) || pageSize <= 0) {
      fail(`invalid --page-size "${pageSizeRaw}"`);
    }
    return {
      command,
      common: {
        apiKey,
        baseUrl,
        pageSize,
        json,
      },
    };
  }

  fail(`unknown command "${command}".\n\n${usage()}`);
}

async function readTextFiles(paths: string[]): Promise<FilePayload[]> {
  const deduped = [...new Set(paths.map((entry) => path.resolve(entry)))];
  const files: FilePayload[] = [];
  for (const absolutePath of deduped) {
    const metadata = await stat(absolutePath).catch(() => null);
    if (!metadata || !metadata.isFile()) {
      fail(`not a readable file: ${absolutePath}`);
    }
    const content = await readFile(absolutePath, "utf8");
    const relativeToCwd = path.relative(process.cwd(), absolutePath);
    const displayPath =
      relativeToCwd && !relativeToCwd.startsWith("..") && !path.isAbsolute(relativeToCwd)
        ? relativeToCwd.split(path.sep).join("/")
        : path.basename(absolutePath);
    files.push({
      displayPath,
      sizeBytes: metadata.size,
      content,
    });
  }
  return files;
}

function buildCachedTextFromFiles(files: FilePayload[]): string {
  const header = [
    "Bundle source: explicit cache seed files",
    `File count: ${files.length}`,
    "",
  ].join("\n");
  const sections = files.map((file, index) => {
    return [
      `## File ${index + 1}: ${file.displayPath}`,
      `size_bytes=${file.sizeBytes}`,
      "",
      file.content,
      "",
    ].join("\n");
  });
  return `${header}${sections.join("\n")}`;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const responseText = await response.text();
  if (!response.ok) {
    let details = responseText;
    try {
      details = JSON.stringify(JSON.parse(responseText), null, 2);
    } catch {
      // keep raw text
    }
    fail(`request failed (${response.status} ${response.statusText})\n${details}`);
  }

  if (!responseText.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    fail(`invalid JSON response: ${responseText.slice(0, 500)}`);
  }
}

async function readSystemInstruction(value?: string): Promise<string | undefined> {
  if (!value?.trim()) {
    return undefined;
  }
  if (value.includes("\n")) {
    return value;
  }
  const maybePath = path.resolve(value);
  const metadata = await stat(maybePath).catch(() => null);
  if (!metadata || !metadata.isFile()) {
    return value;
  }
  return await readFile(maybePath, "utf8");
}

async function createCache(options: CreateOptions) {
  const files = await readTextFiles(options.filePaths);
  const text = buildCachedTextFromFiles(files);
  const systemInstruction = await readSystemInstruction(options.systemInstruction);
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/cachedContents?key=${encodeURIComponent(options.apiKey)}`;

  const body: Record<string, unknown> = {
    model: options.model,
    displayName: options.displayName,
    ttl: options.ttl,
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
  };
  if (systemInstruction?.trim()) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const cache = await requestJson<Record<string, unknown>>(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return { cache, files };
}

async function getCache(options: CommonOptions): Promise<Record<string, unknown>> {
  const cacheName = normalizeCacheName(options.cacheName ?? "");
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/${cacheName}?key=${encodeURIComponent(options.apiKey)}`;
  return await requestJson<Record<string, unknown>>(endpoint, { method: "GET" });
}

async function queryCache(options: QueryOptions): Promise<Record<string, unknown>> {
  const metadata = await getCache({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    cacheName: options.cacheName,
    json: options.json,
  });
  const modelRefRaw = String(metadata.model ?? "");
  const modelRef = normalizeModelRef(modelRefRaw || DEFAULT_MODEL);

  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/${modelRef}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
  return await requestJson<Record<string, unknown>>(endpoint, {
    method: "POST",
    body: JSON.stringify({
      cachedContent: options.cacheName,
      contents: [{ role: "user", parts: [{ text: options.prompt }] }],
    }),
  });
}

async function listCaches(options: CommonOptions): Promise<Record<string, unknown>> {
  const pageSize = options.pageSize ?? 20;
  const endpoint =
    `${options.baseUrl.replace(/\/+$/, "")}/cachedContents` +
    `?pageSize=${encodeURIComponent(String(pageSize))}` +
    `&key=${encodeURIComponent(options.apiKey)}`;
  return await requestJson<Record<string, unknown>>(endpoint, { method: "GET" });
}

async function deleteCache(options: CommonOptions): Promise<void> {
  const cacheName = normalizeCacheName(options.cacheName ?? "");
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/${cacheName}?key=${encodeURIComponent(options.apiKey)}`;
  await requestJson<Record<string, unknown>>(endpoint, { method: "DELETE" });
}

function pluckText(response: Record<string, unknown>): string {
  const candidates = response.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "";
  }
  const first = candidates[0] as Record<string, unknown>;
  const content = first.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .map((part) => {
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text: unknown }).text);
      }
      return "";
    })
    .join("\n")
    .trim();
}

async function writeOptionalJson(pathToWrite: string | undefined, value: unknown): Promise<void> {
  if (!pathToWrite) {
    return;
  }
  const resolved = path.resolve(pathToWrite);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function printPrettyCreateResult(params: {
  cache: Record<string, unknown>;
  files: FilePayload[];
  ttl: string;
  followup?: Record<string, unknown>;
}) {
  console.log(`cache.name=${String(params.cache.name ?? "")}`);
  console.log(`cache.model=${String(params.cache.model ?? "")}`);
  console.log(`cache.expire_time=${String(params.cache.expireTime ?? "")}`);
  console.log(`cache.ttl_requested=${params.ttl}`);
  console.log(`cache.file_count=${params.files.length}`);
  console.log(`cache.file_bytes_total=${params.files.reduce((sum, file) => sum + file.sizeBytes, 0)}`);
  const usageMetadata = params.cache.usageMetadata;
  if (usageMetadata && typeof usageMetadata === "object") {
    console.log(`cache.usage_metadata=${JSON.stringify(usageMetadata)}`);
  }
  if (!params.followup) {
    return;
  }
  const text = pluckText(params.followup);
  console.log("");
  console.log("query.response_text:");
  console.log(text || "(no text returned)");
  const queryUsage = params.followup.usageMetadata;
  if (queryUsage && typeof queryUsage === "object") {
    console.log("");
    console.log(`query.usage_metadata=${JSON.stringify(queryUsage)}`);
  }
}

async function main() {
  await loadLocalEnv();
  const parsed = parseCommand(process.argv.slice(2));
  if (parsed.command === "help") {
    console.log(usage());
    return;
  }

  if (parsed.command === "create" && parsed.create) {
    const { cache, files } = await createCache(parsed.create);
    let followup: Record<string, unknown> | undefined;
    if (parsed.create.prompt?.trim()) {
      followup = await queryCache({
        apiKey: parsed.create.apiKey,
        baseUrl: parsed.create.baseUrl,
        cacheName: String(cache.name ?? ""),
        prompt: parsed.create.prompt,
        json: parsed.create.json,
      });
    }
    const output = {
      command: "create",
      request: {
        model: parsed.create.model,
        ttl: parsed.create.ttl,
        displayName: parsed.create.displayName ?? null,
        fileCount: files.length,
      },
      cache,
      followupQuery: followup ?? null,
    };
    await writeOptionalJson(parsed.create.outPath, output);
    if (parsed.create.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    printPrettyCreateResult({
      cache,
      files,
      ttl: parsed.create.ttl,
      followup,
    });
    if (parsed.create.outPath) {
      console.log(`\nwritten=${path.resolve(parsed.create.outPath)}`);
    }
    return;
  }

  if (parsed.command === "query" && parsed.query) {
    const response = await queryCache(parsed.query);
    if (parsed.query.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(pluckText(response) || "(no text returned)");
    const usage = response.usageMetadata;
    if (usage && typeof usage === "object") {
      console.log(`\nusage_metadata=${JSON.stringify(usage)}`);
    }
    return;
  }

  if (parsed.command === "get" && parsed.common) {
    const response = await getCache(parsed.common);
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (parsed.command === "list" && parsed.common) {
    const response = await listCaches(parsed.common);
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (parsed.command === "delete" && parsed.common) {
    await deleteCache(parsed.common);
    if (parsed.common.json) {
      console.log(JSON.stringify({ ok: true }, null, 2));
    } else {
      console.log("ok: deleted");
    }
    return;
  }

  fail(`unsupported command combination\n\n${usage()}`);
}

await main();
