import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { type AppPaths, HttpError, assertProjectDir, assertSessionId } from "./paths";
import { listSessions, readSessionMeta } from "./sessions";

export interface TrashEntry {
  projectId: string;
  sessionId: string;
  title: string;
  projectPath: string | null;
  deletedAt: string;
  sizeBytes: number;
}

export interface BulkTrashResult {
  moved: number;
  skippedActive: number;
}

const MANIFEST = "manifest.json";
// A chat written to this recently is probably still open in Claude Code; moving it mid-session would split it.
const ACTIVE_SESSION_WINDOW_MS = 2 * 60 * 1000;

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    // rename() can't cross volumes (e.g. CHM_DATA_DIR on an external disk).
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

// A session is its .jsonl plus an optional sibling folder (tool results, subagent logs).
function sessionParts(base: string, sessionId: string) {
  return { file: join(base, `${sessionId}.jsonl`), folder: join(base, sessionId) };
}

export async function moveToTrash(paths: AppPaths, projectId: string, sessionId: string): Promise<void> {
  assertProjectDir(projectId);
  assertSessionId(sessionId);
  const source = sessionParts(join(paths.projectsDir, projectId), sessionId);
  if (!(await exists(source.file))) throw new HttpError(404, "Session not found");

  const meta = await readSessionMeta(source.file, sessionId);
  const dest = join(paths.trashDir, projectId, sessionId);
  await mkdir(dest, { recursive: true });

  const manifest: TrashEntry = {
    projectId,
    sessionId,
    title: meta.title,
    projectPath: meta.cwd,
    deletedAt: new Date().toISOString(),
    sizeBytes: meta.sizeBytes,
  };
  await Bun.write(join(dest, MANIFEST), JSON.stringify(manifest, null, 2));
  await move(source.file, join(dest, `${sessionId}.jsonl`));
  if (await exists(source.folder)) await move(source.folder, join(dest, sessionId));
}

export async function listTrash(paths: AppPaths): Promise<TrashEntry[]> {
  const projects = await readdir(paths.trashDir).catch(() => [] as string[]);
  const entries: TrashEntry[] = [];
  for (const projectId of projects) {
    const sessions = await readdir(join(paths.trashDir, projectId)).catch(() => [] as string[]);
    for (const sessionId of sessions) {
      const manifest = Bun.file(join(paths.trashDir, projectId, sessionId, MANIFEST));
      if (await manifest.exists()) entries.push((await manifest.json()) as TrashEntry);
    }
  }
  return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

function trashFolder(paths: AppPaths, projectId: string, sessionId: string): string {
  assertProjectDir(projectId);
  assertSessionId(sessionId);
  return join(paths.trashDir, projectId, sessionId);
}

export async function restoreFromTrash(paths: AppPaths, projectId: string, sessionId: string): Promise<void> {
  const folder = trashFolder(paths, projectId, sessionId);
  if (!(await exists(folder))) throw new HttpError(404, "Not in trash");

  const targetBase = join(paths.projectsDir, projectId);
  const target = sessionParts(targetBase, sessionId);
  if (await exists(target.file)) throw new HttpError(409, "A session with this id already exists");

  await mkdir(targetBase, { recursive: true });
  const stored = sessionParts(folder, sessionId);
  await move(stored.file, target.file);
  if (await exists(stored.folder)) await move(stored.folder, target.folder);
  await rm(folder, { recursive: true, force: true });
}

export async function purgeFromTrash(paths: AppPaths, projectId: string, sessionId: string): Promise<void> {
  const folder = trashFolder(paths, projectId, sessionId);
  if (!(await exists(folder))) throw new HttpError(404, "Not in trash");
  await rm(folder, { recursive: true, force: true });
}

export async function moveProjectToTrash(paths: AppPaths, projectId: string): Promise<BulkTrashResult> {
  const sessions = await listSessions(paths, projectId);
  const cutoff = Date.now() - ACTIVE_SESSION_WINDOW_MS;
  const idle = sessions.filter((s) => Date.parse(s.updatedAt) < cutoff);
  // Sequential on purpose: each move is a rename and parallel renames on one volume gain nothing.
  for (const session of idle) await moveToTrash(paths, projectId, session.id);
  return { moved: idle.length, skippedActive: sessions.length - idle.length };
}

export async function restoreProjectFromTrash(paths: AppPaths, projectId: string): Promise<number> {
  assertProjectDir(projectId);
  const entries = (await listTrash(paths)).filter((e) => e.projectId === projectId);
  for (const entry of entries) await restoreFromTrash(paths, projectId, entry.sessionId);
  return entries.length;
}

export async function emptyTrash(paths: AppPaths): Promise<number> {
  const count = (await listTrash(paths)).length;
  await rm(paths.trashDir, { recursive: true, force: true });
  return count;
}
