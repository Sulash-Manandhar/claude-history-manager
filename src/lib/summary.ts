import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runClaude } from "./claudeCli";
import { type AppPaths, assertProjectDir, assertSessionId } from "./paths";
import { type TranscriptItem, readSessionMeta, readTranscript } from "./sessions";

export interface QuickSummary {
  goal: string;
  outcome: string;
  prompts: number;
  replies: number;
  toolCalls: number;
  topTools: { name: string; count: number }[];
  filesChanged: string[];
  durationMs: number | null;
}

export interface AiSummary {
  text: string;
  generatedAt: string;
  isStale: boolean;
}

interface CachedSummary {
  key: string;
  text: string;
  generatedAt: string;
}

const GOAL_CHARS = 280;
const OUTCOME_CHARS = 400;
const TOP_TOOL_COUNT = 5;
const MAX_FILES = 20;
const AI_INPUT_CHARS = 60_000;
const AI_MESSAGE_CHARS = 1_500;
const AI_TIMEOUT_MS = 120_000;
const AI_MODEL = "haiku";
const OMITTED_MARKER = "\n\n[… middle of the chat omitted …]\n\n";
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FILE_PATH_PATTERN = /"(?:file_path|notebook_path)":\s*"((?:[^"\\]|\\.)*)"/;

const AI_PROMPT = [
  "Summarize the Claude Code chat transcript provided on stdin for the person who had it.",
  "Reply with at most 5 terse markdown bullets, under 80 words total, in this order:",
  "Goal, What was done, Key decisions, Outcome, Open follow-ups (omit any that don't apply).",
  "No preamble, no headings, no closing remarks.",
].join(" ");

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function editedFile(item: TranscriptItem): string | null {
  if (item.kind !== "tool_use" || !EDIT_TOOLS.has(item.name)) return null;
  const match = item.input.match(FILE_PATH_PATTERN);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    // Tool input is truncated upstream, so an escape sequence can be cut in half.
    return null;
  }
}

function durationOf(items: TranscriptItem[]): number | null {
  const times = items.map((i) => (i.timestamp ? Date.parse(i.timestamp) : Number.NaN)).filter(Number.isFinite);
  return times.length >= 2 ? Math.max(...times) - Math.min(...times) : null;
}

// Instant and offline: built from the transcript structure only, no model involved.
export function quickSummary(items: TranscriptItem[]): QuickSummary {
  const prompts = items.filter((i) => i.kind === "user");
  const replies = items.filter((i) => i.kind === "assistant");
  const toolUses = items.filter((i) => i.kind === "tool_use");

  const toolCounts = new Map<string, number>();
  for (const t of toolUses) toolCounts.set(t.name, (toolCounts.get(t.name) ?? 0) + 1);
  const topTools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_TOOL_COUNT);

  const filesChanged = [...new Set(items.map(editedFile).filter((f): f is string => Boolean(f)))].slice(0, MAX_FILES);

  return {
    goal: clip(prompts[0]?.text ?? "", GOAL_CHARS),
    outcome: clip(replies.at(-1)?.text ?? "", OUTCOME_CHARS),
    prompts: prompts.length,
    replies: replies.length,
    toolCalls: toolUses.length,
    topTools,
    filesChanged,
    durationMs: durationOf(items),
  };
}

// The start (the ask) and end (the result) carry most of the meaning, so the middle is what gets dropped.
export function condenseForAi(items: TranscriptItem[], maxChars = AI_INPUT_CHARS): string {
  const text = items
    .filter((i) => i.kind === "user" || i.kind === "assistant")
    .map((i) => `${i.kind === "user" ? "USER" : "CLAUDE"}: ${clip("text" in i ? i.text : "", AI_MESSAGE_CHARS)}`)
    .join("\n\n");
  if (text.length <= maxChars) return text;
  const half = Math.floor((maxChars - OMITTED_MARKER.length) / 2);
  return `${text.slice(0, half)}${OMITTED_MARKER}${text.slice(-half)}`;
}

function cacheFile(paths: AppPaths, projectId: string, sessionId: string): string {
  assertProjectDir(projectId);
  assertSessionId(sessionId);
  return join(paths.summariesDir, projectId, `${sessionId}.json`);
}

async function freshnessKey(paths: AppPaths, projectId: string, sessionId: string): Promise<string> {
  const meta = await readSessionMeta(join(paths.projectsDir, projectId, `${sessionId}.jsonl`), sessionId);
  return `${meta.updatedAt}:${meta.sizeBytes}`;
}

export async function readCachedAiSummary(
  paths: AppPaths,
  projectId: string,
  sessionId: string,
): Promise<AiSummary | null> {
  const file = Bun.file(cacheFile(paths, projectId, sessionId));
  if (!(await file.exists())) return null;
  const cached = (await file.json().catch(() => null)) as CachedSummary | null;
  if (!cached?.text) return null;
  const key = await freshnessKey(paths, projectId, sessionId);
  return { text: cached.text, generatedAt: cached.generatedAt, isStale: cached.key !== key };
}

export async function generateAiSummary(paths: AppPaths, projectId: string, sessionId: string): Promise<AiSummary> {
  const file = cacheFile(paths, projectId, sessionId);
  const [items, key] = await Promise.all([
    readTranscript(paths, projectId, sessionId),
    freshnessKey(paths, projectId, sessionId),
  ]);
  await mkdir(join(paths.summariesDir, projectId), { recursive: true });
  // No tools and no session persistence: the summary run can't act on anything or add a chat to history.
  const args = ["-p", AI_PROMPT, "--model", AI_MODEL, "--tools", "", "--no-session-persistence", "--strict-mcp-config"];
  const stdout = await runClaude(paths, args, {
    stdin: condenseForAi(items),
    timeoutMs: AI_TIMEOUT_MS,
    cwd: paths.summariesDir,
  });
  const cached: CachedSummary = { key, text: stdout.trim(), generatedAt: new Date().toISOString() };
  await Bun.write(file, JSON.stringify(cached, null, 2));
  return { text: cached.text, generatedAt: cached.generatedAt, isStale: false };
}
