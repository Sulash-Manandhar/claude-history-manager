import { countUp, el, emptyState, formatBytes, formatRelative, icon, skeleton, stagger } from "../dom.js";
import { go, pageHeader } from "../state.js";
import { api, attempt } from "../ui.js";

const TOP_PROJECTS = 5;

function statCard(label, iconName, onclick) {
  const value = el("div", { class: "stat-value" }, "—");
  const card = el(
    "button",
    { class: "stat-card", onclick },
    el("div", { class: "stat-icon" }, icon(iconName, 18)),
    el("div", { class: "stat-label" }, label),
    value,
  );
  return { card, set: (n, format) => countUp(value, n, format) };
}

function recentList(recent) {
  if (!recent.length) return emptyState("No chats yet", "Start a session with `claude` and it will show up here.");
  const rows = recent.map((s) =>
    el(
      "button",
      { class: "row", onclick: () => go("p", s.projectId, "chats", s.id) },
      el("div", { class: "row-title" }, s.title),
      el(
        "div",
        { class: "row-meta" },
        el("span", { class: "chip" }, s.projectLabel),
        ` ${formatRelative(s.updatedAt)} · ${formatBytes(s.sizeBytes)}`,
      ),
    ),
  );
  return el("div", { class: "card-list stagger" }, stagger(rows));
}

function largestProjects(projects) {
  const top = [...projects].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, TOP_PROJECTS);
  const max = top[0]?.sizeBytes || 1;
  const rows = top.map((p) =>
    el(
      "button",
      { class: "bar-row", onclick: () => go("p", p.id, "chats") },
      el("div", { class: "bar-label" }, el("span", {}, p.label), el("span", { class: "muted" }, formatBytes(p.sizeBytes))),
      el("div", { class: "bar-track" }, el("div", { class: "bar-fill", style: `--w:${Math.max(2, (p.sizeBytes / max) * 100)}%` })),
    ),
  );
  return el("div", { class: "bars stagger" }, stagger(rows));
}

export async function renderOverview(main) {
  const stats = {
    projects: statCard("Projects", "folder", () => document.querySelector("#project-filter").focus()),
    chats: statCard("Chats", "chat"),
    storage: statCard("History size", "download"),
    plugins: statCard("Plugins", "plug", () => go("plugins")),
    skills: statCard("Skills", "spark", () => go("skills")),
  };
  const recentSlot = el("div", {}, skeleton(5));
  const barsSlot = el("div", {}, skeleton(4));

  main.replaceChildren(
    el(
      "div",
      { class: "view" },
      pageHeader({
        eyebrow: "Overview",
        title: "Your Claude Code, at a glance",
        subtitle: "Chats, plugins, skills and instructions — all local, all in one place.",
      }),
      el(
        "div",
        { class: "page-body" },
        el("section", { class: "stat-grid stagger" }, stagger(Object.values(stats).map((s) => s.card))),
        el(
          "div",
          { class: "two-col" },
          el("section", { class: "panel" }, el("h2", { class: "panel-title" }, "Recent chats"), recentSlot),
          el("section", { class: "panel" }, el("h2", { class: "panel-title" }, "Largest projects"), barsSlot),
        ),
      ),
    ),
  );

  api("/api/plugins").then((list) => stats.plugins.set(list.length), () => stats.plugins.set(0));
  api("/api/skills").then((data) => stats.skills.set(data.skills.length), () => stats.skills.set(0));

  const data = await attempt(() => api("/api/overview"));
  if (!data) return;
  stats.projects.set(data.projects.length);
  stats.chats.set(data.projects.reduce((n, p) => n + p.sessionCount, 0));
  stats.storage.set(data.projects.reduce((n, p) => n + p.sizeBytes, 0), formatBytes);
  recentSlot.replaceChildren(recentList(data.recent));
  barsSlot.replaceChildren(data.projects.length ? largestProjects(data.projects) : emptyState("No projects yet"));
}
