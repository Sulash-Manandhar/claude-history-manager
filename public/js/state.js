import { $, el, formatBytes, icon } from "./dom.js";
import { api, attempt } from "./ui.js";

// rerender is wired up by app.js; views call navigate() instead of importing the router directly.
export const state = { projects: [], route: { view: "home" }, dirtyDoc: false, rerender: () => {} };

export function parseHash() {
  const [view, a, b, c] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (view === "global") return { view: "global", docKey: a ?? null };
  if (view === "trash") return { view: "trash" };
  if (view === "plugins") return { view: "plugins", tab: a ?? "installed", marketplace: b ?? null };
  if (view === "skills") return { view: "skills", skillKey: a ?? null };
  if (view === "p" && a) {
    return { view: "project", projectId: a, tab: b === "docs" ? "docs" : "chats", itemId: c ?? null };
  }
  return { view: "home" };
}

export function go(...segments) {
  location.hash = `/${segments.filter(Boolean).map(encodeURIComponent).join("/")}`;
}

// Like go(), but re-renders even when the target equals the current hash (hashchange wouldn't fire).
export function navigate(...segments) {
  const target = `#/${segments.filter(Boolean).map(encodeURIComponent).join("/")}`;
  if (location.hash === target) state.rerender();
  else location.hash = target;
}

function projectButton(project, isActive) {
  return el(
    "button",
    {
      class: `project-item${isActive ? " active" : ""}`,
      title: project.path ?? project.id,
      onclick: () => go("p", project.id, "chats"),
    },
    icon("folder", 15),
    el(
      "span",
      { class: "project-text" },
      el("span", { class: "project-name" }, project.label),
      el("small", {}, `${project.sessionCount} chats · ${formatBytes(project.sizeBytes)}`),
    ),
  );
}

export function renderSidebar() {
  const route = state.route;
  const filter = $("#project-filter").value.trim().toLowerCase();
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === route.view));

  const items = state.projects
    .filter((p) => !filter || `${p.label} ${p.path ?? p.id}`.toLowerCase().includes(filter))
    .map((p) => el("li", {}, projectButton(p, route.projectId === p.id)));
  $("#project-count").textContent = state.projects.length ? String(state.projects.length) : "";
  $("#project-list").replaceChildren(...items);
}

export async function loadProjects() {
  state.projects = (await attempt(() => api("/api/projects"))) ?? [];
  renderSidebar();
}

export function pageHeader({ title, subtitle, eyebrow, actions = [], tabs = null }) {
  const heading = el(
    "div",
    { class: "page-heading" },
    eyebrow ? el("div", { class: "eyebrow" }, eyebrow) : null,
    el("h1", {}, title),
    subtitle ? el("div", { class: "subtitle" }, subtitle) : null,
  );
  return el(
    "header",
    { class: "page-header" },
    el("div", { class: "page-header-row" }, heading, actions.length ? el("div", { class: "page-actions" }, actions) : null),
    tabs,
  );
}

export function tabBar(items, active) {
  return el(
    "nav",
    { class: "tabs", role: "tablist" },
    items.map(({ id, label, onclick, count }) =>
      el(
        "button",
        { class: `tab${active === id ? " active" : ""}`, role: "tab", "aria-selected": String(active === id), onclick },
        label,
        count != null ? el("span", { class: "tab-count" }, count) : null,
      ),
    ),
  );
}
