import { join } from "node:path";
import { type Params, createGuard, json } from "./http";
import { resolveAppPaths } from "./lib/paths";
import { chatRoutes } from "./routes/chats";
import { docRoutes, pluginRoutes, skillRoutes, trashRoutes } from "./routes/library";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4545);
const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const MODULE_NAME_PATTERN = /^[a-z][a-z-]*\.js$/;
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  // Inline styles stay allowed because the UI sets per-element animation delays via style attributes.
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

const paths = resolveAppPaths();
const guard = createGuard(ALLOWED_HOSTS);

function staticFile(name: string, type: string) {
  return () =>
    new Response(Bun.file(join(PUBLIC_DIR, name)), { headers: { "content-type": type, ...SECURITY_HEADERS } });
}

// Front-end ES modules: names are pattern-checked so the URL can never walk out of public/js.
function jsModule(folder: string) {
  return async (req: Request & { params: Params }) => {
    const name = req.params.file ?? "";
    const file = Bun.file(join(PUBLIC_DIR, folder, name));
    if (!MODULE_NAME_PATTERN.test(name) || !(await file.exists())) return json({ error: "Not found" }, 404);
    return new Response(file, { headers: { "content-type": "text/javascript; charset=utf-8" } });
  };
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  // Bun's 10s default would cut off CLI-backed requests (AI summaries, plugin installs); 255s is its maximum.
  idleTimeout: 255,
  routes: {
    "/": staticFile("index.html", "text/html; charset=utf-8"),
    "/styles.css": staticFile("styles.css", "text/css; charset=utf-8"),
    "/logo.svg": staticFile("logo.svg", "image/svg+xml"),
    "/js/:file": jsModule("js"),
    "/js/views/:file": jsModule(join("js", "views")),
    ...chatRoutes(paths, guard),
    ...docRoutes(paths, guard),
    ...trashRoutes(paths, guard),
    ...pluginRoutes(paths, guard),
    ...skillRoutes(paths, guard),
  },
  fetch: () => json({ error: "Not found" }, 404),
});

console.log(`Claude History Manager → http://localhost:${server.port}`);
console.log(`Reading ${paths.claudeHome} · trash, backups & summaries in ${paths.dataDir}`);
