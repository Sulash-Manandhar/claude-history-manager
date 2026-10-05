import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { listSessions } from "../src/lib/sessions";
import { utimes } from "node:fs/promises";
import {
  emptyTrash,
  listTrash,
  moveProjectToTrash,
  moveToTrash,
  purgeFromTrash,
  restoreFromTrash,
  restoreProjectFromTrash,
} from "../src/lib/trash";
import { PROJECT_ID, SESSION_A, SESSION_B, type Sandbox, createSandbox, transcript, writeSession } from "./helpers";

let sb: Sandbox;
beforeEach(async () => {
  sb = await createSandbox();
  await writeSession(sb, SESSION_A, transcript(sb.repo, "hello"));
  await mkdir(join(sb.paths.projectsDir, PROJECT_ID, SESSION_A, "tool-results"), { recursive: true });
});
afterEach(() => sb.cleanup());

describe("trash", () => {
  test("moves the transcript and its sibling folder out of the project", async () => {
    await moveToTrash(sb.paths, PROJECT_ID, SESSION_A);

    expect(await listSessions(sb.paths, PROJECT_ID)).toHaveLength(0);
    expect(await Bun.file(join(sb.paths.projectsDir, PROJECT_ID, SESSION_A, "tool-results")).exists()).toBe(false);
    const [entry] = await listTrash(sb.paths);
    expect(entry).toMatchObject({ projectId: PROJECT_ID, sessionId: SESSION_A, title: "hello" });
  });

  test("restores a trashed session to its project", async () => {
    await moveToTrash(sb.paths, PROJECT_ID, SESSION_A);
    await restoreFromTrash(sb.paths, PROJECT_ID, SESSION_A);

    expect((await listSessions(sb.paths, PROJECT_ID)).map((s) => s.id)).toEqual([SESSION_A]);
    expect(await listTrash(sb.paths)).toHaveLength(0);
  });

  test("refuses to restore over an existing session", async () => {
    await moveToTrash(sb.paths, PROJECT_ID, SESSION_A);
    await writeSession(sb, SESSION_A, transcript(sb.repo, "new"));
    await expect(restoreFromTrash(sb.paths, PROJECT_ID, SESSION_A)).rejects.toThrow("already exists");
  });

  test("purge removes it permanently", async () => {
    await moveToTrash(sb.paths, PROJECT_ID, SESSION_A);
    await purgeFromTrash(sb.paths, PROJECT_ID, SESSION_A);
    expect(await listTrash(sb.paths)).toHaveLength(0);
  });

  test("rejects invalid ids before touching disk", async () => {
    await expect(moveToTrash(sb.paths, "..", SESSION_A)).rejects.toThrow("Invalid project id");
    await expect(moveToTrash(sb.paths, PROJECT_ID, "../x")).rejects.toThrow("Invalid session id");
  });
});

describe("bulk trash", () => {
  const ageSession = async (id: string) => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(join(sb.paths.projectsDir, PROJECT_ID, `${id}.jsonl`), old, old);
  };

  test("trashes every idle chat in a project but skips ones active in the last few minutes", async () => {
    await ageSession(SESSION_A);
    await writeSession(sb, SESSION_B, transcript(sb.repo, "live"));

    const result = await moveProjectToTrash(sb.paths, PROJECT_ID);

    expect(result).toEqual({ moved: 1, skippedActive: 1 });
    expect((await listSessions(sb.paths, PROJECT_ID)).map((s) => s.id)).toEqual([SESSION_B]);
  });

  test("restores a whole project and empties the trash", async () => {
    await writeSession(sb, SESSION_B, transcript(sb.repo, "two"));
    await ageSession(SESSION_A);
    await ageSession(SESSION_B);
    await moveProjectToTrash(sb.paths, PROJECT_ID);

    expect(await restoreProjectFromTrash(sb.paths, PROJECT_ID)).toBe(2);
    expect(await listSessions(sb.paths, PROJECT_ID)).toHaveLength(2);

    await moveToTrash(sb.paths, PROJECT_ID, SESSION_A);
    expect(await emptyTrash(sb.paths)).toBe(1);
    expect(await listTrash(sb.paths)).toHaveLength(0);
  });
});
