import { el, icon } from "./dom.js";

const STORAGE_KEY = "chm-theme";
const THEMES = [
  { id: "system", label: "System", icon: "monitor" },
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
];

function savedTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisted, but still applied for this visit.
  }
}

export function themeSwitcher() {
  let current = savedTheme();
  const buttons = THEMES.map((t) =>
    el(
      "button",
      {
        class: "theme-option",
        title: `${t.label} theme`,
        "aria-label": `${t.label} theme`,
        "aria-pressed": String(t.id === current),
      },
      icon(t.icon, 15),
    ),
  );
  buttons.forEach((button, i) =>
    button.addEventListener("click", () => {
      current = THEMES[i].id;
      applyTheme(current);
      buttons.forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
    }),
  );
  return el("div", { class: "theme-switch", role: "group", "aria-label": "Color theme" }, buttons);
}
