import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runClaude, runClaudeJson } from "./claudeCli";
import { type AppPaths, HttpError } from "./paths";

export interface InstalledPlugin {
  id: string;
  name: string;
  marketplace: string;
  version: string | null;
  scope: string;
  isEnabled: boolean;
  // Synced (claude.ai org) and project-scoped plugins can't be changed from user scope.
  isManaged: boolean;
  description: string;
  author: string | null;
  homepage: string | null;
  installPath: string;
  installedAt: string | null;
  counts: { skills: number; agents: number; commands: number };
  mcpServers: string[];
}

export interface AvailablePlugin {
  id: string;
  name: string;
  marketplace: string;
  description: string;
  installCount: number;
  isInstalled: boolean;
}

export interface AvailableQuery {
  query: string;
  marketplace: string | null;
  limit: number;
}

export interface Marketplace {
  name: string;
  source: string;
}

interface CliInstalled {
  id: string;
  version?: string;
  scope?: string;
  enabled?: boolean;
  installPath?: string;
  installedAt?: string;
  mcpServers?: Record<string, unknown>;
}

interface CliAvailable {
  pluginId: string;
  name?: string;
  description?: string;
  marketplaceName?: string;
  installCount?: number;
}

interface CliMarketplace {
  name: string;
  source?: string;
  repo?: string;
  url?: string;
  path?: string;
}

interface PluginManifest {
  description?: string;
  author?: { name?: string } | string;
  homepage?: string;
}

const NAME_PART = "[A-Za-z0-9][A-Za-z0-9._-]{0,100}";
const PLUGIN_ID_PATTERN = new RegExp(`^${NAME_PART}(@${NAME_PART})?$`);
const MARKETPLACE_NAME_PATTERN = new RegExp(`^${NAME_PART}$`);
const GITHUB_SHORTHAND_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const SSH_GIT_PATTERN = /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._\/-]+\.git$/;
const MAX_SOURCE_LENGTH = 500;
const USER_SCOPE = ["--scope", "user"];
const AVAILABLE_CACHE_MS = 5 * 60 * 1000;
const MAX_AVAILABLE_LIMIT = 200;
const SLOW_COMMAND_TIMEOUT_MS = 180_000;

function assertPluginId(id: string): void {
  if (!PLUGIN_ID_PATTERN.test(id)) throw new HttpError(400, "Invalid plugin id");
}

function assertMarketplaceName(name: string): void {
  if (!MARKETPLACE_NAME_PATTERN.test(name)) throw new HttpError(400, "Invalid marketplace name");
}

function splitId(id: string): { name: string; marketplace: string } {
  const [name, marketplace = ""] = id.split("@");
  return { name, marketplace };
}

async function countEntries(dir: string, kind: "dirs" | "markdown"): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => (kind === "dirs" ? e.isDirectory() : e.isFile() && e.name.endsWith(".md"))).length;
}

async function readManifest(installPath: string): Promise<PluginManifest> {
  const file = Bun.file(join(installPath, ".claude-plugin", "plugin.json"));
  return (await file.json().catch(() => ({}))) as PluginManifest;
}

async function enrich(raw: CliInstalled): Promise<InstalledPlugin> {
  const installPath = raw.installPath ?? "";
  const [manifest, skills, agents, commands] = await Promise.all([
    readManifest(installPath),
    countEntries(join(installPath, "skills"), "dirs"),
    countEntries(join(installPath, "agents"), "markdown"),
    countEntries(join(installPath, "commands"), "markdown"),
  ]);
  const scope = raw.scope ?? "user";
  const author = typeof manifest.author === "string" ? manifest.author : (manifest.author?.name ?? null);
  return {
    id: raw.id,
    ...splitId(raw.id),
    version: raw.version ?? null,
    scope,
    isEnabled: Boolean(raw.enabled),
    isManaged: scope !== "user",
    description: manifest.description ?? "",
    author,
    homepage: manifest.homepage ?? null,
    installPath,
    installedAt: raw.installedAt ?? null,
    counts: { skills, agents, commands },
    mcpServers: Object.keys(raw.mcpServers ?? {}),
  };
}

export async function listInstalledPlugins(paths: AppPaths): Promise<InstalledPlugin[]> {
  const raw = await runClaudeJson<CliInstalled[]>(paths, ["plugin", "list", "--json"]);
  return Promise.all(raw.map(enrich));
}

