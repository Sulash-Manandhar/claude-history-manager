import { stat } from "node:fs/promises";
import { join } from "node:path";
import { type Guard, bodyOf, json, requireString } from "../http";
import type { AppPaths } from "../lib/paths";
import {
  listProjects,
  listRecentSessions,
  listSessions,
  readSessionMeta,
  readTranscript,
  renameSession,
  resolveProjectPath,
  transcriptToMarkdown,
} from "../lib/sessions";
import { generateAiSummary, quickSummary, readCachedAiSummary } from "../lib/summary";
import { moveProjectToTrash, moveToTrash } from "../lib/trash";

const RECENT_LIMIT = 8;

export async function existingProjectPath(paths: AppPaths, projectId: string): Promise<string | null> {
  const path = await resolveProjectPath(paths, projectId);
  if (!path) return null;
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() ? path : null;
}

async function sessionWithMeta(paths: AppPaths, project: string, session: string) {
  const items = await readTranscript(paths, project, session);
  const meta = await readSessionMeta(join(paths.projectsDir, project, `${session}.jsonl`), session);
  return { items, meta };
}

export function chatRoutes(paths: AppPaths, guard: Guard) {
  return {
    "/api/overview": {
      GET: guard(async () => {
        const [projects, recent] = await Promise.all([listProjects(paths), listRecentSessions(paths, RECENT_LIMIT)]);
        return json({ projects, recent });
      }),
    },

    "/api/projects": {
      GET: guard(async () => json(await listProjects(paths))),
    },

    "/api/projects/:project": {
      GET: guard(async (_req, { project }) => {
        const [sessions, path] = await Promise.all([listSessions(paths, project), existingProjectPath(paths, project)]);
        return json({ id: project, path, sessions });
      }),
    },

    "/api/projects/:project/sessions": {
      DELETE: guard(async (_req, { project }) => json(await moveProjectToTrash(paths, project))),
    },

    "/api/projects/:project/sessions/:session": {
      GET: guard(async (_req, { project, session }) => {
        const { items, meta } = await sessionWithMeta(paths, project, session);
        return json({ meta, items, summary: quickSummary(items) });
      }),
      PATCH: guard(async (req, { project, session }) => {
        const { title } = await bodyOf<{ title?: unknown }>(req);
        await renameSession(paths, project, session, requireString(title, "title"));
        return json({ ok: true });
      }),
      DELETE: guard(async (_req, { project, session }) => {
        await moveToTrash(paths, project, session);
        return json({ ok: true });
      }),
    },

    "/api/projects/:project/sessions/:session/summary": {
      GET: guard(async (_req, { project, session }) => json(await readCachedAiSummary(paths, project, session))),
      POST: guard(async (_req, { project, session }) => json(await generateAiSummary(paths, project, session))),
    },

    "/api/projects/:project/sessions/:session/export": {
      GET: guard(async (_req, { project, session }) => {
        const { items, meta } = await sessionWithMeta(paths, project, session);
        return new Response(transcriptToMarkdown(meta.title, items), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="${session}.md"`,
          },
        });
      }),
    },
  };
}
