import assert from "node:assert/strict";
import test from "node:test";
import { exchangeCredentials } from "../src/authentication/credential-exchange";
import type { MembershipRepository } from "../src/authentication/session-adapters";
const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const memberships: MembershipRepository = { findByUserId: async () => [{
  userId, tenantId, tenantName: "Company", displayName: "Agent",
  roleCode: "service_agent", membershipStatus: "active"
}] };
const config = { supabaseUrl: "https://example.supabase.co", anonKey: "anon", memberships };
const input = { email: "agent@example.test", password: "example-password", tenantId };
test("credential exchange verifies token against identity and membership", async () => {
  const result = await exchangeCredentials(config, input, async url => {
    if (String(url).includes("/auth/v1/token")) return new Response(JSON.stringify({
      access_token: "verified-token", expires_in: 7200
    }), { status: 200 });
    return new Response(JSON.stringify({ id: userId, email: input.email }), { status: 200 });
  });
  assert.equal(result.status, 200);
  assert.equal(result.token, "verified-token");
  assert.equal(result.expiresIn, 3600);
});
test("credential exchange rejects invalid credentials and foreign tenant", async () => {
  const bad = await exchangeCredentials(config, input, async () => new Response("{}", { status: 401 }));
  assert.equal(bad.status, 401);
  const foreign = await exchangeCredentials(config, { ...input,
    tenantId: "33333333-3333-4333-8333-333333333333"
  }, async url => new Response(JSON.stringify(String(url).includes("/auth/v1/token")
    ? { access_token: "verified-token", expires_in: 3600 }
    : { id: userId, email: input.email }), { status: 200 }));
  assert.equal(foreign.status, 403);
});

test("login refuses unrecognized roles and incomplete membership even with valid Supabase password", async () => {
  const foreignRoles: MembershipRepository = {
    findByUserId: async () => [{ userId, tenantId, tenantName: "Company", displayName: "Agent",
      roleCode: "unexpected_superadmin", membershipStatus: "active" }]
  };
  const incompleteProfile: MembershipRepository = {
    findByUserId: async () => [{ userId, tenantId, tenantName: "Company", displayName: " ",
      roleCode: "service_agent", membershipStatus: "active" }]
  };
  const mock = async (url: URL | RequestInfo) => new Response(JSON.stringify(String(url).includes("/auth/v1/token")
    ? { access_token: "verified-token", expires_in: 3600 }
    : { id: userId, email: input.email }), { status: 200 });
  assert.equal((await exchangeCredentials({ ...config, memberships: foreignRoles }, input, mock)).status, 403);
  assert.equal((await exchangeCredentials({ ...config, memberships: incompleteProfile }, input, mock)).status, 403);
});
