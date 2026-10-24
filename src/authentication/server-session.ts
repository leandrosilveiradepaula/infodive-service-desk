import { UNAUTHENTICATED_SESSION, type VerifiedSessionResponse } from "./session-contract";

export interface ServerIdentity { readonly userId: string; readonly email: string; }
export interface TenantMembership {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly displayName: string;
  readonly roles: readonly string[];
}
export interface SessionDependencies {
  verifyIdentity(headers: Readonly<Record<string, string | undefined>>): Promise<ServerIdentity | null>;
  findActiveMembership(userId: string): Promise<TenantMembership | null>;
}
export interface SessionResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: VerifiedSessionResponse;
}
const responseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, private",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff"
};
const roles = new Set(["tenant_administrator", "service_manager", "service_agent", "requester", "customer_administrator", "customer_user"]);
export async function resolveServerSession(
  headers: Readonly<Record<string, string | undefined>>,
  dependencies: SessionDependencies
): Promise<SessionResult> {
  const denied = (status: number): SessionResult => ({
    status, headers: responseHeaders, body: UNAUTHENTICATED_SESSION
  });
  try {
    const identity = await dependencies.verifyIdentity(headers);
    if (!identity?.userId.trim() || !identity.email.trim()) return denied(401);
    const membership = await dependencies.findActiveMembership(identity.userId);
    if (!membership?.tenantId.trim() || !membership.tenantName.trim() ||
        !membership.displayName.trim() || membership.roles.length === 0 ||
        !membership.roles.every(role => roles.has(role))) return denied(403);
    return { status: 200, headers: responseHeaders, body: {
      authenticated: true, profile: {
        userId: identity.userId, email: identity.email,
        displayName: membership.displayName, tenantName: membership.tenantName,
        roles: [...membership.roles]
      }
    }};
  } catch {
    return denied(503);
  }
}
