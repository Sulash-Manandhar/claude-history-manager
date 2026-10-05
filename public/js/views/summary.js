import { bulletList, el, formatDuration, formatRelative, icon } from "../dom.js";
import { api, post, withBusy } from "../ui.js";

function chips(summary) {
  const items = [
    `${summary.prompts} prompts`,
    `${summary.replies} replies`,
    `${summary.toolCalls} tool calls`,
    formatDuration(summary.durationMs),
    ...summary.topTools.map((t) => `${t.name} ×${t.count}`),
  ];
  return el("div", { class: "chips" }, items.map((text) => el("span", { class: "chip" }, text)));
}

function field(label, text) {
  if (!text) return null;
  return el("div", { class: "summary-field" }, el("dt", {}, label), el("dd", {}, text));
}

function aiResult(result) {
  const staleNote = result.isStale ? " · chat has changed since — regenerate for the latest" : "";
  return el(
    "div",
    { class: "ai-result" },
    bulletList(result.text),
    el("div", { class: "meta-line" }, `AI summary · ${formatRelative(result.generatedAt)}${staleNote}`),
  );
}

function filesChanged(files) {
  if (!files.length) return null;
  return el(
    "details",
    { class: "files" },
    el("summary", {}, `${files.length} files changed`),
    el("ul", {}, files.map((f) => el("li", {}, el("code", {}, f)))),
  );
}

// Instant structural summary, plus an optional Claude-written one that runs only when asked.
export function summaryCard(base, quick) {
  const aiSlot = el("div", {});
  const aiLabel = el("span", {}, "AI summary");
  const aiButton = el(
    "button",
    { class: "btn ghost", title: "Runs Claude Code (Haiku, no tools) on your account" },
    icon("wand", 14),
    aiLabel,
  );

  const showAi = (result) => {
    aiSlot.replaceChildren(aiResult(result));
    aiLabel.textContent = "Regenerate";
  };
  aiButton.addEventListener("click", () =>
    withBusy(aiButton, async () => {
      const previous = [...aiSlot.childNodes];
      aiSlot.replaceChildren(el("div", { class: "shimmer-text" }, "Claude is reading the chat…"));
      try {
        showAi(await post(`${base}/summary`));
      } catch (error) {
        aiSlot.replaceChildren(...previous);
        throw error;
      }
    }),
  );
  // A missing cache is normal; a failed lookup just leaves the button for a fresh run.
  api(`${base}/summary`).then((cached) => cached && showAi(cached), () => {});

  return el(
    "section",
    { class: "summary-card" },
    el("div", { class: "summary-head" }, icon("spark", 16), el("strong", {}, "Summary"), el("span", { class: "spacer" }), aiButton),
    el("dl", { class: "summary-grid" }, field("Goal", quick.goal), field("Outcome", quick.outcome)),
    chips(quick),
    filesChanged(quick.filesChanged),
    aiSlot,
  );
}
