import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredSessionServer } from "../src/authentication/configured-session-server";
import { signTenantSelection } from "../src/authentication/session-cookies";

const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const key = "a".repeat(48);
test("full HTTP session verifies Supabase identity, active membership and signed tenant", async () => {
  const server = createConfiguredSessionServer({
    supabaseUrl: "https://example.supabase.co", anonKey: "anon", secretKey: "secret",
    tenantSigningKey: key
  }, async (url) => {
    if (String(url).includes("/auth/v1/user")) return new Response(JSON.stringify({ id: userId, email: "a@example.invalid" }), { status: 200 });
    if (String(url).includes("/rest/v1/users")) return new Response(JSON.stringify([{ id: userId, tenant_id: tenantId, display_name: "Agent" }]), { status: 200 });
    return new Response(JSON.stringify([{
      user_id: userId, tenant_id: tenantId, status: "active",
      roles: { code: "service_agent", tenant_id: tenantId }, tenants: { name: "Infodive" },
      users: { display_name: "Agent" }
    }]), { status: 200 });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = "http://127.0.0.1:" + address.port + "/api/session";
    const selection = signTenantSelection(userId, tenantId, Date.now() + 60000, key);
    const valid = await fetch(url, { headers: { cookie: "sd-access-token=opaque; sd-tenant-selection=" + selection } });
    assert.equal(valid.status, 200);
    const body = await valid.json() as { authenticated: boolean; profile: { tenantName: string } };
    assert.equal(body.authenticated, true);
    assert.equal(body.profile.tenantName, "Infodive");
    const denied = await fetch(url, { headers: { cookie: "sd-access-token=opaque; sd-tenant-selection=" + selection.slice(0, -1) + "0" } });
    assert.equal(denied.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
