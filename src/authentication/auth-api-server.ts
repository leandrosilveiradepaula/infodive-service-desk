import { createServer } from "node:http";
import { serveStaticWeb } from "./static-web";
import { createRequestSessionDependencies } from "./session-adapters";
import { createSupabaseIdentityProvider } from "./supabase-identity";
import { createSupabaseMembershipRepository } from "./supabase-memberships";
import { extractAccessToken, verifyTenantSelection } from "./session-cookies";
import { handleSessionHttpRequest } from "./session-http";
import { issueCsrf, clearAuthCookies } from "./csrf-cookie";
import { selectTenant } from "./select-tenant";
import { validLogoutRequest } from "./logout-policy";
import { exchangeCredentials } from "./credential-exchange";
import { signTenantSelection, issueAuthCookies, readSignedTenantSelection, extractRefreshToken } from "./session-cookies";
import { rotateSession } from "./refresh-session";
import { revokeCurrentSession } from "./revoke-session";

export interface AuthApiConfig {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly secretKey: string;
  readonly tenantSigningKey: string;
  readonly publicOrigin: string;
  readonly webRoot?: string;
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
      if (path === "/api/auth/login") {
        if (incoming.method !== "POST") { send(405, { ok: false }, { Allow: "POST" }); return; }
        if (!validLogoutRequest(headers, config.publicOrigin)) { send(403, { ok: false }); return; }
        let raw = "";
        for await (const chunk of incoming) {
          raw += String(chunk);
          if (raw.length > 4096) { send(413, { ok: false }); return; }
        }
        let payload: Record<string, unknown>;
        try {
          const value: unknown = JSON.parse(raw);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid");
          payload = value as Record<string, unknown>;
        } catch { send(400, { ok: false }); return; }
        const result = await exchangeCredentials({
          supabaseUrl: config.supabaseUrl, anonKey: config.anonKey, memberships
        }, {
          email: typeof payload.email === "string" ? payload.email : "",
          password: typeof payload.password === "string" ? payload.password : "",
          tenantId: typeof payload.tenantId === "string" ? payload.tenantId : ""
        }, request);
        if (result.status !== 200 || !result.token || !result.refreshToken || !result.userId || !result.expiresIn) {
          send(result.status, { ok: false }); return;
        }
        if (!result.selectedTenantId) {
          send(409, { ok: false, code: "tenant_selection_required", tenants: result.tenants }); return;
        }
        const selection = signTenantSelection(result.userId, result.selectedTenantId,
          Date.now() + result.expiresIn * 1000, config.tenantSigningKey);
        send(200, { ok: true }, { "Set-Cookie": issueAuthCookies(result.token, result.refreshToken,
          selection, result.expiresIn) });
        return;
      }
      if (path === "/api/auth/refresh") {
        if (incoming.method !== "POST") { send(405, { ok: false }, { Allow: "POST" }); return; }
        if (!validLogoutRequest(headers, config.publicOrigin)) { send(403, { ok: false }); return; }
        const refresh = extractRefreshToken(headers.cookie);
        const selection = readSignedTenantSelection(headers.cookie, config.tenantSigningKey);
        if (!refresh || !selection) {
          send(401, { ok: false }, { "Set-Cookie": [...clearAuthCookies()] }); return;
        }
        const tenant = selection.tenantId;
        const rotated = await rotateSession({
          supabaseUrl: config.supabaseUrl, anonKey: config.anonKey, memberships
        }, refresh, tenant, request);
        if (rotated.status !== 200 || !rotated.token || !rotated.refreshToken || !rotated.userId || !rotated.expiresIn) {
          send(rotated.status, { ok: false }, rotated.status === 503 ? {} : { "Set-Cookie": [...clearAuthCookies()] }); return;
        }
        if (rotated.userId !== selection.userId) {
          send(403, { ok: false }, { "Set-Cookie": [...clearAuthCookies()] }); return;
        }
        const signed = signTenantSelection(rotated.userId, tenant, Date.now() + rotated.expiresIn * 1000, config.tenantSigningKey);
        send(200, { ok: true }, { "Set-Cookie": issueAuthCookies(
          rotated.token, rotated.refreshToken, signed, rotated.expiresIn
        ) });
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
        if (!validLogoutRequest(headers, config.publicOrigin)) { send(403, { ok: false }); return; }
        const revoke = await revokeCurrentSession(config.supabaseUrl, config.anonKey, headers.cookie, request);
        send(revoke === "unavailable" ? 503 : 200, { ok: revoke !== "unavailable" },
          { "Set-Cookie": [...clearAuthCookies()] });
        return;
      }
      if (await serveStaticWeb(incoming.method ?? "", path, config.webRoot, response)) return;
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
