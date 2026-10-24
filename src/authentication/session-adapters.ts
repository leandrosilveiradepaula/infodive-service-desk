import type { SessionDependencies, ServerIdentity, TenantMembership } from "./server-session";

export interface VerifiedIdentityProvider {
  verifySession(headers: Readonly<Record<string, string | undefined>>): Promise<ServerIdentity | null>;
}
export interface MembershipRecord {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly displayName: string;
  readonly roleCode: string;
  readonly membershipStatus: "active" | "suspended";
}
export interface MembershipRepository {
  findByUserId(userId: string): Promise<readonly MembershipRecord[]>;
}
export interface TenantSelection {
  selectedTenantId(headers: Readonly<Record<string, string | undefined>>): Promise<string | null>;
}
export function createRequestSessionDependencies(
  headers: Readonly<Record<string, string | undefined>>,
  identity: VerifiedIdentityProvider,
  memberships: MembershipRepository,
  selection: TenantSelection
): SessionDependencies {
  return {
    verifyIdentity: incoming => identity.verifySession(incoming),
    findActiveMembership: async userId => {
      const tenantId = await selection.selectedTenantId(headers);
      if (!tenantId?.trim()) return null;
      const rows = (await memberships.findByUserId(userId)).filter(
        row => row.userId === userId && row.tenantId === tenantId && row.membershipStatus === "active"
      );
      if (rows.length === 0) return null;
      const tenantName = rows[0]?.tenantName;
      const displayName = rows[0]?.displayName;
      if (!tenantName?.trim() || !displayName?.trim() || rows.some(row =>
        row.tenantName !== tenantName || row.displayName !== displayName
      )) return null;
      const roles = [...new Set(rows.map(row => row.roleCode))];
      const result: TenantMembership = { tenantId, tenantName, displayName, roles };
      return result;
    }
  };
}
