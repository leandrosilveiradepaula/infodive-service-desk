import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseMembershipRepository } from "../src/authentication/supabase-memberships";

const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
test("membership repository rejects cross-tenant role assignment", async () => {
  const repository = createSupabaseMembershipRepository("https://example.supabase.co", "secret", async url => {
    if (String(url).includes("/users")) return new Response(JSON.stringify([
      { id: userId, tenant_id: tenantId, display_name: "Agent" }
    ]), { status: 200 });
    return new Response(JSON.stringify([{
      user_id: userId, tenant_id: tenantId, status: "active",
      roles: { code: "service_agent", tenant_id: "33333333-3333-4333-8333-333333333333" },
      tenants: { name: "Tenant" }
    }]), { status: 200 });
  });
  await assert.rejects(repository.findByUserId(userId), /Invalid membership relation/);
});
test("membership repository fails closed when database is unavailable", async () => {
  const repository = createSupabaseMembershipRepository("https://example.supabase.co", "secret",
    async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(repository.findByUserId(userId), /Supabase lookup failed/);
});
