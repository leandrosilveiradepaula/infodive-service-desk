import assert from "node:assert/strict";
import test from "node:test";
import { rotateSession } from "../src/authentication/refresh-session";
import type { MembershipRepository } from "../src/authentication/session-adapters";
const id = "11111111-1111-4111-8111-111111111111";
const tenant = "22222222-2222-4222-8222-222222222222";
const config = { supabaseUrl: "https://example.supabase.co", anonKey: "public-key",
  memberships: { findByUserId: async () => [{ userId: id, tenantId: tenant,
    tenantName: "Company", displayName: "Agent", roleCode: "service_agent" as const,
    membershipStatus: "active" as const }] } satisfies MembershipRepository };
test("refresh rotates credentials only after verifying identity and current membership", async () => {
  let requestCount = 0;
  const result = await rotateSession(config, "old-refresh-token", tenant, async (url, init) => {
    requestCount++;
    if (String(url).includes("grant_type=refresh_token")) {
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /old-refresh-token/);
      return new Response(JSON.stringify({ access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 1200 }), { status: 200 });
    }
    return new Response(JSON.stringify({ id, email: "agent@example.test" }), { status: 200 });
  });
  assert.equal(result.status, 200);
  assert.equal(result.refreshToken, "new-refresh-token");
  assert.equal(result.expiresIn, 1200);
  assert.equal(requestCount, 2);
});
test("refresh denies revoked membership and never returns rotated bearer credentials", async () => {
  const bad = { ...config, memberships: { findByUserId: async () => [] } };
  const result = await rotateSession(bad, "old-refresh-token", tenant, async url =>
    new Response(JSON.stringify(String(url).includes("grant_type=refresh_token")
      ? { access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 1200 }
      : { id, email: "agent@example.test" }), { status: 200 }));
  assert.equal(result.status, 403);
  assert.equal(result.token, undefined);
});
test("refresh refuses invalid provider response and expired credentials", async () => {
  assert.equal((await rotateSession(config, "short", tenant, async () => { throw Error("unexpected"); })).status, 401);
  assert.equal((await rotateSession(config, "old-refresh-token", tenant, async () =>
    new Response("{}", { status: 401 }))).status, 401);
  assert.equal((await rotateSession(config, "old-refresh-token", tenant, async () =>
    new Response(JSON.stringify({ access_token: "new-access-token", expires_in: 1200 }), { status: 200 }))).status, 503);
});

test("refresh with suspended membership revokes newly issued provider credentials", async () => {
  let revoked = 0;
  const bad = { ...config, memberships: { findByUserId: async () => [] } };
  const result = await rotateSession(bad, "old-refresh-token", tenant, async url => {
    if (String(url).includes("grant_type=refresh_token")) return new Response(JSON.stringify({
      access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 1200
    }), { status: 200 });
    if (String(url).includes("/auth/v1/logout")) { revoked++; return new Response(null, { status: 204 }); }
    return new Response(JSON.stringify({ id, email: "agent@example.test" }), { status: 200 });
  });
  assert.equal(result.status, 403);
  assert.equal(revoked, 1);
  assert.equal(result.token, undefined);
});
