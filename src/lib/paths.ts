import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export interface AppPaths {
  claudeHome: string;
  projectsDir: string;
  dataDir: string;
  trashDir: string;
  backupsDir: string;
  summariesDir: string;
  claudeBin: string;
}

const PROJECT_DIR_PATTERN = /^[A-Za-z0-9._-]+$/;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function resolveAppPaths(env: Record<string, string | undefined> = process.env): AppPaths {
  // CLAUDE_CONFIG_DIR is the same override Claude Code itself honours.
  const claudeHome = resolve(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));
  const dataDir = resolve(env.CHM_DATA_DIR ?? join(import.meta.dir, "..", "..", "data"));
  return {
    claudeHome,
    projectsDir: join(claudeHome, "projects"),
    dataDir,
    trashDir: join(dataDir, "trash"),
    backupsDir: join(dataDir, "backups"),
    summariesDir: join(dataDir, "summaries"),
    claudeBin: env.CLAUDE_BIN ?? "claude",
  };
}

export function isValidProjectDir(name: string): boolean {
  return PROJECT_DIR_PATTERN.test(name) && name !== "." && name !== "..";
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

export function isInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p + sep);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assertProjectDir(name: string): void {
  if (!isValidProjectDir(name)) throw new HttpError(400, "Invalid project id");
}

export function assertSessionId(id: string): void {
  if (!isValidSessionId(id)) throw new HttpError(400, "Invalid session id");
}
