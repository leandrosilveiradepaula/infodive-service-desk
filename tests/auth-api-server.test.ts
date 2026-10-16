import assert from "node:assert/strict";
import test from "node:test";
import { createAuthApiServer } from "../src/authentication/auth-api-server";
const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
test("integrated HTTP auth API boots CSRF and validates tenant selection", async () => {
  const server = createAuthApiServer({
    supabaseUrl: "https://example.supabase.co", anonKey: "anon",
    secretKey: "sb_secret_test", tenantSigningKey: "k".repeat(48),
    publicOrigin: "https://desk.example.test"
  }, async (url) => {
    if (String(url).includes("/auth/v1/user"))
      return new Response(JSON.stringify({ id: userId, email: "user@example.test" }), { status: 200 });
    if (String(url).includes("/rest/v1/users"))
      return new Response(JSON.stringify([{ id: userId, tenant_id: tenantId, display_name: "Agent" }]), { status: 200 });
    return new Response(JSON.stringify([{
      user_id: userId, tenant_id: tenantId, status: "active",
      roles: { code: "service_agent", tenant_id: tenantId }, tenants: { name: "Company" }
    }]), { status: 200 });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = "http://127.0.0.1:" + address.port;
    const csrf = await fetch(base + "/api/auth/csrf");
    assert.equal(csrf.status, 200);
    const payload = await csrf.json() as { csrfToken: string };
    const token = payload.csrfToken;
    const result = await fetch(base + "/api/auth/select-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://desk.example.test",
        Cookie: "sd-csrf=" + token + "; sd-access-token=opaque", "x-csrf-token": token },
      body: JSON.stringify({ tenantId })
    });
    assert.equal(result.status, 200);
    assert.match(result.headers.get("set-cookie") ?? "", /sd-tenant-selection=/);
    const denied = await fetch(base + "/api/auth/select-tenant", {
      method: "POST", headers: { Origin: "https://attacker.example.test" },
      body: JSON.stringify({ tenantId })
    });
    assert.equal(denied.status, 403);
    const logout = await fetch(base + "/api/auth/logout", {
      method: "POST", headers: { Origin: "https://desk.example.test", Cookie: "sd-csrf=" + token, "x-csrf-token": token }
    });
    assert.equal(logout.status, 200);
    const rejectedLogout = await fetch(base + "/api/auth/logout", { method: "POST", headers: { Origin: "https://desk.example.test" } });
    assert.equal(rejectedLogout.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
