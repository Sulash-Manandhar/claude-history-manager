import { type Guard, bodyOf, json, requireString } from "../http";
import { type DocTarget, deleteDoc, listDocs, readDoc, writeDoc } from "../lib/docs";
import { type AppPaths, HttpError, assertProjectDir } from "../lib/paths";
import {
  type InstalledPlugin,
  addMarketplace,
  installPlugin,
  listAvailablePlugins,
  listInstalledPlugins,
  listMarketplaces,
  refreshMarketplaces,
  removeMarketplace,
  setPluginEnabled,
  uninstallPlugin,
  updatePlugin,
} from "../lib/plugins";
import { createSkill, deleteSkill, listSkills, readSkill, writeSkill } from "../lib/skills";
import { emptyTrash, listTrash, purgeFromTrash, restoreFromTrash, restoreProjectFromTrash } from "../lib/trash";
import { existingProjectPath } from "./chats";

const DEFAULT_AVAILABLE_LIMIT = 60;

async function docTargetFrom(paths: AppPaths, scope: string | null, projectId: string | null): Promise<DocTarget> {
  if (scope === "global") return { scope: "global" };
  if (scope !== "project" || !projectId) throw new HttpError(400, "scope must be 'global' or 'project' with a project id");
  assertProjectDir(projectId);
  return { scope: "project", projectId, projectPath: await existingProjectPath(paths, projectId) };
}

// Skills still list (personal ones at least) when the Claude CLI is missing or failing.
async function pluginsOrEmpty(paths: AppPaths): Promise<{ plugins: InstalledPlugin[]; warning: string | null }> {
  try {
    return { plugins: await listInstalledPlugins(paths), warning: null };
  } catch (error) {
    return { plugins: [], warning: error instanceof Error ? error.message : "Could not list plugins" };
  }
}

export function docRoutes(paths: AppPaths, guard: Guard) {
  const targetOf = (url: URL) => docTargetFrom(paths, url.searchParams.get("scope"), url.searchParams.get("project"));
  return {
    "/api/docs": {
      GET: guard(async (req) => {
        const target = await targetOf(new URL(req.url));
        return json({ projectPath: target.projectPath ?? null, docs: await listDocs(paths, target) });
      }),
    },

    "/api/docs/content": {
      GET: guard(async (req) => {
        const url = new URL(req.url);
        return json(await readDoc(paths, await targetOf(url), url.searchParams.get("key") ?? ""));
      }),
      PUT: guard(async (req) => {
        const body = await bodyOf<{ scope?: string; project?: string; key?: unknown; content?: unknown }>(req);
        const key = requireString(body.key, "key");
        const content = requireString(body.content, "content");
        const target = await docTargetFrom(paths, body.scope ?? null, body.project ?? null);
        return json(await writeDoc(paths, target, key, content));
      }),
      DELETE: guard(async (req) => {
        const url = new URL(req.url);
        await deleteDoc(paths, await targetOf(url), url.searchParams.get("key") ?? "");
        return json({ ok: true });
      }),
    },
  };
}

export function trashRoutes(paths: AppPaths, guard: Guard) {
  return {
    "/api/trash": {
      GET: guard(async () => json(await listTrash(paths))),
      DELETE: guard(async () => json({ purged: await emptyTrash(paths) })),
    },

    "/api/trash/:project": {
      POST: guard(async (_req, { project }) => json({ restored: await restoreProjectFromTrash(paths, project) })),
    },

    "/api/trash/:project/:session": {
      POST: guard(async (_req, { project, session }) => {
        await restoreFromTrash(paths, project, session);
        return json({ ok: true });
      }),
      DELETE: guard(async (_req, { project, session }) => {
        await purgeFromTrash(paths, project, session);
        return json({ ok: true });
      }),
    },
  };
}

type PluginAction = "enable" | "disable" | "install" | "uninstall" | "update";

const PLUGIN_ACTIONS: Record<PluginAction, (paths: AppPaths, id: string) => Promise<void>> = {
  enable: (paths, id) => setPluginEnabled(paths, id, true),
  disable: (paths, id) => setPluginEnabled(paths, id, false),
  install: installPlugin,
  uninstall: uninstallPlugin,
  update: updatePlugin,
};

const isPluginAction = (value: string): value is PluginAction => Object.hasOwn(PLUGIN_ACTIONS, value);

export function pluginRoutes(paths: AppPaths, guard: Guard) {
  return {
    "/api/plugins": {
      GET: guard(async () => json(await listInstalledPlugins(paths))),
    },

    "/api/plugins/available": {
      GET: guard(async (req) => {
        const url = new URL(req.url);
        const limit = Number(url.searchParams.get("limit") ?? DEFAULT_AVAILABLE_LIMIT) || DEFAULT_AVAILABLE_LIMIT;
        const query = url.searchParams.get("q") ?? "";
        const marketplace = url.searchParams.get("marketplace") || null;
        return json(await listAvailablePlugins(paths, { query, marketplace, limit }));
      }),
    },

    "/api/plugins/:action": {
      POST: guard(async (req, { action }) => {
        if (!isPluginAction(action)) throw new HttpError(404, "Unknown plugin action");
        const { id } = await bodyOf<{ id?: unknown }>(req);
        await PLUGIN_ACTIONS[action](paths, requireString(id, "id"));
        return json({ ok: true });
      }),
    },

    "/api/marketplaces": {
      GET: guard(async () => json(await listMarketplaces(paths))),
      POST: guard(async (req) => {
        const { source } = await bodyOf<{ source?: unknown }>(req);
        return json(await addMarketplace(paths, requireString(source, "source")));
      }),
    },

    "/api/marketplaces/refresh": {
      POST: guard(async () => {
        await refreshMarketplaces(paths);
        return json({ ok: true });
      }),
    },

    "/api/marketplaces/:name": {
      DELETE: guard(async (_req, { name }) => {
        await removeMarketplace(paths, name);
        return json({ ok: true });
      }),
    },
  };
}

export function skillRoutes(paths: AppPaths, guard: Guard) {
  return {
    "/api/skills": {
      GET: guard(async () => {
        const { plugins, warning } = await pluginsOrEmpty(paths);
        const enabledIds = new Set(plugins.filter((p) => p.isEnabled).map((p) => p.id));
        const skills = await listSkills(paths, plugins);
        return json({
          warning,
          skills: skills.map((s) => ({ ...s, isActive: s.pluginId === null || enabledIds.has(s.pluginId) })),
        });
      }),
      POST: guard(async (req) => {
        const { name, description } = await bodyOf<{ name?: unknown; description?: unknown }>(req);
        const text = typeof description === "string" ? description : "";
        return json(await createSkill(paths, requireString(name, "name"), text));
      }),
    },

    "/api/skills/content": {
      GET: guard(async (req) => {
        const key = new URL(req.url).searchParams.get("key") ?? "";
        const { plugins } = key.startsWith("plugin/") ? await pluginsOrEmpty(paths) : { plugins: [] };
        return json(await readSkill(paths, key, plugins));
      }),
      PUT: guard(async (req) => {
        const { key, content } = await bodyOf<{ key?: unknown; content?: unknown }>(req);
        return json(await writeSkill(paths, requireString(key, "key"), requireString(content, "content")));
      }),
      DELETE: guard(async (req) => {
        await deleteSkill(paths, new URL(req.url).searchParams.get("key") ?? "");
        return json({ ok: true });
      }),
    },
  };
}
