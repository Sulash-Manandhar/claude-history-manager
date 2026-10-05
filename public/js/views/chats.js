import { el, emptyState, formatBytes, formatDate, formatRelative, icon, richText, skeleton, stagger } from "../dom.js";
import { go, loadProjects, navigate, pageHeader, state, tabBar } from "../state.js";
import { api, ask, attempt, toast } from "../ui.js";
import { summaryCard } from "./summary.js";

const RENDER_BATCH = 300;

export function projectHeader(project, active, actions = []) {
  const tabs = tabBar(
    [
      { id: "chats", label: "Chats", onclick: () => go("p", project.id, "chats") },
      { id: "docs", label: "CLAUDE.md & memory", onclick: () => go("p", project.id, "docs") },
    ],
    active,
  );
  return pageHeader({ eyebrow: "Project", title: project.label, subtitle: project.path ?? project.id, actions, tabs });
}

function transcriptItem(item) {
  if (item.kind === "user" || item.kind === "assistant") {
    const label = el("div", { class: "msg-label" }, item.kind === "user" ? "You" : "Claude");
    return el("div", { class: `msg ${item.kind}` }, label, richText(item.text));
  }
  const isError = item.kind === "tool_result" && item.isError;
  const summary = item.kind === "tool_use" ? `Tool · ${item.name}` : `Result${isError ? " (error)" : ""}`;
  const body = el("pre", {}, item.kind === "tool_use" ? item.input : item.text);
  return el("details", { class: `tool${isError ? " error" : ""}` }, el("summary", {}, summary), body);
}

function transcriptFeed(items) {
  let showTools = false;
  let rendered = 0;
  const feed = el("div", { class: "feed" });
  const more = el("button", { class: "btn", onclick: () => appendBatch() }, "Load more");
  const visible = () => items.filter((i) => showTools || i.kind === "user" || i.kind === "assistant");

  function appendBatch() {
    const list = visible();
    feed.append(...list.slice(rendered, rendered + RENDER_BATCH).map(transcriptItem));
    rendered = Math.min(list.length, rendered + RENDER_BATCH);
    more.hidden = rendered >= list.length;
  }
  function reset() {
    feed.replaceChildren();
    rendered = 0;
    appendBatch();
  }
  appendBatch();
  const checkbox = el("input", { type: "checkbox", class: "switch", onchange: (e) => ((showTools = e.target.checked), reset()) });
  return { toggle: el("label", { class: "switch-label" }, checkbox, "Show tools"), nodes: [feed, more] };
}

async function renameChat(project, session) {
  const title = await ask({ title: "Rename chat", input: session.title, okLabel: "Rename" });
  if (!title) return;
  const body = JSON.stringify({ title });
  if (await attempt(() => api(`/api/projects/${project.id}/sessions/${session.id}`, { method: "PATCH", body }))) {
    toast("Renamed");
    navigate("p", project.id, "chats", session.id);
  }
}

async function trashChat(project, session) {
  const confirmed = await ask({
    title: "Move chat to trash?",
    message: `"${session.title}" can be restored from Trash later.`,
    okLabel: "Move to trash",
    danger: true,
  });
  if (!confirmed) return;
  if (await attempt(() => api(`/api/projects/${project.id}/sessions/${session.id}`, { method: "DELETE" }))) {
    toast("Moved to trash");
    await loadProjects();
    navigate("p", project.id, "chats");
  }
}

async function trashAllChats(project, count) {
  const confirmed = await ask({
    title: `Delete all ${count} chats?`,
    message: `Every chat in ${project.label} moves to Trash, where you can restore them. Chats used in the last 2 minutes are skipped.`,
    okLabel: "Move all to trash",
    danger: true,
  });
  if (!confirmed) return;
  const result = await attempt(() => api(`/api/projects/${project.id}/sessions`, { method: "DELETE" }));
  if (!result) return;
  const skipped = result.skippedActive ? ` · skipped ${result.skippedActive} active` : "";
  toast(`Moved ${result.moved} chats to Trash${skipped}`);
  await loadProjects();
  navigate("p", project.id, "chats");
}

