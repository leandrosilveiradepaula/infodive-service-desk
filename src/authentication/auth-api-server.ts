import { createServer } from "node:http";
import { createRequestSessionDependencies } from "./session-adapters";
import { createSupabaseIdentityProvider } from "./supabase-identity";
import { createSupabaseMembershipRepository } from "./supabase-memberships";
import { extractAccessToken, verifyTenantSelection } from "./session-cookies";
import { handleSessionHttpRequest } from "./session-http";
import { issueCsrf, clearAuthCookies } from "./csrf-cookie";
import { selectTenant } from "./select-tenant";
import { validLogoutRequest } from "./logout-policy";

export interface AuthApiConfig {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly secretKey: string;
  readonly tenantSigningKey: string;
  readonly publicOrigin: string;
}
export function createAuthApiServer(config: AuthApiConfig, request: typeof fetch = fetch) {
  if (!config.publicOrigin.startsWith("https://") || config.tenantSigningKey.length < 32)
    throw Error("Invalid auth API configuration");
  const identity = createSupabaseIdentityProvider(config.supabaseUrl, config.anonKey, extractAccessToken, request);
  const memberships = createSupabaseMembershipRepository(config.supabaseUrl, config.secretKey, request);
  return createServer(async (incoming, response) => {
    const headers = {
      cookie: incoming.headers.cookie,
      origin: incoming.headers.origin,
      "x-csrf-token": incoming.headers["x-csrf-token"] as string | undefined
    };
    const send = (status: number, body: unknown, extra: Record<string, string | string[]> = {}) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        ...extra
      });
      response.end(JSON.stringify(body));
    };
    try {
      const path = (incoming.url ?? "").split("?")[0];
      if (path === "/api/auth/csrf") {
        const result = issueCsrf(incoming.method ?? "");
        send(result.status, result.body, result.headers);
        return;
      }
      if (path === "/api/auth/select-tenant") {
        if (incoming.method !== "POST") {
          send(405, { ok: false }, { Allow: "POST" });
          return;
        }
        let body = "";
        for await (const chunk of incoming) {
          body += String(chunk);
          if (body.length > 1024) { send(413, { ok: false }); return; }
        }
        let tenantId: unknown;
        try { tenantId = (JSON.parse(body) as Record<string, unknown>).tenantId; }
        catch { send(400, { ok: false }); return; }
        const result = await selectTenant({
          method: "POST", headers, tenantId: typeof tenantId === "string" ? tenantId : ""
        }, { origin: config.publicOrigin, signingKey: config.tenantSigningKey, identity, memberships });
        send(result.status, result.body, result.headers);
        return;
      }
      if (path === "/api/auth/logout") {
        if (incoming.method !== "POST") { send(405, { ok: false }, { Allow: "POST" }); return; }
        const origin = incoming.headers.origin;
        if (!validLogoutRequest(headers, config.publicOrigin)) { send(403, { ok: false }); return; }
        send(200, { ok: true }, { "Set-Cookie": clearAuthCookies() });
        return;
      }
      let verifiedUserId: string | null = null;
      const dependencies = createRequestSessionDependencies(headers, {
        verifySession: async h => {
          const user = await identity.verifySession(h);
          verifiedUserId = user?.userId ?? null;
          return user;
        }
      }, memberships, {
        selectedTenantId: async () => verifiedUserId
          ? verifyTenantSelection(headers.cookie, verifiedUserId, config.tenantSigningKey) : null
      });
      const result = await handleSessionHttpRequest({
        method: incoming.method ?? "", url: incoming.url ?? "", headers
      }, dependencies);
      if (!result) { send(404, { error: "not_found" }); return; }
      send(result.status, result.body, result.headers);
    } catch { send(503, { ok: false }); }
  });
}
