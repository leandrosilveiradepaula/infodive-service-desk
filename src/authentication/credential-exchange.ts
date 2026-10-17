import { createSupabaseIdentityProvider } from "./supabase-identity";
import { extractAccessToken } from "./session-cookies";
import { revokeCurrentSession } from "./revoke-session";
import type { MembershipRepository } from "./session-adapters";

export interface AvailableTenant { readonly id: string; readonly name: string; }

export async function exchangeCredentials(
  config: { supabaseUrl: string; anonKey: string; memberships: MembershipRepository },
  input: { email: string; password: string; tenantId: string },
  request: typeof fetch
): Promise<{ status: number; token?: string; userId?: string; expiresIn?: number; refreshToken?: string;
  selectedTenantId?: string; tenants?: readonly AvailableTenant[] }> {
  let unclaimedToken: string | null = null;
  if (!input.email || input.email.length > 254 || !input.password ||
      input.password.length > 1024 ||
      (input.tenantId !== "" && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(input.tenantId))) return { status: 400 };
  try {
    const response = await request(config.supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: input.email, password: input.password }),
      cache: "no-store", signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { status: response.status === 400 || response.status === 401 ? 401 : 503 };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return { status: 503 };
    const values = payload as Record<string, unknown>;
    if (typeof values.access_token !== "string" || values.access_token.length < 10 ||
        values.access_token.length > 8192 || typeof values.expires_in !== "number" ||
        !Number.isFinite(values.expires_in) || values.expires_in < 1) return { status: 503 };
    if (typeof values.refresh_token !== "string" || values.refresh_token.length < 10 ||
        values.refresh_token.length > 8192) return { status: 503 };
    const token = values.access_token;
    unclaimedToken = token;
    const provider = createSupabaseIdentityProvider(config.supabaseUrl, config.anonKey, extractAccessToken, request);
    // A password grant creates a provider session even when local authorization fails.
    // Revoke abandoned sessions rather than leave untracked refresh grants active.
    const rejectedGrant = async (status: 401 | 403): Promise<{ status: number }> => {
      const revoked = await revokeCurrentSession(config.supabaseUrl, config.anonKey,
        "sd-access-token=" + encodeURIComponent(token), request);
      return { status: revoked === "revoked" ? status : 503 };
    };
    const identity = await provider.verifySession({ cookie: "sd-access-token=" + encodeURIComponent(token) });
    if (!identity) return rejectedGrant(401);
    const rows = await config.memberships.findByUserId(identity.userId);
    const allowedRoles = new Set(["tenant_administrator", "service_manager", "service_agent",
      "requester", "customer_administrator", "customer_user"]);
    const active = rows.filter(row => row.userId === identity.userId && row.membershipStatus === "active");
    const choices = new Map<string, string>();
    // Untrusted/inconsistent membership records never become a selectable company.
    for (const row of active) {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(row.tenantId) ||
          !allowedRoles.has(row.roleCode) || !row.displayName.trim() || !row.tenantName.trim() ||
          (choices.has(row.tenantId) && choices.get(row.tenantId) !== row.tenantName))
        return rejectedGrant(403);
      choices.set(row.tenantId, row.tenantName);
    }
    if (!choices.size || choices.size > 50) return rejectedGrant(403);
    const tenants = [...choices].map(([id, name]): AvailableTenant => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const selectedTenantId = input.tenantId ||
      (tenants.length === 1 ? tenants[0]?.id : undefined);
    if (selectedTenantId && !choices.has(selectedTenantId)) return rejectedGrant(403);
    return { status: 200, token, refreshToken: values.refresh_token, userId: identity.userId,
      expiresIn: Math.min(Math.floor(values.expires_in), 3600), selectedTenantId, tenants };
  } catch {
    if (unclaimedToken) await revokeCurrentSession(config.supabaseUrl, config.anonKey,
      "sd-access-token=" + encodeURIComponent(unclaimedToken), request);
    return { status: 503 };
  }
}