let availableCache: { at: number; bin: string; items: CliAvailable[] } | null = null;

async function fetchAvailable(paths: AppPaths): Promise<CliAvailable[]> {
  const cache = availableCache;
  if (cache && cache.bin === paths.claudeBin && Date.now() - cache.at < AVAILABLE_CACHE_MS) return cache.items;
  const data = await runClaudeJson<{ available?: CliAvailable[] }>(paths, ["plugin", "list", "--json", "--available"]);
  availableCache = { at: Date.now(), bin: paths.claudeBin, items: data.available ?? [] };
  return availableCache.items;
}

function invalidateAvailable(): void {
  availableCache = null;
}

export async function listAvailablePlugins(
  paths: AppPaths,
  { query, marketplace, limit }: AvailableQuery,
): Promise<{ total: number; items: AvailablePlugin[] }> {
  const [catalog, installed] = await Promise.all([fetchAvailable(paths), listInstalledPlugins(paths)]);
  const installedIds = new Set(installed.map((p) => p.id));
  const q = query.trim().toLowerCase();
  const matches = catalog
    .filter((p) => !marketplace || p.marketplaceName === marketplace)
    .filter((p) => !q || `${p.pluginId} ${p.description ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0));
  const items = matches.slice(0, Math.min(Math.max(1, limit), MAX_AVAILABLE_LIMIT)).map(
    (p): AvailablePlugin => ({
      id: p.pluginId,
      name: p.name ?? splitId(p.pluginId).name,
      marketplace: p.marketplaceName ?? splitId(p.pluginId).marketplace,
      description: p.description ?? "",
      installCount: p.installCount ?? 0,
      isInstalled: installedIds.has(p.pluginId),
    }),
  );
  return { total: matches.length, items };
}

async function pluginCommand(paths: AppPaths, action: string, id: string): Promise<void> {
  assertPluginId(id);
  await runClaude(paths, ["plugin", action, id, ...USER_SCOPE], { timeoutMs: SLOW_COMMAND_TIMEOUT_MS });
  invalidateAvailable();
}

export function setPluginEnabled(paths: AppPaths, id: string, isEnabled: boolean): Promise<void> {
  return pluginCommand(paths, isEnabled ? "enable" : "disable", id);
}

export const installPlugin = (paths: AppPaths, id: string): Promise<void> => pluginCommand(paths, "install", id);
export const uninstallPlugin = (paths: AppPaths, id: string): Promise<void> => pluginCommand(paths, "uninstall", id);
export const updatePlugin = (paths: AppPaths, id: string): Promise<void> => pluginCommand(paths, "update", id);

function describeSource(m: CliMarketplace): string {
  return m.repo ?? m.url ?? m.path ?? m.source ?? "";
}

export async function listMarketplaces(paths: AppPaths): Promise<Marketplace[]> {
  const raw = await runClaudeJson<CliMarketplace[]>(paths, ["plugin", "marketplace", "list", "--json"]);
  return raw.map((m) => ({ name: m.name, source: describeSource(m) }));
}

function isHttpsUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

// Only remote sources: a browser form must never point the CLI at arbitrary local paths.
export function normalizeMarketplaceSource(input: string): string {
  const source = input.trim();
  const isValid =
    source.length <= MAX_SOURCE_LENGTH &&
    (GITHUB_SHORTHAND_PATTERN.test(source) || SSH_GIT_PATTERN.test(source) || isHttpsUrl(source));
  if (!isValid) throw new HttpError(400, "Enter a GitHub repo (owner/repo), an https:// URL, or a git@ URL");
  return source;
}

export async function addMarketplace(paths: AppPaths, input: string): Promise<Marketplace[]> {
  const source = normalizeMarketplaceSource(input);
  await runClaude(paths, ["plugin", "marketplace", "add", source, ...USER_SCOPE], { timeoutMs: SLOW_COMMAND_TIMEOUT_MS });
  invalidateAvailable();
  return listMarketplaces(paths);
}

export async function removeMarketplace(paths: AppPaths, name: string): Promise<void> {
  assertMarketplaceName(name);
  await runClaude(paths, ["plugin", "marketplace", "remove", name]);
  invalidateAvailable();
}

export async function refreshMarketplaces(paths: AppPaths): Promise<void> {
  await runClaude(paths, ["plugin", "marketplace", "update"], { timeoutMs: SLOW_COMMAND_TIMEOUT_MS });
  invalidateAvailable();
}
