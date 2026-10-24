/** Auth/ticket Vercel adapter. Fail closed without server-side credentials.
 * Uses the same handler as the persistent Node server, never a mock API.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAuthApiHandler, type AuthApiConfig } from "./auth-api-server";

export type VercelApiPath =
  | "/api/auth/csrf"
  | "/api/auth/login"
  | "/api/auth/select-tenant"
  | "/api/auth/refresh"
  | "/api/auth/logout"
  | "/api/session"
  | "/api/tickets"
  | "/api/tickets/:id";

const ticketDetailPath = /^\/api\/tickets\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const vercelHostname = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.vercel\.app$/;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || !value.trim()) throw Error("Missing server config");
  return value;
}

export function resolveVercelApiConfig(env: NodeJS.ProcessEnv): AuthApiConfig {
  // Preview uses immutable Vercel environment, never an untrusted Host header.
  const origin = env.VERCEL_ENV === "preview"
    ? (() => {
        const host = required(env, "VERCEL_URL");
        if (!vercelHostname.test(host)) throw Error("Invalid preview origin");
        return "https://" + host;
      })()
    : required(env, "SERVICE_DESK_PUBLIC_ORIGIN");
  if (!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(origin) || origin.includes("..")) {
    throw Error("Invalid server origin");
  }
  return {
    supabaseUrl: required(env, "SERVICE_DESK_SUPABASE_URL"),
    anonKey: required(env, "SERVICE_DESK_SUPABASE_ANON_KEY"),
    secretKey: required(env, "SERVICE_DESK_SUPABASE_SECRET_KEY"),
    tenantSigningKey: required(env, "SERVICE_DESK_TENANT_SIGNING_KEY"),
    publicOrigin: origin
  };
}

function jsonError(response: ServerResponse, status: number, error: string): void {
  if (response.writableEnded) return;
  if (response.headersSent) { response.end(); return; }
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify({ ok: false, error }));
}

export function createVercelApiHandler(
  exactRoute: VercelApiPath,
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch
) {
  let delegate: ReturnType<typeof createAuthApiHandler> | undefined;
  return async (incoming: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = (incoming.url ?? "").split("?", 1)[0];
    const matches = exactRoute === "/api/tickets/:id"
      ? ticketDetailPath.test(path)
      : path === exactRoute;
    if (!matches) { jsonError(response, 404, "not_found"); return; }
    try {
      // Static Preview may build without backend credentials; requests may not.
      delegate ??= createAuthApiHandler(resolveVercelApiConfig(env), request);
      await delegate(incoming, response);
    } catch {
      jsonError(response, 503, "backend_unavailable");
    }
  };
}
