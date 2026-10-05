import { el, emptyState, icon, skeleton, stagger } from "../dom.js";
import { markdownEditor } from "../editor.js";
import { go, navigate, pageHeader } from "../state.js";
import { api, ask, attempt, post, toast } from "../ui.js";

const SYMLINK_NOTICE = "This skill is a symlink, so edits change the shared original too. Deleting removes only the link.";
const PLUGIN_NOTICE = "Skills from plugins are managed by the plugin and update with it.";

function groupLabel(skill) {
  return skill.source === "personal" ? "Personal (~/.claude/skills)" : `Plugin · ${skill.pluginId}`;
}

async function createSkill() {
  const name = await ask({
    title: "New skill",
    message: "Folder name: letters, numbers, dot, dash, underscore.",
    input: "",
    placeholder: "release-notes",
    okLabel: "Next",
  });
  if (!name) return;
  const description = await ask({
    title: `Describe "${name}"`,
    message: "When should Claude use this skill? This becomes its description.",
    input: "",
    placeholder: "Use when writing release notes…",
    okLabel: "Create skill",
  });
  if (description === null) return;
  const created = await attempt(() => post("/api/skills", { name, description }));
  if (created) {
    toast(`Created ${created.name}`);
    go("skills", created.key);
  }
}

function skillRow(skill, activeKey) {
  const classes = `row${skill.key === activeKey ? " active" : ""}${skill.isActive ? "" : " is-off"}`;
  return el(
    "button",
    { class: classes, onclick: () => go("skills", skill.key) },
    el(
      "div",
      { class: "row-title" },
      skill.name,
      skill.isSymlink ? el("span", { class: "chip tiny" }, "linked") : null,
      skill.isActive ? null : el("span", { class: "chip tiny" }, "plugin off"),
    ),
    el("div", { class: "row-meta clamp" }, skill.description || "No description"),
  );
}

function skillList(skills, activeKey) {
  const search = el("input", { class: "search", type: "search", placeholder: `Search ${skills.length} skills…`, "aria-label": "Search skills" });
  const list = el("div", { class: "card-list stagger" });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const matches = skills.filter((s) => !q || `${s.name} ${s.description} ${s.pluginId ?? ""}`.toLowerCase().includes(q));
    const nodes = [];
    let lastGroup = "";
    for (const skill of matches) {
      const group = groupLabel(skill);
      if (group !== lastGroup) nodes.push(el("div", { class: "group-label" }, (lastGroup = group)));
      nodes.push(skillRow(skill, activeKey));
    }
    list.replaceChildren(...(nodes.length ? stagger(nodes) : [el("div", { class: "meta-line" }, "No skills match.")]));
  };
  search.addEventListener("input", draw);
  draw();
  return el("div", { class: "list-pane" }, search, list);
}

async function renderSkill(pane, key) {
  pane.replaceChildren(skeleton(3));
  const query = new URLSearchParams({ key });
  const skill = await attempt(() => api(`/api/skills/content?${query}`));
  if (!skill) return;
  const notice = skill.isSymlink ? SYMLINK_NOTICE : skill.isEditable ? null : PLUGIN_NOTICE;
  const { nodes, focus } = markdownEditor({
    title: skill.name,
    meta: skill.path,
    content: skill.content,
    readOnly: !skill.isEditable,
    notice,
    deleteMessage: "The skill folder moves to the app's data/backups/skills folder.",
    onSave: async (content) => {
      const body = JSON.stringify({ key, content });
      if (!(await attempt(() => api("/api/skills/content", { method: "PUT", body })))) return false;
      toast("Saved · previous version backed up");
      navigate("skills", key);
      return true;
    },
    onDelete: async () => {
      if (!(await attempt(() => api(`/api/skills/content?${query}`, { method: "DELETE" })))) return false;
      toast(`Deleted ${skill.name}`);
      navigate("skills");
      return true;
    },
  });
  pane.replaceChildren(el("div", { class: "detail-inner fade-in" }, nodes));
  focus();
}

export async function renderSkills(main, skillKey) {
  const header = pageHeader({
    eyebrow: "Extensions",
    title: "Skills",
    subtitle: "Your personal skills plus every skill shipped by installed plugins",
    actions: [el("button", { class: "btn primary", onclick: createSkill }, icon("plus", 14), "New skill")],
  });
  main.replaceChildren(el("div", { class: "view" }, header, el("div", { class: "page-body" }, skeleton(6))));
  const data = await attempt(() => api("/api/skills"));
  if (!data) return;
  if (data.warning) toast(`Plugin skills unavailable: ${data.warning}`, true);

  const detail = el("div", { class: "detail-pane" }, emptyState("Pick a skill", "Personal skills are editable; plugin skills are read-only.", "spark"));
  main.replaceChildren(el("div", { class: "view" }, header, el("div", { class: "split" }, skillList(data.skills, skillKey), detail)));
  if (skillKey) renderSkill(detail, skillKey);
}
