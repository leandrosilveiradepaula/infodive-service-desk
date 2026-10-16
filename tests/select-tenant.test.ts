import assert from "node:assert/strict";
import test from "node:test";
import { selectTenant } from "../src/authentication/select-tenant";
import type { MembershipRepository, VerifiedIdentityProvider } from "../src/authentication/session-adapters";
const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const csrf = "a".repeat(64);
const identity: VerifiedIdentityProvider = { verifySession: async () => ({ userId, email: "user@example.test" }) };
const memberships: MembershipRepository = { findByUserId: async () => [{
  userId, tenantId, tenantName: "Company", displayName: "User",
  roleCode: "service_agent", membershipStatus: "active"
}] };
const options = { origin: "https://desk.example.test", signingKey: "k".repeat(48), identity, memberships };
const input = { method: "POST", tenantId, headers: {
  origin: "https://desk.example.test", cookie: "sd-csrf=" + csrf,
  "x-csrf-token": csrf
} };
test("explicit tenant selection issues a protected signed cookie", async () => {
  const result = await selectTenant(input, options);
  assert.equal(result.status, 200);
  assert.match(result.headers["Set-Cookie"] ?? "", /HttpOnly; Secure; SameSite=Lax/);
});
test("tenant selection denies missing origin, CSRF and foreign tenant", async () => {
  assert.equal((await selectTenant({ ...input, headers: { ...input.headers, origin: "https://evil.test" } }, options)).status, 403);
  assert.equal((await selectTenant({ ...input, headers: { ...input.headers, "x-csrf-token": "b".repeat(64) } }, options)).status, 403);
  assert.equal((await selectTenant({ ...input, tenantId: "33333333-3333-4333-8333-333333333333" }, options)).status, 403);
});
