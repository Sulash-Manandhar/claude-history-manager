import { lstat, mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { backupFile } from "./docs";
import { type AppPaths, HttpError } from "./paths";

export type SkillSource = "personal" | "plugin";

export interface SkillEntry {
  key: string;
  name: string;
  description: string;
  source: SkillSource;
  pluginId: string | null;
  path: string;
  isEditable: boolean;
  // Symlinked skills are usually shared with other tools (e.g. ~/.agents); edits land there too.
  isSymlink: boolean;
}

export interface SkillContent extends SkillEntry {
  content: string;
}

export interface PluginSkillSource {
  id: string;
  installPath: string;
}

type SkillBase = Pick<SkillEntry, "key" | "source" | "pluginId" | "isEditable" | "isSymlink">;

const SKILL_FILE = "SKILL.md";
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const FRONTMATTER_HEAD_BYTES = 8 * 1024;
const MAX_SKILL_BYTES = 512 * 1024;
const MAX_DESCRIPTION_CHARS = 1024;
const BLOCK_SCALAR_MARKERS = new Set([">", "|", ">-", "|-", ">+", "|+"]);

function unquote(value: string): string {
  const v = value.trim();
  return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
}

// A small subset of YAML: top-level `key: value` pairs plus folded/literal blocks, which is all SKILL.md uses.
export function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(FRONTMATTER_PATTERN);
  if (!match) return {};
  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const pair = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    if (!BLOCK_SCALAR_MARKERS.has(rawValue.trim())) {
      fields[key] = unquote(rawValue);
      continue;
    }
    const block: string[] = [];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
    fields[key] = block.join(" ");
  }
  return fields;
}

async function describeSkill(dir: string, folderName: string, base: SkillBase): Promise<SkillEntry | null> {
  const path = join(dir, folderName, SKILL_FILE);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const meta = parseFrontmatter(await file.slice(0, FRONTMATTER_HEAD_BYTES).text());
  return { ...base, name: meta.name || folderName, description: meta.description ?? "", path };
}

const personalBase = (name: string, isSymlink: boolean): SkillBase => ({
  key: `personal/${name}`,
  source: "personal",
  pluginId: null,
  isEditable: true,
  isSymlink,
});

const pluginBase = (pluginId: string, name: string): SkillBase => ({
  key: `plugin/${pluginId}/${name}`,
  source: "plugin",
  pluginId,
  isEditable: false,
  isSymlink: false,
});

const isPresent = (s: SkillEntry | null): s is SkillEntry => s !== null;

async function personalSkills(paths: AppPaths): Promise<SkillEntry[]> {
  const dir = join(paths.claudeHome, "skills");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const skills = await Promise.all(
    entries
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && SKILL_NAME_PATTERN.test(e.name))
      .map((e) => describeSkill(dir, e.name, personalBase(e.name, e.isSymbolicLink()))),
  );
  return skills.filter(isPresent);
}

async function skillsOfPlugin(plugin: PluginSkillSource): Promise<SkillEntry[]> {
  const dir = join(plugin.installPath, "skills");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const skills = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && SKILL_NAME_PATTERN.test(e.name))
      .map((e) => describeSkill(dir, e.name, pluginBase(plugin.id, e.name))),
  );
  return skills.filter(isPresent);
}

const byName = (a: SkillEntry, b: SkillEntry) => a.name.localeCompare(b.name);

export async function listSkills(paths: AppPaths, plugins: PluginSkillSource[]): Promise<SkillEntry[]> {
  const [personal, ...fromPlugins] = await Promise.all([personalSkills(paths), ...plugins.map(skillsOfPlugin)]);
  return [...[...personal].sort(byName), ...fromPlugins.flatMap((list) => [...list].sort(byName))];
}

// Keys are rebuilt from validated parts, so a crafted key can't reach outside known skill folders.
async function resolveSkill(paths: AppPaths, key: string, plugins: PluginSkillSource[]): Promise<SkillEntry> {
  const [source, ...rest] = key.split("/");
  let found: SkillEntry | null = null;
  if (source === "personal" && rest.length === 1 && SKILL_NAME_PATTERN.test(rest[0])) {
    const info = await lstat(join(paths.claudeHome, "skills", rest[0])).catch(() => null);
    found = await describeSkill(join(paths.claudeHome, "skills"), rest[0], personalBase(rest[0], Boolean(info?.isSymbolicLink())));
  }
  const plugin = source === "plugin" && rest.length === 2 ? plugins.find((p) => p.id === rest[0]) : undefined;
  if (plugin && SKILL_NAME_PATTERN.test(rest[1])) {
    found = await describeSkill(join(plugin.installPath, "skills"), rest[1], pluginBase(plugin.id, rest[1]));
  }
  if (!found) throw new HttpError(404, "Unknown skill");
  return found;
}

export async function readSkill(paths: AppPaths, key: string, plugins: PluginSkillSource[]): Promise<SkillContent> {
  const skill = await resolveSkill(paths, key, plugins);
  return { ...skill, content: await Bun.file(skill.path).text() };
}

async function editableSkill(paths: AppPaths, key: string): Promise<SkillEntry> {
  if (!key.startsWith("personal/")) throw new HttpError(403, "Plugin skills are read-only; edit them in the plugin");
  return resolveSkill(paths, key, []);
}

export async function writeSkill(paths: AppPaths, key: string, content: string): Promise<SkillEntry> {
  if (Buffer.byteLength(content, "utf8") > MAX_SKILL_BYTES) throw new HttpError(413, "SKILL.md is larger than 512KB");
  const skill = await editableSkill(paths, key);
  await backupFile(paths, skill.path);
  await Bun.write(skill.path, content);
  return resolveSkill(paths, key, []);
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_CHARS));
}

export async function createSkill(paths: AppPaths, name: string, description: string): Promise<SkillEntry> {
  if (!SKILL_NAME_PATTERN.test(name)) throw new HttpError(400, "Invalid skill name (letters, numbers, . _ -)");
  const dir = join(paths.claudeHome, "skills", name);
  if (await lstat(dir).catch(() => null)) throw new HttpError(409, `A skill named "${name}" already exists`);
  const summary = yamlString(description || `Describe when Claude should use ${name}`);
  const body = `---\nname: ${name}\ndescription: ${summary}\n---\n\n# ${name}\n\nInstructions for Claude go here.\n`;
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, SKILL_FILE), body);
  return resolveSkill(paths, `personal/${name}`, []);
}

export async function deleteSkill(paths: AppPaths, key: string): Promise<void> {
  const skill = await editableSkill(paths, key);
  const folderName = skill.key.slice("personal/".length);
  const folder = join(paths.claudeHome, "skills", folderName);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(paths.backupsDir, "skills");
  await mkdir(backupDir, { recursive: true });
  // rename() moves a symlink itself, never the shared folder it points to.
  await rename(folder, join(backupDir, `${stamp}__${folderName}`));
}
