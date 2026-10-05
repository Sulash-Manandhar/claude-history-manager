import { el, emptyState, formatBytes, formatDate, icon, skeleton, stagger } from "../dom.js";
import { markdownEditor } from "../editor.js";
import { go, pageHeader, state } from "../state.js";
import { api, ask, attempt, toast } from "../ui.js";
import { projectHeader } from "./chats.js";

function docQuery(scope, projectId, key) {
  const params = new URLSearchParams({ scope });
  if (projectId) params.set("project", projectId);
  if (key) params.set("key", key);
  return params;
}

async function renderDocEditor(pane, scope, projectId, key, refresh) {
  pane.replaceChildren(skeleton(3));
  const params = docQuery(scope, projectId, key);
  const doc = await attempt(() => api(`/api/docs/content?${params}`));
  if (!doc) return;

  const { nodes, focus } = markdownEditor({
    title: doc.label,
    meta: doc.exists ? `${doc.path} · updated ${formatDate(doc.updatedAt)}` : `${doc.path} · does not exist yet`,
    content: doc.content,
    isNew: !doc.exists,
    deleteMessage: "A backup is kept in the app's data/backups folder.",
    onSave: async (content) => {
      const body = JSON.stringify({ scope, project: projectId, key, content });
      if (!(await attempt(() => api("/api/docs/content", { method: "PUT", body })))) return false;
      toast(doc.exists ? "Saved · previous version backed up" : "File created");
      refresh();
      return true;
    },
    onDelete: async () => {
      if (!(await attempt(() => api(`/api/docs/content?${params}`, { method: "DELETE" })))) return false;
      toast("Deleted");
      refresh();
      return true;
    },
  });
  pane.replaceChildren(el("div", { class: "detail-inner fade-in" }, nodes));
  focus();
}

function newFileButton(scope, projectId, folder, routeTo) {
  const create = async () => {
    const name = await ask({
      title: `New ${folder} file`,
      message: "Letters, numbers, dot, dash, underscore; must end in .md",
      input: "new-note.md",
      okLabel: "Create",
    });
    if (!name) return;
    const key = `${folder}/${name}`;
    const body = JSON.stringify({ scope, project: projectId, key, content: `# ${name.replace(/\.md$/, "")}\n` });
    if (await attempt(() => api("/api/docs/content", { method: "PUT", body }))) routeTo(key);
  };
  return el("button", { class: "btn ghost block", onclick: create }, icon("plus", 14), `New ${folder} file`);
}

function docList(data, docKey, routeTo) {
  const nodes = [];
  let lastGroup = "";
  for (const doc of data.docs) {
    if (doc.group !== lastGroup) nodes.push(el("div", { class: "group-label" }, (lastGroup = doc.group)));
    const meta = doc.exists ? `${formatBytes(doc.sizeBytes)} · ${formatDate(doc.updatedAt)}` : "Not created";
    nodes.push(
      el(
        "button",
        { class: `row${doc.key === docKey ? " active" : ""}`, onclick: () => routeTo(doc.key) },
        el("div", { class: `row-title${doc.exists ? "" : " missing"}` }, doc.label),
        el("div", { class: "row-meta" }, meta),
      ),
    );
  }
  return stagger(nodes);
}

export async function renderDocs(main, scope, projectId, docKey) {
  const project = state.projects.find((p) => p.id === projectId) ?? { id: projectId, label: projectId };
  const header =
    scope === "global"
      ? pageHeader({
          eyebrow: "Instructions",
          title: "Personal CLAUDE.md & rules",
          subtitle: "Applies to every project on this machine",
        })
      : projectHeader(project, "docs");
  main.replaceChildren(el("div", { class: "view" }, header, el("div", { class: "page-body" }, skeleton(4))));

  const data = await attempt(() => api(`/api/docs?${docQuery(scope, projectId)}`));
  if (!data) return;
  const routeTo = (key) => (scope === "global" ? go("global", key) : go("p", projectId, "docs", key));
  const folder = scope === "global" ? "rules" : "memory";
  const missingRepo =
    scope === "project" && !data.projectPath
      ? el("div", { class: "notice" }, "Project folder not found on disk, so only auto-memory is editable.")
      : null;

  const listPane = el(
    "div",
    { class: "list-pane" },
    missingRepo,
    el("div", { class: "card-list stagger" }, docList(data, docKey, routeTo)),
    newFileButton(scope, projectId, folder, routeTo),
  );
  const detail = el("div", { class: "detail-pane" }, emptyState("Pick a file", "View or edit it here. Every save keeps a backup.", "doc"));
  main.replaceChildren(el("div", { class: "view" }, header, el("div", { class: "split" }, listPane, detail)));
  if (docKey && data.docs.some((d) => d.key === docKey)) {
    renderDocEditor(detail, scope, projectId, docKey, () => renderDocs(main, scope, projectId, docKey));
  }
}
