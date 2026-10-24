import assert from "node:assert/strict";
import test from "node:test";
import { createRequestSessionDependencies, type MembershipRecord } from "../src/authentication/session-adapters";
import { resolveServerSession } from "../src/authentication/server-session";
const rows: MembershipRecord[] = [
  { userId: "u1", tenantId: "t1", tenantName: "Tenant One", displayName: "Operator", roleCode: "service_agent", membershipStatus: "active" },
  { userId: "u1", tenantId: "t1", tenantName: "Tenant One", displayName: "Operator", roleCode: "requester", membershipStatus: "active" },
  { userId: "u1", tenantId: "t2", tenantName: "Tenant Two", displayName: "Operator", roleCode: "tenant_administrator", membershipStatus: "active" },
  { userId: "u2", tenantId: "t1", tenantName: "Tenant One", displayName: "Other", roleCode: "tenant_administrator", membershipStatus: "active" }
];
function dependencies(tenantId: string | null, memberships: readonly MembershipRecord[] = rows) {
  return createRequestSessionDependencies({ cookie: "opaque" },
    { verifySession: async () => ({ userId: "u1", email: "u1@example.invalid" }) },
    { findByUserId: async () => memberships },
    { selectedTenantId: async () => tenantId });
}
test("verified tenant selection scopes session roles and excludes other users", async () => {
  const result = await resolveServerSession({}, dependencies("t1"));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.profile?.roles, ["service_agent", "requester"]);
  assert.equal(result.body.profile?.tenantName, "Tenant One");
});
test("missing or unauthorized tenant selection never chooses first tenant", async () => {
  for (const tenantId of [null, "", "t3"]) {
    const result = await resolveServerSession({}, dependencies(tenantId));
    assert.equal(result.status, 403);
    assert.equal(result.body.authenticated, false);
  }
});
test("suspended memberships are denied", async () => {
  const suspended = rows.map(row => ({ ...row, membershipStatus: "suspended" as const }));
  const result = await resolveServerSession({}, dependencies("t1", suspended));
  assert.equal(result.status, 403);
});
test("conflicting tenant display data fails closed", async () => {
  const inconsistent = [...rows, { ...rows[0], tenantName: "Wrong tenant" }];
  const result = await resolveServerSession({}, dependencies("t1", inconsistent));
  assert.equal(result.status, 403);
});
