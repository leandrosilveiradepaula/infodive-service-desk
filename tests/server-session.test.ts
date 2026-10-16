import assert from "node:assert/strict";
import test from "node:test";
import { resolveServerSession, type SessionDependencies } from "../src/authentication/server-session";

const valid: SessionDependencies = {
  verifyIdentity: async () => ({ userId: "user-1", email: "user@example.invalid" }),
  findActiveMembership: async () => ({
    tenantId: "tenant-1", tenantName: "Tenant", displayName: "Operator",
    roles: ["service_agent"]
  })
};
test("verified identity and active tenant membership return public session", async () => {
  const result = await resolveServerSession({ cookie: "opaque" }, valid);
  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "no-store, private");
  assert.deepEqual(result.body, { authenticated: true, profile: {
    userId: "user-1", email: "user@example.invalid",
    displayName: "Operator", tenantName: "Tenant", roles: ["service_agent"]
  }});
});
test("anonymous identities fail closed before membership lookup", async () => {
  const result = await resolveServerSession({}, {
    verifyIdentity: async () => null,
    findActiveMembership: async () => { throw Error("unexpected membership query"); }
  });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { authenticated: false, profile: null });
});
test("inactive membership, missing scope and unrecognized roles fail closed", async () => {
  const memberships = [
    null,
    { tenantId: "", tenantName: "Tenant", displayName: "Operator", roles: ["service_agent"] },
    { tenantId: "tenant-1", tenantName: "Tenant", displayName: "Operator", roles: ["root"] },
    { tenantId: "tenant-1", tenantName: "Tenant", displayName: "Operator", roles: [] }
  ];
  for (const membership of memberships) {
    const result = await resolveServerSession({}, {
      ...valid, findActiveMembership: async () => membership
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.authenticated, false);
  }
});
test("provider and membership failures do not disclose internal errors", async () => {
  for (const dependencies of [
    { ...valid, verifyIdentity: async () => { throw Error("secret auth detail"); } },
    { ...valid, findActiveMembership: async () => { throw Error("secret database detail"); } }
  ]) {
    const result = await resolveServerSession({}, dependencies);
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { authenticated: false, profile: null });
    assert.doesNotMatch(JSON.stringify(result.body), /secret/);
  }
});
