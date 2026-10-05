import { HttpError } from "./lib/paths";

export type Params = Record<string, string>;
export type Handler = (req: Request, params: Params) => Promise<Response>;
export type GuardedHandler = (req: Request & { params: Params }) => Promise<Response>;
export type Guard = (handler: Handler) => GuardedHandler;

// Browsers can't attach custom headers cross-origin without a preflight we never grant,
// so requiring one blocks drive-by requests from other sites against this local API.
const CSRF_HEADER = "x-chm-request";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function bodyOf<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${field} is required`);
  return value;
}

export function createGuard(allowedHosts: ReadonlySet<string>): Guard {
  return (handler) => async (req) => {
    // Rejecting foreign Host headers defeats DNS-rebinding attacks on a localhost server.
    if (!allowedHosts.has(req.headers.get("host") ?? "")) return json({ error: "Forbidden host" }, 403);
    if (req.method !== "GET" && req.headers.get(CSRF_HEADER) !== "1") {
      return json({ error: "Missing request header" }, 403);
    }
    try {
      return await handler(req, req.params ?? {});
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(`[${req.method} ${new URL(req.url).pathname}]`, error);
      return json({ error: "Unexpected server error" }, 500);
    }
  };
}
