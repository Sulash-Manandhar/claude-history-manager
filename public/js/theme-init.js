// Runs before first paint (classic blocking script) so a saved theme never flashes the wrong colors.
(() => {
  try {
    const saved = localStorage.getItem("chm-theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch {
    // Storage can be blocked (private mode); the system theme is the fallback.
  }
})();
