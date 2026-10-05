import { el } from "./dom.js";
import { state } from "./state.js";
import { ask } from "./ui.js";

function deleteButton(title, deleteMessage, onDelete) {
  return el(
    "button",
    {
      class: "btn danger",
      onclick: async () => {
        if (!(await ask({ title: `Delete ${title}?`, message: deleteMessage, okLabel: "Delete", danger: true }))) return;
        if (await onDelete()) state.dirtyDoc = false;
      },
    },
    "Delete",
  );
}

// Shared by CLAUDE.md/memory docs and skills: tracks unsaved edits so navigation can warn about them.
export function markdownEditor({ title, meta, content, isNew = false, readOnly = false, onSave, onDelete, deleteMessage, notice }) {
  const editor = el("textarea", { class: "editor", spellcheck: "false", readonly: readOnly, "aria-label": `${title} contents` });
  editor.value = content;

  const saveBtn = readOnly
    ? null
    : el("button", { class: "btn primary", disabled: !isNew, onclick: () => save() }, isNew ? "Create file" : "Save");
  const canDelete = !readOnly && !isNew && onDelete;

  editor.addEventListener("input", () => {
    state.dirtyDoc = editor.value !== content;
    if (saveBtn) saveBtn.disabled = !state.dirtyDoc && !isNew;
  });
  editor.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (saveBtn && !saveBtn.disabled) save();
    }
  });

  async function save() {
    saveBtn.disabled = true;
    const ok = await onSave(editor.value);
    if (ok) state.dirtyDoc = false;
    else saveBtn.disabled = false;
  }

  const nodes = [
    el(
      "div",
      { class: "toolbar" },
      el("strong", { class: "toolbar-title" }, title),
      el("span", { class: "spacer" }),
      readOnly ? el("span", { class: "badge" }, "Read-only") : null,
      canDelete ? deleteButton(title, deleteMessage, onDelete) : null,
      saveBtn,
    ),
    el("div", { class: "meta-line" }, meta),
    notice ? el("div", { class: "notice" }, notice) : null,
    editor,
  ];
  return { nodes, focus: () => !readOnly && editor.focus() };
}