function sessionToolbar(project, session, base, toggle) {
  const resumeCmd = `cd ${JSON.stringify(project.path ?? "~")} && claude --resume ${session.id}`;
  const copyResume = () => navigator.clipboard.writeText(resumeCmd).then(() => toast("Resume command copied"));
  return el(
    "div",
    { class: "toolbar" },
    toggle,
    el("span", { class: "spacer" }),
    el("button", { class: "btn ghost", onclick: copyResume, title: resumeCmd }, icon("copy", 14), "Resume cmd"),
    el("button", { class: "btn ghost", onclick: () => renameChat(project, session) }, icon("pencil", 14), "Rename"),
    el("a", { class: "btn ghost", href: `${base}/export` }, icon("download", 14), "Export"),
    el("button", { class: "btn danger", onclick: () => trashChat(project, session) }, icon("trash", 14), "Delete"),
  );
}

async function renderSession(pane, project, session) {
  pane.replaceChildren(skeleton(6));
  const base = `/api/projects/${project.id}/sessions/${session.id}`;
  const data = await attempt(() => api(base));
  if (!data) return;

  const { toggle, nodes } = transcriptFeed(data.items);
  const m = data.meta;
  const branch = m.gitBranch ? ` · ${m.gitBranch}` : "";
  const meta = `${formatDate(m.startedAt)} → ${formatDate(m.updatedAt)} · ${data.items.length} entries · ${formatBytes(m.sizeBytes)}${branch}`;

  pane.replaceChildren(
    el(
      "div",
      { class: "detail-inner fade-in" },
      el("h2", { class: "detail-title" }, m.title),
      sessionToolbar(project, session, base, toggle),
      el("div", { class: "meta-line" }, meta),
      summaryCard(base, data.summary),
      ...nodes,
    ),
  );
}

function sessionList(data, projectId, sessionId) {
  const search = el("input", {
    class: "search",
    type: "search",
    placeholder: `Search ${data.sessions.length} chats…`,
    "aria-label": "Search chats",
  });
  const list = el("div", { class: "card-list stagger" });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const rows = data.sessions
      .filter((s) => !q || `${s.title} ${s.firstPrompt}`.toLowerCase().includes(q))
      .map((s) =>
        el(
          "button",
          { class: `row${s.id === sessionId ? " active" : ""}`, onclick: () => go("p", projectId, "chats", s.id) },
          el("div", { class: "row-title" }, s.title),
          el("div", { class: "row-meta" }, `${formatRelative(s.updatedAt)} · ${formatBytes(s.sizeBytes)}`),
        ),
      );
    list.replaceChildren(...(rows.length ? stagger(rows) : [el("div", { class: "meta-line" }, "No chats match.")]));
  };
  search.addEventListener("input", draw);
  draw();
  return el("div", { class: "list-pane" }, search, list);
}

export async function renderChats(main, projectId, sessionId) {
  const known = state.projects.find((p) => p.id === projectId) ?? { id: projectId, label: projectId };
  const loading = el("div", { class: "page-body" }, skeleton(6));
  main.replaceChildren(el("div", { class: "view" }, projectHeader(known, "chats"), loading));
  const data = await attempt(() => api(`/api/projects/${projectId}`));
  if (!data) return;
  const project = { ...known, ...data, label: known.label };

  if (!data.sessions.length) {
    const empty = emptyState("No chats in this project", "Deleted chats wait in Trash.", "trash");
    main.replaceChildren(el("div", { class: "view" }, projectHeader(project, "chats"), empty));
    return;
  }
  const deleteAll = el(
    "button",
    { class: "btn danger", onclick: () => trashAllChats(project, data.sessions.length) },
    icon("trash", 14),
    "Delete all chats",
  );
  const detail = el("div", { class: "detail-pane" }, emptyState("Pick a chat", "Its summary and full transcript open here."));
  main.replaceChildren(
    el(
      "div",
      { class: "view" },
      projectHeader(project, "chats", [deleteAll]),
      el("div", { class: "split" }, sessionList(data, projectId, sessionId), detail),
    ),
  );
  const session = data.sessions.find((s) => s.id === sessionId);
  if (session) renderSession(detail, project, session);
}
