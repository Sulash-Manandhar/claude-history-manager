import { appendFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type AppPaths, HttpError, assertProjectDir, assertSessionId } from "./paths";

export interface SessionMeta {
  id: string;
  title: string;
  firstPrompt: string;
  cwd: string | null;
  gitBranch: string | null;
  startedAt: string | null;
  updatedAt: string;
  sizeBytes: number;
}

export interface ProjectSummary {
  id: string;
  path: string | null;
  label: string;
  sessionCount: number;
  updatedAt: string | null;
  sizeBytes: number;
}

export type TranscriptItem =
  | { kind: "user"; text: string; timestamp: string | null }
  | { kind: "assistant"; text: string; timestamp: string | null }
  | { kind: "tool_use"; name: string; input: string; timestamp: string | null }
  | { kind: "tool_result"; text: string; isError: boolean; timestamp: string | null };

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
}

interface TranscriptLine {
  type?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  aiTitle?: string;
  customTitle?: string;
  summary?: string;
  lastPrompt?: string;
  message?: { content?: string | ContentBlock[] };
}

// Transcripts can exceed 100MB; metadata lives near the start (cwd, first prompt)
// and the end (latest title), so we never read the middle when listing.
const HEAD_BYTES = 128 * 1024;
const TAIL_BYTES = 256 * 1024;
const MAX_TOOL_TEXT = 4000;
const MAX_PROMPT_PREVIEW = 200;

const IDE_NOISE_PATTERN = /<(ide_opened_file|ide_selection|system-reminder)>[\s\S]*?<\/\1>/g;
const COMMAND_NAME_PATTERN = /<command-name>([\s\S]*?)<\/command-name>/;

function parseLines(chunk: string, dropPartialFirst: boolean): TranscriptLine[] {
  const lines = chunk.split("\n");
  if (dropPartialFirst) lines.shift();
  const parsed: TranscriptLine[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      parsed.push(JSON.parse(line) as TranscriptLine);
    } catch {
      // Partial line at a chunk boundary; expected when reading head/tail slices.
    }
  }
  return parsed;
}

export function cleanUserText(raw: string): string {
  const command = raw.match(COMMAND_NAME_PATTERN);
  if (command) return command[1].trim();
  return raw.replace(IDE_NOISE_PATTERN, "").trim();
}

