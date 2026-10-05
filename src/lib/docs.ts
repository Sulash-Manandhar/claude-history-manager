import { mkdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type AppPaths, HttpError, assertProjectDir, isInside } from "./paths";

export type DocScope = "global" | "project";

export interface DocEntry {
  key: string;
  label: string;
  group: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

export interface DocContent extends DocEntry {
  content: string;
}

const MAX_DOC_BYTES = 1024 * 1024;
const NEW_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/;

interface Candidate {
  key: string;
  label: string;
  group: string;
  path: string;
}

async function describe(c: Candidate): Promise<DocEntry> {
  const info = await stat(c.path).catch(() => null);
  return {
    ...c,
    exists: Boolean(info?.isFile()),
    sizeBytes: info?.size ?? 0,
    updatedAt: info ? info.mtime.toISOString() : null,
  };
}

async function markdownFilesUnder(root: string): Promise<string[]> {
  if (!(await stat(root).catch(() => null))) return [];
  const glob = new Bun.Glob("**/*.md");
  const files: string[] = [];
  for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) files.push(rel);
  return files.sort();
}

async function globalCandidates(paths: AppPaths): Promise<Candidate[]> {
  const rulesDir = join(paths.claudeHome, "rules");
  const rules = await markdownFilesUnder(rulesDir);
  return [
    {
      key: "CLAUDE.md",
      label: "~/.claude/CLAUDE.md",
      group: "Personal instructions",
      path: join(paths.claudeHome, "CLAUDE.md"),
    },
    ...rules.map((rel) => ({
      key: `rules/${rel}`,
      label: rel,
      group: "Personal rules (~/.claude/rules)",
      path: join(rulesDir, rel),
    })),
  ];
}

async function projectCandidates(
  paths: AppPaths,
  projectId: string,
  projectPath: string | null,
): Promise<Candidate[]> {
  assertProjectDir(projectId);
  const memoryDir = join(paths.projectsDir, projectId, "memory");
  const memories = await markdownFilesUnder(memoryDir);
  const repoDocs: Candidate[] = projectPath
    ? [
        { key: "CLAUDE.md", label: "CLAUDE.md", group: "Project instructions", path: join(projectPath, "CLAUDE.md") },
        {
          key: ".claude/CLAUDE.md",
          label: ".claude/CLAUDE.md",
          group: "Project instructions",
          path: join(projectPath, ".claude", "CLAUDE.md"),
        },
        {
          key: "CLAUDE.local.md",
          label: "CLAUDE.local.md (personal, git-ignored)",
          group: "Project instructions",
          path: join(projectPath, "CLAUDE.local.md"),
        },
      ]
    : [];
  return [
    ...repoDocs,
    ...memories.map((rel) => ({
      key: `memory/${rel}`,
      label: rel,
      group: "Auto memory",
      path: join(memoryDir, rel),
    })),
  ];
}

export interface DocTarget {
  scope: DocScope;
  projectId?: string;
  projectPath?: string | null;
}

function candidatesFor(paths: AppPaths, target: DocTarget): Promise<Candidate[]> {
  if (target.scope === "global") return globalCandidates(paths);
  if (!target.projectId) throw new HttpError(400, "projectId is required");
  return projectCandidates(paths, target.projectId, target.projectPath ?? null);
}

export async function listDocs(paths: AppPaths, target: DocTarget): Promise<DocEntry[]> {
  return Promise.all((await candidatesFor(paths, target)).map(describe));
}

// New rule/memory files may be created by name; everything else must already be a known candidate.
function newFileCandidate(paths: AppPaths, target: DocTarget, key: string): Candidate | null {
  const [folder, name, ...rest] = key.split("/");
  if (rest.length || !name || !NEW_FILE_NAME_PATTERN.test(name)) return null;
  if (target.scope === "global" && folder === "rules") {
    return { key, label: name, group: "Personal rules (~/.claude/rules)", path: join(paths.claudeHome, "rules", name) };
  }
  if (target.scope === "project" && folder === "memory" && target.projectId) {
    return { key, label: name, group: "Auto memory", path: join(paths.projectsDir, target.projectId, "memory", name) };
  }
  return null;
}

async function resolveDoc(paths: AppPaths, target: DocTarget, key: string, allowNew: boolean): Promise<Candidate> {
  const known = (await candidatesFor(paths, target)).find((c) => c.key === key);
  const candidate = known ?? (allowNew ? newFileCandidate(paths, target, key) : null);
  if (!candidate) throw new HttpError(404, "Unknown document");

  const allowedRoots = [paths.claudeHome, target.projectPath].filter((p): p is string => Boolean(p));
  if (!allowedRoots.some((root) => isInside(root, candidate.path))) throw new HttpError(403, "Path not allowed");
  return candidate;
}

export async function readDoc(paths: AppPaths, target: DocTarget, key: string): Promise<DocContent> {
  const candidate = await resolveDoc(paths, target, key, false);
  const entry = await describe(candidate);
  const content = entry.exists ? await Bun.file(candidate.path).text() : "";
  return { ...entry, content };
}

export async function backupFile(paths: AppPaths, file: string): Promise<void> {
  const source = Bun.file(file);
  if (!(await source.exists())) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = `${stamp}__${basename(dirname(file))}__${basename(file)}`;
  await mkdir(paths.backupsDir, { recursive: true });
  await Bun.write(join(paths.backupsDir, safeName), source);
}

export async function writeDoc(paths: AppPaths, target: DocTarget, key: string, content: string): Promise<DocEntry> {
  if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) throw new HttpError(413, "Document is larger than 1MB");
  const candidate = await resolveDoc(paths, target, key, true);
  await backupFile(paths, candidate.path);
  await mkdir(dirname(candidate.path), { recursive: true });
  await Bun.write(candidate.path, content);
  return describe(candidate);
}

export async function deleteDoc(paths: AppPaths, target: DocTarget, key: string): Promise<void> {
  const candidate = await resolveDoc(paths, target, key, false);
  if (!(await Bun.file(candidate.path).exists())) throw new HttpError(404, "File does not exist");
  await backupFile(paths, candidate.path);
  await rm(candidate.path);
}
