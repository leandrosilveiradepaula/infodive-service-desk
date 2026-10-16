import { createSupabaseIdentityProvider } from "./supabase-identity";
import { extractAccessToken } from "./session-cookies";
import type { MembershipRepository } from "./session-adapters";

export async function exchangeCredentials(
  config: { supabaseUrl: string; anonKey: string; memberships: MembershipRepository },
  input: { email: string; password: string; tenantId: string },
  request: typeof fetch
): Promise<{ status: number; token?: string; userId?: string; expiresIn?: number; refreshToken?: string }> {
  if (!input.email || input.email.length > 254 || !input.password ||
      input.password.length > 1024 || !/^[0-9a-f-]{36}$/.test(input.tenantId)) return { status: 400 };
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
    const provider = createSupabaseIdentityProvider(config.supabaseUrl, config.anonKey, extractAccessToken, request);
    const identity = await provider.verifySession({ cookie: "sd-access-token=" + encodeURIComponent(token) });
    if (!identity) return { status: 401 };
    const rows = await config.memberships.findByUserId(identity.userId);
    const selected = rows.filter(row => row.userId === identity.userId && row.tenantId === input.tenantId &&
      row.membershipStatus === "active");
    const allowedRoles = new Set(["tenant_administrator", "service_manager", "service_agent",
      "requester", "customer_administrator", "customer_user"]);
    if (!selected.length || !selected.every(row => allowedRoles.has(row.roleCode) &&
      row.tenantName.trim() && row.displayName.trim())) return { status: 403 };
    return { status: 200, token, refreshToken: values.refresh_token, userId: identity.userId, expiresIn: Math.min(Math.floor(values.expires_in), 3600) };
  } catch { return { status: 503 }; }
}
