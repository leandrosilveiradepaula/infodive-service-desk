import { createSupabaseIdentityProvider } from "./supabase-identity";
import { extractAccessToken } from "./session-cookies";
import { revokeCurrentSession } from "./revoke-session";
import type { MembershipRepository } from "./session-adapters";

/** Refresh tokens stay in an HttpOnly cookie and never enter browser JavaScript. */
export async function rotateSession(
  config: { supabaseUrl: string; anonKey: string; memberships: MembershipRepository },
  refreshToken: string, tenantId: string, request: typeof fetch
): Promise<{ status: number; token?: string; refreshToken?: string; userId?: string; expiresIn?: number }> {
  let issued: string | null = null;
  const reject = async (status: number) => {
    if (!issued) return { status };
    const revoked = await revokeCurrentSession(config.supabaseUrl, config.anonKey,
      "sd-access-token=" + encodeURIComponent(issued), request);
    return { status: revoked === "revoked" ? status : 503 };
  };
  if (refreshToken.length < 10 || refreshToken.length > 8192 || !/^[0-9a-f-]{36}$/.test(tenantId)) return { status: 401 };
  try {
    const response = await request(config.supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }), cache: "no-store", signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { status: response.status === 400 || response.status === 401 ? 401 : 503 };
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return { status: 503 };
    const payload = value as Record<string, unknown>;
    if (typeof payload.access_token === "string" && payload.access_token.length >= 10 &&
        payload.access_token.length <= 8192) issued = payload.access_token;
    if (typeof payload.access_token !== "string" || payload.access_token.length < 10 || payload.access_token.length > 8192 ||
        typeof payload.refresh_token !== "string" || payload.refresh_token.length < 10 || payload.refresh_token.length > 8192 ||
        typeof payload.expires_in !== "number" || !Number.isFinite(payload.expires_in) || payload.expires_in < 1) return reject(503);
    const provider = createSupabaseIdentityProvider(config.supabaseUrl, config.anonKey, extractAccessToken, request);
    const identity = await provider.verifySession({ cookie: "sd-access-token=" + encodeURIComponent(payload.access_token) });
    if (!identity) return reject(401);
    const memberships = await config.memberships.findByUserId(identity.userId);
    const allowed = new Set(["tenant_administrator", "service_manager", "service_agent",
      "requester", "customer_administrator", "customer_user"]);
    const selected = memberships.filter(row => row.userId === identity.userId &&
      row.tenantId === tenantId && row.membershipStatus === "active");
    if (!selected.length || !selected.every(row => allowed.has(row.roleCode) &&
      row.tenantName.trim() && row.displayName.trim())) return reject(403);
    return { status: 200, token: payload.access_token, refreshToken: payload.refresh_token,
      userId: identity.userId, expiresIn: Math.min(Math.floor(payload.expires_in), 3600) };
  } catch {
    if (issued) await revokeCurrentSession(config.supabaseUrl, config.anonKey,
      "sd-access-token=" + encodeURIComponent(issued), request);
    return { status: 503 };
  }
}
