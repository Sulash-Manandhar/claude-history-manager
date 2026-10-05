import { el, emptyState, formatBytes, formatRelative, icon, skeleton, stagger } from "../dom.js";
import { loadProjects, pageHeader } from "../state.js";
import { api, ask, attempt, post, toast, withBusy } from "../ui.js";

function groupByProject(entries) {
  const groups = new Map();
  for (const e of entries) groups.set(e.projectId, [...(groups.get(e.projectId) ?? []), e]);
  return [...groups.entries()];
}

async function afterChange(main, message) {
  toast(message);
  await loadProjects();
  renderTrash(main);
}

function entryRow(main, entry) {
  const url = `/api/trash/${entry.projectId}/${entry.sessionId}`;
  const restore = async () => {
    if (await attempt(() => post(url))) afterChange(main, "Restored");
  };
  const purge = async () => {
    const ok = await ask({
      title: "Delete permanently?",
      message: `"${entry.title}" cannot be recovered.`,
      okLabel: "Delete forever",
      danger: true,
    });
    if (ok && (await attempt(() => api(url, { method: "DELETE" })))) afterChange(main, "Deleted permanently");
  };
  return el(
    "div",
    { class: "row static" },
    el(
      "div",
      { class: "row-main" },
      el("div", { class: "row-title" }, entry.title),
      el("div", { class: "row-meta" }, `Deleted ${formatRelative(entry.deletedAt)} · ${formatBytes(entry.sizeBytes)}`),
    ),
    el(
      "div",
      { class: "row-actions" },
      el("button", { class: "btn ghost", onclick: restore }, icon("restore", 14), "Restore"),
      el("button", { class: "btn danger", onclick: purge }, "Delete forever"),
    ),
  );
}

function projectGroup(main, projectId, entries) {
  const restoreAll = el("button", { class: "btn ghost" }, icon("restore", 14), `Restore all ${entries.length}`);
  restoreAll.addEventListener("click", () =>
    withBusy(restoreAll, async () => {
      const { restored } = await post(`/api/trash/${projectId}`);
      await afterChange(main, `Restored ${restored} chats`);
    }),
  );
  return el(
    "section",
    { class: "panel" },
    el("div", { class: "panel-head" }, el("h2", { class: "panel-title" }, entries[0].projectPath ?? projectId), restoreAll),
    el("div", { class: "card-list stagger" }, stagger(entries.map((e) => entryRow(main, e)))),
  );
}

function trashHeader(actions = []) {
  return pageHeader({
    eyebrow: "Trash",
    title: "Deleted chats",
    subtitle: "Chats stay here until you restore them or delete them for good",
    actions,
  });
}

export async function renderTrash(main) {
  main.replaceChildren(el("div", { class: "view" }, trashHeader(), el("div", { class: "page-body" }, skeleton(4))));
  const entries = (await attempt(() => api("/api/trash"))) ?? [];

  const emptyAll = async () => {
    const ok = await ask({
      title: `Empty trash (${entries.length} chats)?`,
      message: "Every chat in Trash is deleted permanently. This cannot be undone.",
      okLabel: "Empty trash",
      danger: true,
    });
    if (!ok) return;
    const result = await attempt(() => api("/api/trash", { method: "DELETE" }));
    if (result) afterChange(main, `Deleted ${result.purged} chats permanently`);
  };
  const actions = entries.length ? [el("button", { class: "btn danger", onclick: emptyAll }, icon("trash", 14), "Empty trash")] : [];
  const body = entries.length
    ? groupByProject(entries).map(([projectId, list]) => projectGroup(main, projectId, list))
    : [emptyState("Trash is empty", "Deleted chats show up here, ready to restore.", "trash")];
  main.replaceChildren(el("div", { class: "view" }, trashHeader(actions), el("div", { class: "page-body" }, body)));
}
