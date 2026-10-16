import type { MembershipRepository, MembershipRecord } from "./session-adapters";
type JsonFetch = (url: string, init: RequestInit) => Promise<Response>;
export function createSupabaseMembershipRepository(
  baseUrl: string, secretKey: string, request: JsonFetch
): MembershipRepository {
  if (!baseUrl.startsWith("https://") || !secretKey.trim()) throw Error("Missing Supabase server configuration");
  return {
    findByUserId: async userId => {
      if (!/^[0-9a-f-]{36}$/.test(userId)) return [];
      const url = new URL(baseUrl.replace(/\/$/, "") + "/rest/v1/memberships");
      url.searchParams.set("select", "user_id,tenant_id,status,roles!inner(code),tenants!inner(name)");
      url.searchParams.set("user_id", "eq." + userId);
      url.searchParams.set("status", "eq.active");
      const response = await request(url.toString(), {
        method: "GET", headers: { apikey: secretKey, Authorization: "Bearer " + secretKey },
        cache: "no-store", signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw Error("Membership lookup failed");
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw Error("Malformed membership response");
      return rows.map((value): MembershipRecord => {
        if (typeof value !== "object" || !value) throw Error("Malformed membership row");
        const row = value as Record<string, unknown>;
        const role = row.roles as Record<string, unknown> | null;
        const tenant = row.tenants as Record<string, unknown> | null;
        if (typeof row.user_id !== "string" || typeof row.tenant_id !== "string" ||
            typeof role?.code !== "string" || typeof tenant?.name !== "string" ||
            row.status !== "active") throw Error("Malformed membership relation");
        return {
          userId: row.user_id, tenantId: row.tenant_id, tenantName: tenant.name,
          displayName: row.user_id, roleCode: role.code, membershipStatus: "active"
        };
      });
    }
  };
}