function userTextOf(line: TranscriptLine): string {
  const content = line.message?.content;
  if (typeof content === "string") return cleanUserText(content);
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => cleanUserText(b.text as string))
    .filter(Boolean)
    .join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [${text.length - max} more chars]` : text;
}

export function extractMeta(id: string, head: string, tail: string, headIsWhole: boolean) {
  const headLines = parseLines(head, false);
  const tailLines = headIsWhole ? headLines : parseLines(tail, true);

  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let startedAt: string | null = null;
  let firstPrompt = "";

  for (const line of headLines) {
    cwd ??= line.cwd ?? null;
    gitBranch ??= line.gitBranch ?? null;
    startedAt ??= line.timestamp ?? null;
    if (!firstPrompt && line.type === "user" && !line.isMeta && !line.isSidechain) {
      firstPrompt = userTextOf(line);
    }
  }

  let customTitle = "";
  let aiTitle = "";
  let lastPrompt = "";
  for (const line of tailLines) {
    if (line.type === "custom-title" && line.customTitle) customTitle = line.customTitle;
    if (line.type === "ai-title" && line.aiTitle) aiTitle = line.aiTitle;
    if (line.type === "summary" && line.summary) aiTitle ||= line.summary;
    if (line.type === "last-prompt" && line.lastPrompt) lastPrompt = line.lastPrompt;
  }

  const preview = truncate(firstPrompt || lastPrompt, MAX_PROMPT_PREVIEW);
  return {
    id,
    title: customTitle || aiTitle || preview || "(untitled session)",
    firstPrompt: preview,
    cwd,
    gitBranch,
    startedAt,
  };
}

const metaCache = new Map<string, { key: string; meta: SessionMeta }>();

export async function readSessionMeta(file: string, id: string): Promise<SessionMeta> {
  const info = await stat(file);
  const cacheKey = `${info.mtimeMs}:${info.size}`;
  const cached = metaCache.get(file);
  if (cached?.key === cacheKey) return cached.meta;

  const blob = Bun.file(file);
  const headIsWhole = info.size <= HEAD_BYTES;
  const head = await blob.slice(0, HEAD_BYTES).text();
  const tail = headIsWhole ? "" : await blob.slice(Math.max(0, info.size - TAIL_BYTES)).text();

  const meta: SessionMeta = {
    ...extractMeta(id, head, tail, headIsWhole),
    updatedAt: info.mtime.toISOString(),
    sizeBytes: info.size,
  };
  metaCache.set(file, { key: cacheKey, meta });
  return meta;
}

async function sessionFilesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => e.name.slice(0, -6));
}

export async function listSessions(paths: AppPaths, projectId: string): Promise<SessionMeta[]> {
  assertProjectDir(projectId);
  const dir = join(paths.projectsDir, projectId);
  const ids = await sessionFilesIn(dir).catch(() => {
    throw new HttpError(404, "Project not found");
  });
  const metas = await Promise.all(ids.map((id) => readSessionMeta(join(dir, `${id}.jsonl`), id)));
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function labelFor(id: string, path: string | null): string {
  if (path) return path.split("/").filter(Boolean).slice(-2).join("/");
  return id;
}

export async function listProjects(paths: AppPaths): Promise<ProjectSummary[]> {
  const entries = await readdir(paths.projectsDir, { withFileTypes: true }).catch(() => []);
  const projects = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e): Promise<ProjectSummary> => {
        const sessions = await listSessions(paths, e.name).catch(() => []);
        const path = sessions.find((s) => s.cwd)?.cwd ?? null;
        return {
          id: e.name,
          path,
          label: labelFor(e.name, path),
          sessionCount: sessions.length,
          updatedAt: sessions[0]?.updatedAt ?? null,
          sizeBytes: sessions.reduce((sum, s) => sum + s.sizeBytes, 0),
        };
      }),
  );
  return projects.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export interface RecentSession extends SessionMeta {
  projectId: string;
  projectLabel: string;
}

export async function listRecentSessions(paths: AppPaths, limit: number): Promise<RecentSession[]> {
  const entries = await readdir(paths.projectsDir, { withFileTypes: true }).catch(() => []);
  const perProject = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const sessions = await listSessions(paths, e.name).catch(() => []);
        const label = labelFor(e.name, sessions.find((s) => s.cwd)?.cwd ?? null);
        return sessions.slice(0, limit).map((s) => ({ ...s, projectId: e.name, projectLabel: label }));
      }),
  );
  return perProject
    .flat()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export async function resolveProjectPath(paths: AppPaths, projectId: string): Promise<string | null> {
  const sessions = await listSessions(paths, projectId).catch(() => []);
  return sessions.find((s) => s.cwd)?.cwd ?? null;
}

function sessionFile(paths: AppPaths, projectId: string, sessionId: string): string {
  assertProjectDir(projectId);
  assertSessionId(sessionId);
  return join(paths.projectsDir, projectId, `${sessionId}.jsonl`);
}

function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: ContentBlock) => (c.type === "text" ? (c.text ?? "") : `[${c.type ?? "block"}]`))
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content, null, 2);
}

export function toTranscriptItems(line: TranscriptLine): TranscriptItem[] {
  if (line.isSidechain || line.isMeta) return [];
  const timestamp = line.timestamp ?? null;
  const content = line.message?.content;

  if (line.type === "user") {
    if (typeof content === "string") {
      const text = cleanUserText(content);
      return text ? [{ kind: "user", text, timestamp }] : [];
    }
    if (!Array.isArray(content)) return [];
    return content.flatMap((b): TranscriptItem[] => {
      if (b.type === "tool_result") {
        const text = truncate(stringifyToolContent(b.content), MAX_TOOL_TEXT);
        return [{ kind: "tool_result", text, isError: Boolean(b.is_error), timestamp }];
      }
      const text = b.type === "text" ? cleanUserText(b.text ?? "") : "";
      return text ? [{ kind: "user", text, timestamp }] : [];
    });
  }

  if (line.type === "assistant" && Array.isArray(content)) {
    return content.flatMap((b): TranscriptItem[] => {
      if (b.type === "text" && b.text?.trim()) return [{ kind: "assistant", text: b.text, timestamp }];
      if (b.type === "tool_use") {
        const input = truncate(JSON.stringify(b.input ?? {}, null, 2), MAX_TOOL_TEXT);
        return [{ kind: "tool_use", name: b.name ?? "tool", input, timestamp }];
      }
      return [];
    });
  }
  return [];
}

export async function readTranscript(
  paths: AppPaths,
  projectId: string,
  sessionId: string,
): Promise<TranscriptItem[]> {
  const file = sessionFile(paths, projectId, sessionId);
  const blob = Bun.file(file);
  if (!(await blob.exists())) throw new HttpError(404, "Session not found");

  const items: TranscriptItem[] = [];
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of blob.stream()) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of parseLines(lines.join("\n"), false)) items.push(...toTranscriptItems(line));
  }
  for (const line of parseLines(buffered, false)) items.push(...toTranscriptItems(line));
  return items;
}

export function transcriptToMarkdown(title: string, items: TranscriptItem[]): string {
  const body = items.map((item) => {
    switch (item.kind) {
      case "user":
        return `## User\n\n${item.text}`;
      case "assistant":
        return `## Claude\n\n${item.text}`;
      case "tool_use":
        return `<details><summary>Tool: ${item.name}</summary>\n\n\`\`\`json\n${item.input}\n\`\`\`\n</details>`;
      case "tool_result":
        return `<details><summary>Tool result${item.isError ? " (error)" : ""}</summary>\n\n\`\`\`\n${item.text}\n\`\`\`\n</details>`;
    }
  });
  return [`# ${title}`, ...body].join("\n\n");
}

export async function renameSession(
  paths: AppPaths,
  projectId: string,
  sessionId: string,
  title: string,
): Promise<void> {
  const clean = title.trim();
  if (!clean || clean.length > 200) throw new HttpError(400, "Title must be 1–200 characters");
  const file = sessionFile(paths, projectId, sessionId);
  if (!(await Bun.file(file).exists())) throw new HttpError(404, "Session not found");
  // Same record Claude Code's own /rename appends, so `claude --resume` shows the new name too.
  const record = { type: "custom-title", customTitle: clean, sessionId };
  await appendFile(file, `${JSON.stringify(record)}\n`);
}
