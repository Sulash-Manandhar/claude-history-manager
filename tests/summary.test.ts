import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TranscriptItem } from "../src/lib/sessions";
import { condenseForAi, generateAiSummary, quickSummary, readCachedAiSummary } from "../src/lib/summary";
import { PROJECT_ID, SESSION_A, type Sandbox, createSandbox, installFakeCli, transcript, writeSession } from "./helpers";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const ITEMS: TranscriptItem[] = [
  { kind: "user", text: "Fix the login bug", timestamp: at(0) },
  { kind: "assistant", text: "Looking.", timestamp: at(1) },
  { kind: "tool_use", name: "Read", input: '{\n  "file_path": "/repo/src/auth.ts"\n}', timestamp: at(2) },
  { kind: "tool_result", text: "...", isError: false, timestamp: at(3) },
  { kind: "tool_use", name: "Edit", input: '{\n  "file_path": "/repo/src/auth.ts",\n  "old_string": "a"\n}', timestamp: at(4) },
  { kind: "tool_use", name: "Write", input: '{\n  "file_path": "/repo/tests/auth.test.ts"\n}', timestamp: at(5) },
  { kind: "tool_use", name: "Bash", input: '{\n  "command": "bun test"\n}', timestamp: at(6) },
  { kind: "user", text: "thanks", timestamp: at(7) },
  { kind: "assistant", text: "Fixed: the token check was inverted.", timestamp: at(90) },
];

describe("quickSummary", () => {
  test("captures goal, outcome, counts, edited files and duration", () => {
    expect(quickSummary(ITEMS)).toEqual({
      goal: "Fix the login bug",
      outcome: "Fixed: the token check was inverted.",
      prompts: 2,
      replies: 2,
      toolCalls: 4,
      topTools: [
        { name: "Bash", count: 1 },
        { name: "Edit", count: 1 },
        { name: "Read", count: 1 },
        { name: "Write", count: 1 },
      ],
      filesChanged: ["/repo/src/auth.ts", "/repo/tests/auth.test.ts"],
      durationMs: 90_000,
    });
  });

  test("handles an empty transcript", () => {
    expect(quickSummary([])).toMatchObject({ goal: "", outcome: "", toolCalls: 0, durationMs: null });
  });
});

describe("condenseForAi", () => {
  test("keeps only conversation text and trims the middle when too long", () => {
    const long: TranscriptItem[] = Array.from({ length: 200 }, (_, i) => ({
      kind: i % 2 ? "assistant" : "user",
      text: `message ${i} ${"x".repeat(50)}`,
      timestamp: null,
    }));
    const text = condenseForAi(long, 2000);
    expect(text.length).toBeLessThanOrEqual(2100);
    expect(text).toContain("message 0 ");
    expect(text).toContain("message 199 ");
    expect(text).toContain("[… middle of the chat omitted …]");
    expect(condenseForAi(ITEMS, 10_000)).not.toContain("file_path");
  });
});

describe("AI summary", () => {
  let sb: Sandbox;
  beforeEach(async () => {
    sb = await createSandbox();
    await writeSession(sb, SESSION_A, transcript(sb.repo, "Fix the login bug"));
  });
  afterEach(() => sb.cleanup());

  test("runs claude headless without tools or persistence and caches the result", async () => {
    const cli = await installFakeCli(sb);
    expect(await readCachedAiSummary(sb.paths, PROJECT_ID, SESSION_A)).toBeNull();

    const summary = await generateAiSummary(sb.paths, PROJECT_ID, SESSION_A);

    expect(summary).toMatchObject({ text: "- Goal: fix the bug\n- Outcome: fixed", isStale: false });
    const [call] = await cli.calls();
    expect(call).toStartWith("-p ");
    expect(call).toContain("--tools  --no-session-persistence");
    expect(await cli.stdin()).toContain("USER: Fix the login bug");
    expect(await readCachedAiSummary(sb.paths, PROJECT_ID, SESSION_A)).toMatchObject({ text: summary.text });
  });

  test("marks a cached summary stale once the chat grows", async () => {
    await installFakeCli(sb);
    await generateAiSummary(sb.paths, PROJECT_ID, SESSION_A);
    await writeSession(sb, SESSION_A, transcript(sb.repo, "Fix the login bug and more"));
    expect(await readCachedAiSummary(sb.paths, PROJECT_ID, SESSION_A)).toMatchObject({ isStale: true });
  });
});
