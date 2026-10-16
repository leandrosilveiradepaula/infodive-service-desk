import type { MembershipRepository, MembershipRecord } from "./session-adapters";
type JsonFetch = (url: string, init: RequestInit) => Promise<Response>;
export function createSupabaseMembershipRepository(baseUrl: string, secretKey: string, request: JsonFetch): MembershipRepository {
  if (!baseUrl.startsWith("https://") || !secretKey.trim()) throw Error("Missing Supabase server configuration");
  async function getRows(path: string, query: Record<string, string>): Promise<unknown[]> {
    const url = new URL(baseUrl.replace(/\/$/, "") + "/rest/v1/" + path);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const response = await request(url.toString(), {
      method: "GET", headers: { apikey: secretKey, Authorization: "Bearer " + secretKey },
      cache: "no-store", signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw Error("Supabase lookup failed");
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw Error("Malformed Supabase response");
    return rows;
  }
  return {
    findByUserId: async userId => {
      if (!/^[0-9a-f-]{36}$/.test(userId)) return [];
      const [memberships, users] = await Promise.all([
        getRows("memberships", { select: "user_id,tenant_id,status,roles!inner(code,tenant_id),tenants!inner(name)", user_id: "eq." + userId, status: "eq.active" }),
        getRows("users", { select: "id,tenant_id,display_name", id: "eq." + userId })
      ]);
      return memberships.map((value): MembershipRecord => {
        if (typeof value !== "object" || !value) throw Error("Malformed membership");
        const row = value as Record<string, unknown>;
        const role = row.roles as Record<string, unknown> | null;
        const tenant = row.tenants as Record<string, unknown> | null;
        const user = users.find(item => {
          if (typeof item !== "object" || !item) return false;
          const entry = item as Record<string, unknown>;
          return entry.id === userId && entry.tenant_id === row.tenant_id;
        }) as Record<string, unknown> | undefined;
        if (row.user_id !== userId || typeof row.tenant_id !== "string" ||
            typeof role?.code !== "string" || role.tenant_id !== row.tenant_id ||
            typeof tenant?.name !== "string" || typeof user?.display_name !== "string" ||
            !user.display_name.trim() || row.status !== "active") throw Error("Invalid membership relation");
        return {
          userId, tenantId: row.tenant_id, tenantName: tenant.name,
          displayName: user.display_name, roleCode: role.code, membershipStatus: "active"
        };
      });
    }
  };
}
