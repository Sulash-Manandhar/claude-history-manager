import { el, emptyState, icon, skeleton, stagger } from "../dom.js";
import { go, navigate, pageHeader, tabBar } from "../state.js";
import { api, ask, attempt, post, toast, withBusy } from "../ui.js";

const SEARCH_DEBOUNCE_MS = 250;
const DISCOVER_LIMIT = 60;
const RESTART_HINT = "Restart Claude Code to apply plugin changes.";
const TABS = ["installed", "discover", "marketplaces"];

const safeLink = (url) => (typeof url === "string" && url.startsWith("https://") ? url : null);

function header(tab) {
  const tabs = tabBar(
    [
      { id: "installed", label: "Installed", onclick: () => go("plugins", "installed") },
      { id: "discover", label: "Discover", onclick: () => go("plugins", "discover") },
      { id: "marketplaces", label: "Marketplaces", onclick: () => go("plugins", "marketplaces") },
    ],
    tab,
  );
  const addButton = el("button", { class: "btn primary", onclick: () => go("plugins", "marketplaces") }, icon("link", 14), "Add from URL");
  return pageHeader({
    eyebrow: "Extensions",
    title: "Plugins",
    subtitle: "Managed through the Claude Code CLI, exactly as `claude plugin` would.",
    actions: [addButton],
    tabs,
  });
}

function enableToggle(plugin) {
  const input = el("input", {
    type: "checkbox",
    class: "switch",
    checked: plugin.isEnabled,
    disabled: plugin.isManaged,
    "aria-label": `Enable ${plugin.name}`,
  });
  input.addEventListener("change", async () => {
    input.disabled = true;
    const action = input.checked ? "enable" : "disable";
    const ok = await attempt(() => post(`/api/plugins/${action}`, { id: plugin.id }));
    if (ok) toast(`${plugin.name} ${action}d · ${RESTART_HINT}`);
    else input.checked = !input.checked;
    input.disabled = false;
  });
  return input;
}

function actionButton(label, plugin, action, { danger = false, confirm = null } = {}) {
  const button = el("button", { class: `btn ${danger ? "danger" : "ghost"}` }, label);
  button.addEventListener("click", async () => {
    if (confirm && !(await ask({ ...confirm, danger }))) return;
    await withBusy(button, async () => {
      await post(`/api/plugins/${action}`, { id: plugin.id });
      toast(`${plugin.name}: ${label.toLowerCase()} done · ${RESTART_HINT}`);
      navigate("plugins", "installed");
    });
  });
  return button;
}

function componentChips(plugin) {
  const { skills, agents, commands } = plugin.counts;
  const parts = [
    skills && `${skills} skills`,
    agents && `${agents} agents`,
    commands && `${commands} commands`,
    ...plugin.mcpServers.map((m) => `MCP · ${m}`),
  ].filter(Boolean);
  return parts.length ? el("div", { class: "chips" }, parts.map((p) => el("span", { class: "chip" }, p))) : null;
}

function installedActions(plugin) {
  if (plugin.isManaged) return [el("span", { class: "badge" }, `Managed · ${plugin.scope}`)];
  const confirm = {
    title: `Uninstall ${plugin.name}?`,
    message: "Its skills, agents and commands stop loading. You can reinstall it from Discover.",
    okLabel: "Uninstall",
  };
  return [actionButton("Update", plugin, "update"), actionButton("Uninstall", plugin, "uninstall", { danger: true, confirm })];
}

function installedCard(plugin) {
  const homepage = safeLink(plugin.homepage);
  const title = el(
    "div",
    { class: "plugin-title" },
    el("strong", {}, plugin.name),
    plugin.version ? el("span", { class: "chip" }, `v${plugin.version}`) : null,
  );
  const link = homepage
    ? el("a", { class: "link", href: homepage, target: "_blank", rel: "noopener noreferrer" }, "Homepage ↗")
    : el("span", {});
  return el(
    "article",
    { class: `plugin-card${plugin.isEnabled ? "" : " is-off"}` },
    el("div", { class: "plugin-head" }, title, enableToggle(plugin)),
    el("div", { class: "muted small" }, `@${plugin.marketplace}${plugin.author ? ` · by ${plugin.author}` : ""}`),
    el("p", { class: "plugin-desc" }, plugin.description || "No description."),
    componentChips(plugin),
    el("div", { class: "plugin-foot" }, link, el("div", { class: "row-actions" }, installedActions(plugin))),
  );
}

async function renderInstalled(body) {
  const plugins = await attempt(() => api("/api/plugins"));
  if (!plugins) {
    body.replaceChildren(emptyState("Couldn't list plugins", "Is the `claude` CLI installed and on your PATH?", "plug"));
    return;
  }
  if (!plugins.length) {
    body.replaceChildren(emptyState("No plugins installed", "Find some under Discover.", "plug"));
    return;
  }
  const enabled = plugins.filter((p) => p.isEnabled).length;
  body.replaceChildren(
    el("div", { class: "meta-line" }, `${plugins.length} installed · ${enabled} enabled`),
    el("div", { class: "card-grid stagger" }, stagger(plugins.map(installedCard))),
  );
}

