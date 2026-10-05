import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HttpError, isInside, isValidProjectDir, isValidSessionId } from "../src/lib/paths";
import {
  cleanUserText,
  extractMeta,
  listProjects,
  listSessions,
  readTranscript,
  renameSession,
  transcriptToMarkdown,
} from "../src/lib/sessions";
import { PROJECT_ID, SESSION_A, SESSION_B, type Sandbox, createSandbox, transcript, writeSession } from "./helpers";

let sb: Sandbox;
beforeEach(async () => {
  sb = await createSandbox();
});
afterEach(() => sb.cleanup());

describe("path validation", () => {
  test("rejects traversal in project and session ids", () => {
    expect(isValidProjectDir("..")).toBe(false);
    expect(isValidProjectDir("a/b")).toBe(false);
    expect(isValidProjectDir("-Users-me-repo")).toBe(true);
    expect(isValidSessionId("../../etc/passwd")).toBe(false);
    expect(isValidSessionId(SESSION_A)).toBe(true);
  });

  test("isInside does not match sibling prefixes", () => {
    expect(isInside("/a/b", "/a/b/c.md")).toBe(true);
    expect(isInside("/a/b", "/a/bc/d.md")).toBe(false);
    expect(isInside("/a/b", "/a/b/../x.md")).toBe(false);
  });
});

describe("cleanUserText", () => {
  test("strips IDE context tags and keeps the real prompt", () => {
    expect(cleanUserText("<ide_selection>code</ide_selection>fix this")).toBe("fix this");
  });

  test("shows slash commands by name", () => {
    expect(cleanUserText("<command-message>x</command-message><command-name>/review</command-name>")).toBe("/review");
  });
});

describe("extractMeta", () => {
  test("prefers custom title over ai title over first prompt", () => {
    const body = transcript("/repo", "hello there", [
      { type: "ai-title", aiTitle: "AI name" },
      { type: "custom-title", customTitle: "My name" },
    ]);
    const meta = extractMeta(SESSION_A, body, "", true);
    expect(meta.title).toBe("My name");
    expect(meta.firstPrompt).toBe("hello there");
    expect(meta.cwd).toBe("/repo");
    expect(meta.gitBranch).toBe("main");
  });

  test("falls back to first prompt when no title exists", () => {
    expect(extractMeta(SESSION_A, transcript("/repo", "only prompt"), "", true).title).toBe("only prompt");
  });
});

describe("listing", () => {
  test("lists sessions newest first and derives project path from cwd", async () => {
    await writeSession(sb, SESSION_A, transcript(sb.repo, "first"));
    await Bun.sleep(10);
    await writeSession(sb, SESSION_B, transcript(sb.repo, "second"));

    const sessions = await listSessions(sb.paths, PROJECT_ID);
    expect(sessions.map((s) => s.id)).toEqual([SESSION_B, SESSION_A]);

    const [project] = await listProjects(sb.paths);
    expect(project.path).toBe(sb.repo);
    expect(project.sessionCount).toBe(2);
  });

  test("404s for unknown project", async () => {
    await expect(listSessions(sb.paths, "-nope")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("readTranscript", () => {
  test("turns lines into user, assistant, tool_use and tool_result items", async () => {
    await writeSession(sb, SESSION_A, transcript(sb.repo, "hi"));
    const items = await readTranscript(sb.paths, PROJECT_ID, SESSION_A);
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant", "tool_use", "tool_result"]);
    expect(items[0]).toMatchObject({ kind: "user", text: "hi" });
  });

  test("skips sidechain and meta lines", async () => {
    const extra = [
      { type: "user", isSidechain: true, message: { content: "subagent" } },
      { type: "user", isMeta: true, message: { content: "meta" } },
    ];
    await writeSession(sb, SESSION_A, transcript(sb.repo, "hi", extra));
    const texts = (await readTranscript(sb.paths, PROJECT_ID, SESSION_A)).map((i) => ("text" in i ? i.text : ""));
    expect(texts).not.toContain("subagent");
    expect(texts).not.toContain("meta");
  });

  test("exports markdown with headings", async () => {
    await writeSession(sb, SESSION_A, transcript(sb.repo, "hi"));
    const md = transcriptToMarkdown("T", await readTranscript(sb.paths, PROJECT_ID, SESSION_A));
    expect(md).toStartWith("# T");
    expect(md).toContain("## User\n\nhi");
  });
});

describe("renameSession", () => {
  test("appends a custom-title record that becomes the listed title", async () => {
    await writeSession(sb, SESSION_A, transcript(sb.repo, "hi"));
    await renameSession(sb.paths, PROJECT_ID, SESSION_A, "  Renamed  ");
    const [session] = await listSessions(sb.paths, PROJECT_ID);
    expect(session.title).toBe("Renamed");
  });

  test("rejects empty titles", async () => {
    await writeSession(sb, SESSION_A, transcript(sb.repo, "hi"));
    await expect(renameSession(sb.paths, PROJECT_ID, SESSION_A, "   ")).rejects.toThrow("Title");
  });
});
