import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type DocTarget, deleteDoc, listDocs, readDoc, writeDoc } from "../src/lib/docs";
import { PROJECT_ID, type Sandbox, createSandbox } from "./helpers";

let sb: Sandbox;
const GLOBAL: DocTarget = { scope: "global" };
const project = (): DocTarget => ({ scope: "project", projectId: PROJECT_ID, projectPath: sb.repo });

beforeEach(async () => {
  sb = await createSandbox();
  await Bun.write(join(sb.paths.claudeHome, "rules", "team", "style.md"), "# style");
  await Bun.write(join(sb.repo, "CLAUDE.md"), "# repo rules");
  await Bun.write(join(sb.paths.projectsDir, PROJECT_ID, "memory", "MEMORY.md"), "- note");
});
afterEach(() => sb.cleanup());

describe("listDocs", () => {
  test("global scope lists CLAUDE.md (even if missing) and nested rules", async () => {
    const docs = await listDocs(sb.paths, GLOBAL);
    expect(docs.map((d) => [d.key, d.exists])).toEqual([
      ["CLAUDE.md", false],
      ["rules/team/style.md", true],
    ]);
  });

  test("project scope lists repo instruction files and auto memory", async () => {
    const keys = (await listDocs(sb.paths, project())).map((d) => d.key);
    expect(keys).toEqual(["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", "memory/MEMORY.md"]);
  });

  test("project without a folder on disk only offers memory", async () => {
    const keys = (await listDocs(sb.paths, { ...project(), projectPath: null })).map((d) => d.key);
    expect(keys).toEqual(["memory/MEMORY.md"]);
  });
});

describe("read/write", () => {
  test("creates the personal CLAUDE.md", async () => {
    await writeDoc(sb.paths, GLOBAL, "CLAUDE.md", "be terse");
    expect((await readDoc(sb.paths, GLOBAL, "CLAUDE.md")).content).toBe("be terse");
  });

  test("backs up the previous version before overwriting", async () => {
    await writeDoc(sb.paths, project(), "CLAUDE.md", "# new");
    expect(await Bun.file(join(sb.repo, "CLAUDE.md")).text()).toBe("# new");
    const backups = await readdir(sb.paths.backupsDir);
    expect(backups).toHaveLength(1);
    expect(await Bun.file(join(sb.paths.backupsDir, backups[0])).text()).toBe("# repo rules");
  });

  test("allows creating new memory files with safe names only", async () => {
    await writeDoc(sb.paths, project(), "memory/new-note.md", "x");
    await expect(writeDoc(sb.paths, project(), "memory/../../evil.md", "x")).rejects.toThrow("Unknown document");
    await expect(writeDoc(sb.paths, project(), "memory/no-extension", "x")).rejects.toThrow("Unknown document");
  });

  test("rejects keys that are not known documents", async () => {
    await expect(readDoc(sb.paths, GLOBAL, "../settings.json")).rejects.toThrow("Unknown document");
    await expect(writeDoc(sb.paths, GLOBAL, "settings.json", "{}")).rejects.toThrow("Unknown document");
  });

  test("rejects oversized documents", async () => {
    await expect(writeDoc(sb.paths, GLOBAL, "CLAUDE.md", "x".repeat(1024 * 1024 + 1))).rejects.toThrow("1MB");
  });

  test("delete removes the file and keeps a backup", async () => {
    await deleteDoc(sb.paths, project(), "memory/MEMORY.md");
    expect(await Bun.file(join(sb.paths.projectsDir, PROJECT_ID, "memory", "MEMORY.md")).exists()).toBe(false);
    expect(await readdir(sb.paths.backupsDir)).toHaveLength(1);
  });
});
