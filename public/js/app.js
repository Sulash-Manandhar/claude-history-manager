import { $, icon } from "./dom.js";
import { go, loadProjects, parseHash, renderSidebar, state } from "./state.js";
import { themeSwitcher } from "./theme.js";
import { ask } from "./ui.js";
import { renderChats } from "./views/chats.js";
import { renderDocs } from "./views/docs.js";
import { renderOverview } from "./views/overview.js";
import { renderPlugins } from "./views/plugins.js";
import { renderSkills } from "./views/skills.js";
import { renderTrash } from "./views/trash.js";

function renderRoute(main, route) {
  switch (route.view) {
    case "global":
      return renderDocs(main, "global", null, route.docKey);
    case "trash":
      return renderTrash(main);
    case "plugins":
      return renderPlugins(main, route.tab, route.marketplace);
    case "skills":
      return renderSkills(main, route.skillKey);
    case "project":
      return route.tab === "docs"
        ? renderDocs(main, "project", route.projectId, route.itemId)
        : renderChats(main, route.projectId, route.itemId);
    default:
      return renderOverview(main);
  }
}

function render() {
  const previousView = state.route.view;
  state.route = parseHash();
  document.body.classList.remove("menu-open");
  renderSidebar();
  const main = $("#main");
  if (previousView !== state.route.view) main.scrollTop = 0;
  renderRoute(main, state.route);
}

window.addEventListener("hashchange", async (event) => {
  if (state.dirtyDoc && !(await ask({ title: "Discard unsaved changes?", okLabel: "Discard", danger: true }))) {
    // replaceState doesn't fire hashchange, so cancelling can't re-trigger this prompt.
    history.replaceState(null, "", new URL(event.oldURL).hash);
    return;
  }
  state.dirtyDoc = false;
  render();
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirtyDoc) e.preventDefault();
});

for (const button of document.querySelectorAll(".nav-item")) {
  button.prepend(icon(button.dataset.icon, 17));
  button.addEventListener("click", () => (button.dataset.view === "home" ? go() : go(button.dataset.view)));
}
$("#menu-toggle").prepend(icon("folder", 18));
$("#menu-toggle").addEventListener("click", () => document.body.classList.toggle("menu-open"));
$("#project-filter").addEventListener("input", renderSidebar);
$("#theme-slot").replaceWith(themeSwitcher());
$("#year").textContent = String(new Date().getFullYear());

state.rerender = render;
await loadProjects();
render();