function installButton(plugin) {
  const installed = () => el("span", { class: "badge success" }, "Installed");
  if (plugin.isInstalled) return installed();
  const button = el("button", { class: "btn primary" }, icon("plus", 14), "Install");
  button.addEventListener("click", () =>
    withBusy(button, async () => {
      await post("/api/plugins/install", { id: plugin.id });
      toast(`Installed ${plugin.name} · ${RESTART_HINT}`);
      button.replaceWith(installed());
    }),
  );
  return button;
}

function availableCard(plugin) {
  return el(
    "article",
    { class: "plugin-card" },
    el("div", { class: "plugin-head" }, el("div", { class: "plugin-title" }, el("strong", {}, plugin.name)), installButton(plugin)),
    el("div", { class: "muted small" }, `@${plugin.marketplace} · ${plugin.installCount.toLocaleString()} installs`),
    el("p", { class: "plugin-desc" }, plugin.description || "No description."),
  );
}

async function renderDiscover(body, marketplace) {
  const search = el("input", { class: "search", type: "search", placeholder: "Search plugins…", "aria-label": "Search plugins" });
  const select = el("select", { class: "select", "aria-label": "Marketplace" }, el("option", { value: "" }, "All marketplaces"));
  const results = el("div", {}, skeleton(6));
  body.replaceChildren(el("div", { class: "filter-bar" }, el("div", { class: "search-wrap" }, icon("search", 15), search), select), results);

  const markets = (await attempt(() => api("/api/marketplaces"))) ?? [];
  select.append(...markets.map((m) => el("option", { value: m.name, selected: m.name === marketplace }, m.name)));

  let timer = 0;
  let requestId = 0;
  const load = async () => {
    const id = ++requestId;
    const params = new URLSearchParams({ q: search.value, marketplace: select.value, limit: String(DISCOVER_LIMIT) });
    const data = await attempt(() => api(`/api/plugins/available?${params}`));
    // Ignore responses that arrive after a newer search started.
    if (!data || id !== requestId) return;
    const grid = data.items.length
      ? el("div", { class: "card-grid stagger" }, stagger(data.items.map(availableCard)))
      : emptyState("No plugins match", "Try another search or marketplace.", "search");
    results.replaceChildren(el("div", { class: "meta-line" }, `Showing ${data.items.length} of ${data.total} · most installed first`), grid);
  };
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(load, SEARCH_DEBOUNCE_MS);
  });
  select.addEventListener("change", load);
  load();
}

function addMarketplaceForm(existing) {
  const input = el("input", {
    class: "search",
    placeholder: "owner/repo · https://github.com/owner/repo · git@host:owner/repo.git",
    "aria-label": "Marketplace URL",
    required: true,
  });
  const button = el("button", { class: "btn primary", type: "submit" }, icon("plus", 14), "Add marketplace");
  const form = el(
    "form",
    { class: "panel add-form" },
    el("h2", { class: "panel-title" }, "Add plugins from a URL"),
    el("p", { class: "muted" }, "Point at any Claude Code plugin marketplace (a repo with .claude-plugin/marketplace.json). Its plugins then show up under Discover."),
    el("div", { class: "inline-form" }, input, button),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(button, async () => {
      const after = await post("/api/marketplaces", { source: input.value });
      const added = after.find((m) => !existing.has(m.name));
      toast(added ? `Added ${added.name}` : "That marketplace is already added");
      go("plugins", "discover", added?.name ?? "");
    });
  });
  return form;
}

function marketplaceRow(market) {
  const remove = el("button", { class: "btn danger" }, "Remove");
  remove.addEventListener("click", async () => {
    const ok = await ask({ title: `Remove ${market.name}?`, message: "Plugins installed from it may stop updating.", okLabel: "Remove", danger: true });
    if (!ok) return;
    await withBusy(remove, async () => {
      await api(`/api/marketplaces/${encodeURIComponent(market.name)}`, { method: "DELETE" });
      toast(`Removed ${market.name}`);
      navigate("plugins", "marketplaces");
    });
  });
  return el(
    "div",
    { class: "row static" },
    el("div", { class: "row-main" }, el("div", { class: "row-title" }, market.name), el("div", { class: "row-meta" }, market.source)),
    el("div", { class: "row-actions" }, el("button", { class: "btn ghost", onclick: () => go("plugins", "discover", market.name) }, "Browse"), remove),
  );
}

async function renderMarketplaces(body) {
  const markets = (await attempt(() => api("/api/marketplaces"))) ?? [];
  const refresh = el("button", { class: "btn ghost" }, icon("refresh", 14), "Refresh all");
  refresh.addEventListener("click", () =>
    withBusy(refresh, async () => {
      await post("/api/marketplaces/refresh");
      toast("Marketplaces refreshed");
    }),
  );
  body.replaceChildren(
    addMarketplaceForm(new Set(markets.map((m) => m.name))),
    el(
      "section",
      { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", { class: "panel-title" }, `Marketplaces (${markets.length})`), refresh),
      el("div", { class: "card-list stagger" }, stagger(markets.map(marketplaceRow))),
    ),
  );
}

export function renderPlugins(main, tab, marketplace) {
  const active = TABS.includes(tab) ? tab : "installed";
  const body = el("div", { class: "page-body" }, skeleton(6));
  main.replaceChildren(el("div", { class: "view" }, header(active), body));
  if (active === "discover") return renderDiscover(body, marketplace);
  if (active === "marketplaces") return renderMarketplaces(body);
  return renderInstalled(body);
}
