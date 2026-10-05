import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createSkill, deleteSkill, listSkills, parseFrontmatter, readSkill, writeSkill } from "../src/lib/skills";
import { type Sandbox, createSandbox } from "./helpers";

let sb: Sandbox;
const skillsDir = () => join(sb.paths.claudeHome, "skills");

beforeEach(async () => {
  sb = await createSandbox();
  await Bun.write(join(skillsDir(), "tidy", "SKILL.md"), "---\nname: tidy\ndescription: Tidies code\n---\n# Tidy\n");
  const shared = join(sb.root, "shared-skills", "linked");
  await Bun.write(join(shared, "SKILL.md"), "---\nname: linked\ndescription: >\n  Folded\n  text\n---\n");
  await symlink(shared, join(skillsDir(), "linked"));
});
afterEach(() => sb.cleanup());

const pluginSource = () => [{ id: "demo@market", installPath: join(sb.root, "plugin") }];

describe("parseFrontmatter", () => {
  test("reads single-line, quoted and folded values", () => {
    const text = '---\nname: "x"\ndescription: |\n  line one\n  line two\nother: y\n---\nbody';
    expect(parseFrontmatter(text)).toEqual({ name: "x", description: "line one line two", other: "y" });
  });

  test("returns empty when there is no frontmatter", () => {
    expect(parseFrontmatter("# just markdown")).toEqual({});
  });
});

describe("listSkills", () => {
  test("lists personal skills (marking symlinks) and plugin skills as read-only", async () => {
    await Bun.write(join(sb.root, "plugin", "skills", "plug", "SKILL.md"), "---\ndescription: From plugin\n---\n");

    const skills = await listSkills(sb.paths, pluginSource());

    expect(skills.map((s) => [s.key, s.name, s.description, s.isEditable, s.isSymlink])).toEqual([
      ["personal/linked", "linked", "Folded text", true, true],
      ["personal/tidy", "tidy", "Tidies code", true, false],
      ["plugin/demo@market/plug", "plug", "From plugin", false, false],
    ]);
  });
});

describe("personal skill editing", () => {
  test("reads and writes SKILL.md, keeping a backup", async () => {
    expect((await readSkill(sb.paths, "personal/tidy", [])).content).toContain("# Tidy");
    await writeSkill(sb.paths, "personal/tidy", "---\nname: tidy\n---\nnew");
    expect(await Bun.file(join(skillsDir(), "tidy", "SKILL.md")).text()).toBe("---\nname: tidy\n---\nnew");
    expect(await readdir(sb.paths.backupsDir)).toHaveLength(1);
  });

  test("refuses to write plugin skills", async () => {
    await Bun.write(join(sb.root, "plugin", "skills", "plug", "SKILL.md"), "x");
    await expect(writeSkill(sb.paths, "plugin/demo@market/plug", "y")).rejects.toThrow("read-only");
  });

  test("creates a new skill with frontmatter and rejects duplicates and bad names", async () => {
    await createSkill(sb.paths, "release-notes", "Writes release notes");
    const text = await Bun.file(join(skillsDir(), "release-notes", "SKILL.md")).text();
    expect(parseFrontmatter(text)).toMatchObject({ name: "release-notes", description: "Writes release notes" });

    await expect(createSkill(sb.paths, "tidy", "dup")).rejects.toThrow("already exists");
    await expect(createSkill(sb.paths, "../evil", "x")).rejects.toThrow("Invalid skill name");
  });

  test("delete moves the folder (or just the symlink) into backups", async () => {
    await deleteSkill(sb.paths, "personal/tidy");
    await deleteSkill(sb.paths, "personal/linked");

    expect(await readdir(skillsDir())).toEqual([]);
    expect(await Bun.file(join(sb.root, "shared-skills", "linked", "SKILL.md")).exists()).toBe(true);
    expect(await readdir(join(sb.paths.backupsDir, "skills"))).toHaveLength(2);
  });

  test("rejects traversal in keys", async () => {
    await expect(readSkill(sb.paths, "personal/../../x", [])).rejects.toThrow("Unknown skill");
    await expect(readSkill(sb.paths, "plugin/nope@x/a", [])).rejects.toThrow("Unknown skill");
  });
});
