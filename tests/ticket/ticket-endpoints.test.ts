import assert from "node:assert/strict";
import test from "node:test";
import { executeTicketRequest } from "../src/tickets/ticket-endpoints";

const tenant = "22222222-2222-4222-8222-222222222222";
const user = "11111111-1111-4111-8111-111111111111";
const ticketId = "33333333-3333-4333-8333-333333333333";
const config = { supabaseUrl: "https://example.supabase.co", publishableKey: "publishable-test",
  accessToken: "user-jwt-token", tenantId: tenant, userId: user };
const record = { id: ticketId, tenant_id: tenant, requester_user_id: user,
  protocol: "T-000001", subject: "Servidor sem acesso", description: "Falha na conexão",
  priority: "normal", status: "new", created_at: "2026-10-16T00:00:00Z",
  updated_at: "2026-10-16T00:00:00Z" };

test("ticket create delegates RLS to user JWT and never sends service credential", async () => {
  const response = await executeTicketRequest({ ...config, pathname: "/api/tickets",
    method: "POST", body: JSON.stringify({ subject: "Servidor sem acesso", description: "Falha na conexão" }),
    request: async (url, options) => {
      assert.equal(options?.method, "POST");
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("Authorization"), "Bearer user-jwt-token");
      assert.equal(headers.get("apikey"), "publishable-test");
      assert.equal(headers.get("Prefer"), "return=representation");
      const sent = JSON.parse(String(options?.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(sent).sort(), ["description", "priority", "requester_user_id", "subject", "tenant_id"].sort());
      assert.equal(sent.tenant_id, tenant);
      assert.equal(sent.requester_user_id, user);
      assert.equal(sent.subject, "Servidor sem acesso");
      assert.equal(new URL(String(url)).searchParams.get("tenant_id"), "eq." + tenant);
      return new Response(JSON.stringify([record]), { status: 201 });
    } });
  assert.equal(response.status, 201);
  assert.equal((response.body as {ticket: {protocol: string}}).ticket.protocol, "T-000001");
});
test("ticket list and detail filter by validated tenant, not browser tenant input", async () => {
  const paths: string[] = [];
  for (const path of ["/api/tickets", "/api/tickets/" + ticketId]) {
    const result = await executeTicketRequest({ ...config, pathname: path, method: "GET",
      body: "", request: async url => {
        paths.push(String(url));
        return new Response(JSON.stringify([record]), { status: 200 });
      } });
    assert.equal(result.status, 200);
  }
  assert.ok(paths.every(path => new URL(path).searchParams.get("tenant_id") === "eq." + tenant));
  assert.equal(new URL(paths[1]!).searchParams.get("id"), "eq." + ticketId);
});
test("ticket endpoints reject invalid records, inputs and cross-tenant responses", async () => {
  let called = 0;
  const request = async () => { called++; return new Response(JSON.stringify([record]), { status: 200 }); };
  for (const input of [
    { method: "POST", pathname: "/api/tickets", body: JSON.stringify({subject:"x"}) },
    { method: "POST", pathname: "/api/tickets", body: JSON.stringify({subject:"abc", tenant_id: "foreign"}) , invalid: false },
    { method: "GET", pathname: "/api/tickets/not-a-uuid", body: "" }
  ]) {
    const result = await executeTicketRequest({...config, ...input, request});
    if (input.pathname.includes("not-a-uuid") || input.body.includes('"x"')) assert.equal(result.status, 400);
  }
  assert.equal(called, 1);
  const bad = await executeTicketRequest({...config, method:"GET", pathname:"/api/tickets", body:"",
    request: async () => new Response(JSON.stringify([{...record, tenant_id: user}]), {status:200})});
  assert.equal(bad.status, 503);
});
test("RLS denies forbidden ticket insert and no data is returned", async () => {
  const result = await executeTicketRequest({...config,method:"POST",pathname:"/api/tickets",
    body:JSON.stringify({subject:"Sem autorização"}),request:async()=>new Response(JSON.stringify({code:"42501"}),{status:403})});
  assert.deepEqual(result,{status:403,body:{error:"ticket_permission_denied"}});
});
