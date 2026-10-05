import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppPaths, resolveAppPaths } from "../src/lib/paths";

export const SESSION_A = "11111111-1111-4111-8111-111111111111";
export const SESSION_B = "22222222-2222-4222-8222-222222222222";
export const PROJECT_ID = "-tmp-demo-project";

export interface Sandbox {
  root: string;
  paths: AppPaths;
  repo: string;
  cleanup: () => Promise<void>;
}

export async function createSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "chm-test-"));
  const paths = resolveAppPaths({ CLAUDE_CONFIG_DIR: join(root, "claude"), CHM_DATA_DIR: join(root, "data") });
  const repo = join(root, "repo");
  await mkdir(join(paths.projectsDir, PROJECT_ID), { recursive: true });
  await mkdir(repo, { recursive: true });
  return { root, paths, repo, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export function transcript(cwd: string, prompt: string, extra: object[] = []): string {
  const lines = [
    { type: "queue-operation", operation: "enqueue", timestamp: "2026-01-01T00:00:00.000Z" },
    {
      type: "user",
      cwd,
      gitBranch: "main",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: `<ide_opened_file>x</ide_opened_file>${prompt}` }] },
    },
    {
      type: "assistant",
      cwd,
      timestamp: "2026-01-01T00:00:02.000Z",
      message: {
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "Sure, checking." },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    },
    {
      type: "user",
      cwd,
      timestamp: "2026-01-01T00:00:03.000Z",
      message: { content: [{ type: "tool_result", content: "file.txt", is_error: false }] },
    },
    ...extra,
  ];
  return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
}

export async function writeSession(sb: Sandbox, id: string, body: string): Promise<string> {
  const file = join(sb.paths.projectsDir, PROJECT_ID, `${id}.jsonl`);
  await Bun.write(file, body);
  return file;
}

export interface FakeCli {
  dir: string;
  calls: () => Promise<string[]>;
  stdin: () => Promise<string>;
}

// A stand-in `claude` binary: logs each argv line, replays canned JSON, and fails on demand.
export async function installFakeCli(sb: Sandbox, canned: Record<string, unknown> = {}): Promise<FakeCli> {
  const dir = join(sb.root, "fake-cli");
  await mkdir(dir, { recursive: true });
  for (const [name, value] of Object.entries(canned)) await Bun.write(join(dir, `${name}.json`), JSON.stringify(value));
  const script = `#!/bin/sh
printf '%s\\n' "$*" >> "${dir}/calls.log"
case "$*" in
  *FAIL*) echo "Error: simulated failure" >&2; exit 1 ;;
  "plugin list --json") cat "${dir}/installed.json" ;;
  "plugin list --json --available") cat "${dir}/available.json" ;;
  "plugin marketplace list --json") cat "${dir}/marketplaces.json" ;;
  -p*) cat > "${dir}/stdin.txt"; echo "- Goal: fix the bug"; echo "- Outcome: fixed" ;;
  *) echo '{"ok":true}' ;;
esac
`;
  const bin = join(dir, "claude");
  await Bun.write(bin, script);
  await Bun.$`chmod +x ${bin}`;
  sb.paths = { ...sb.paths, claudeBin: bin };
  return {
    dir,
    calls: async () => (await Bun.file(join(dir, "calls.log")).text().catch(() => "")).split("\n").filter(Boolean),
    stdin: () => Bun.file(join(dir, "stdin.txt")).text(),
  };
}
