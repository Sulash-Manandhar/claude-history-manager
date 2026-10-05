import { type AppPaths, HttpError } from "./paths";

export interface CliOptions {
  stdin?: string;
  timeoutMs?: number;
  cwd?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ERROR_CHARS = 400;

function lastMeaningfulLine(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, MAX_ERROR_CHARS);
}

// Arguments go to spawn as an array (never through a shell), so callers only need to keep
// values from being parsed as flags; each module validates its ids before calling this.
export async function runClaude(paths: AppPaths, args: string[], options: CliOptions = {}): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([paths.claudeBin, ...args], {
      cwd: options.cwd,
      stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new HttpError(503, "Claude Code CLI not found. Install it, or set CLAUDE_BIN to its path.");
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    if (timedOut) throw new HttpError(504, "Claude Code took too long to respond");
    if (exitCode !== 0) {
      const reason = lastMeaningfulLine(stderr) || lastMeaningfulLine(stdout) || `exit code ${exitCode}`;
      throw new HttpError(502, `claude ${args.slice(0, 2).join(" ")} failed: ${reason}`);
    }
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

export async function runClaudeJson<T>(paths: AppPaths, args: string[]): Promise<T> {
  const stdout = await runClaude(paths, args);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new HttpError(502, `Unexpected output from claude ${args.slice(0, 2).join(" ")}`);
  }
}
