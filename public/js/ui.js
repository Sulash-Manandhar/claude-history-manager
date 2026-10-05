import { $, el } from "./dom.js";

const TOAST_MS = 3200;
const TOAST_EXIT_MS = 220;

export async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", "x-chm-request": "1", ...(options.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const post = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });

export function toast(message, isError = false) {
  const node = el("div", { class: `toast${isError ? " error" : ""}`, role: isError ? "alert" : "status" }, message);
  $("#toasts").append(node);
  setTimeout(() => {
    node.classList.add("leaving");
    setTimeout(() => node.remove(), TOAST_EXIT_MS);
  }, TOAST_MS);
}

export async function attempt(fn) {
  try {
    return await fn();
  } catch (error) {
    toast(error.message, true);
    return undefined;
  }
}

// Disables the button and shows a spinner for the duration of a slow action (CLI calls can take seconds).
export async function withBusy(button, fn) {
  button.disabled = true;
  button.classList.add("busy");
  try {
    return await attempt(fn);
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
  }
}

export function ask({ title, message = "", input = null, okLabel = "OK", danger = false, placeholder = "" }) {
  const dialog = $("#dialog");
  $("#dialog-title").textContent = title;
  $("#dialog-message").textContent = message;
  const field = $("#dialog-input");
  field.hidden = input === null;
  field.value = input ?? "";
  field.placeholder = placeholder;
  const ok = $("#dialog-ok");
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? "danger-solid" : "primary"}`;
  dialog.showModal();
  if (input !== null) field.select();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "ok" ? (input === null ? true : field.value) : null),
      { once: true },
    );
  });
}
