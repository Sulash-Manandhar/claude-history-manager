const MAX_STAGGER_INDEX = 14;
const COUNT_UP_MS = 700;

export const $ = (sel) => document.querySelector(sel);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Constant, trusted path data only — never pass user content here.
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  wand: '<path d="m15 4 5 5L9 20H4v-5zM13 6l5 5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
};

export function icon(name, size = 16) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  svg.innerHTML = ICONS[name] ?? "";
  return svg;
}

// Gives each child an index so CSS can cascade its entrance animation.
export function stagger(nodes) {
  nodes.forEach((node, i) => node.style?.setProperty("--i", Math.min(i, MAX_STAGGER_INDEX)));
  return nodes;
}

export function skeleton(rows = 4) {
  return el("div", { class: "skeleton-list", "aria-busy": "true" }, Array.from({ length: rows }, () => el("div", { class: "skeleton" })));
}

export function emptyState(title, hint = "", iconName = "chat") {
  return el(
    "div",
    { class: "empty-state" },
    el("div", { class: "empty-icon" }, icon(iconName, 28)),
    el("strong", {}, title),
    hint ? el("span", {}, hint) : null,
  );
}

export function countUp(node, target, format = (n) => String(Math.round(n))) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !target) {
    node.textContent = format(target);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / COUNT_UP_MS);
    node.textContent = format(target * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export function formatBytes(n) {
  if (n < KB) return `${Math.round(n)} B`;
  if (n < MB) return `${(n / KB).toFixed(1)} KB`;
  if (n < GB) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / GB).toFixed(2)} GB`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const RELATIVE_STEPS = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.35, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

export function formatRelative(iso) {
  if (!iso) return "—";
  let value = (Date.parse(iso) - Date.now()) / 1000;
  for (const [size, unit] of RELATIVE_STEPS) {
    if (Math.abs(value) < size) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(value), unit);
    }
    value /= size;
  }
  return formatDate(iso);
}

export function formatDuration(ms) {
  if (ms == null) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.round(hours / 24)} days`;
}

// Fenced code becomes <pre>; everything else stays plain text so transcript content can never inject HTML.
export function richText(text) {
  const parts = text.split(/```[^\n]*\n?/);
  return parts.map((part, i) => (i % 2 ? el("pre", {}, part.replace(/\n$/, "")) : part));
}

// Model output rendered as a plain-text bullet list (markdown emphasis stripped, never parsed as HTML).
export function bulletList(text) {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").replace(/\*\*(.+?)\*\*/g, "$1").trim())
    .filter(Boolean);
  return el("ul", { class: "bullets" }, stagger(lines.map((l) => el("li", {}, l))));
}
