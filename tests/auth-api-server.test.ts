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
    if (String(url).includes("/auth/v1/token"))
      return new Response(JSON.stringify({ access_token: "verified-token", refresh_token: "mock-refresh-only", expires_in: 3600 }), { status: 200 });
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
    const login = await fetch(base + "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json",
        Origin: "https://desk.example.test", Cookie: "sd-csrf=" + token,
        "x-csrf-token": token },
      body: JSON.stringify({ email: "agent@example.test", password: "example-password", tenantId })
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie") ?? "", /sd-access-token=/);
    const rotated = await fetch(base + "/api/auth/refresh", {
      method: "POST", headers: { Origin: "https://desk.example.test",
        Cookie: "sd-csrf=" + token, "x-csrf-token": token }
    });
    assert.equal(rotated.status, 401);
    assert.match(rotated.headers.get("set-cookie") ?? "", /sd-access-token=/);
    const rejectedRefresh = await fetch(base + "/api/auth/refresh", {
      method: "POST", headers: { Origin: "https://attacker.example.test" }
    });
    assert.equal(rejectedRefresh.status, 403);
    const invalidLogin = await fetch(base + "/api/auth/login", {
      method: "POST", headers: { Origin: "https://desk.example.test" },
      body: JSON.stringify({ email: "agent@example.test", password: "example-password", tenantId })
    });
    assert.equal(invalidLogin.status, 403);
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

test("HTTP login, refresh rotation, authenticated session and logout share one origin", async () => {
  const calls: string[] = [];
  const server = createAuthApiServer({
    supabaseUrl: "https://example.supabase.co", anonKey: "anon",
    secretKey: "sb_secret_test", tenantSigningKey: "k".repeat(48),
    publicOrigin: "https://desk.example.test"
  }, async (url, init) => {
    const path = String(url);
    calls.push(path);
    if (path.includes("grant_type=password")) {
      return new Response(JSON.stringify({ access_token: "access-before-rotation",
        refresh_token: "refresh-before-rotation", expires_in: 3600 }), { status: 200 });
    }
    if (path.includes("grant_type=refresh_token")) {
      assert.match(String(init?.body), /refresh-before-rotation/);
      return new Response(JSON.stringify({ access_token: "access-after-rotation",
        refresh_token: "refresh-after-rotation", expires_in: 1800 }), { status: 200 });
    }
    if (path.includes("/auth/v1/logout")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-after-rotation");
      return new Response(null, { status: 204 });
    }
    if (path.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: userId, email: "agent@example.test" }), { status: 200 });
    }
    if (path.includes("/rest/v1/users")) {
      return new Response(JSON.stringify([{ id: userId, tenant_id: tenantId, display_name: "Agent" }]), { status: 200 });
    }
    return new Response(JSON.stringify([{ user_id: userId, tenant_id: tenantId, status: "active",
      roles: { code: "service_agent", tenant_id: tenantId }, tenants: { name: "Company" } }]), { status: 200 });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = "http://127.0.0.1:" + address.port;
    const csrf = await fetch(base + "/api/auth/csrf");
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const security = { Origin: "https://desk.example.test", "x-csrf-token": csrfToken };
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { ...security, Cookie: "sd-csrf=" + csrfToken, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "agent@example.test", password: "example-password", tenantId })
    });
    assert.equal(login.status, 200);
    const loginCookies = login.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    assert.match(loginCookies, /sd-refresh-token=/);
    const refresh = await fetch(base + "/api/auth/refresh", {
      method: "POST", headers: { ...security, Cookie: "sd-csrf=" + csrfToken + "; " + loginCookies }
    });
    assert.equal(refresh.status, 200);
    const rotatedCookies = refresh.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    assert.match(rotatedCookies, /refresh-after-rotation/);
    const session = await fetch(base + "/api/session", { headers: { Cookie: rotatedCookies } });
    assert.equal(session.status, 200);
    assert.equal((await session.json() as { authenticated: boolean }).authenticated, true);
    const logout = await fetch(base + "/api/auth/logout", {
      method: "POST", headers: { ...security, Cookie: "sd-csrf=" + csrfToken + "; " + rotatedCookies }
    });
    assert.equal(logout.status, 200);
    assert.ok(logout.headers.getSetCookie().some(cookie => cookie.startsWith("sd-refresh-token=;")));
    assert.ok(calls.some(path => path.includes("/auth/v1/logout")));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("invalid signed tenant context cannot consume a one-time Supabase refresh token", async () => {
  const { signTenantSelection } = await import("../src/authentication/session-cookies");
  let requests = 0;
  const server = createAuthApiServer({
    supabaseUrl: "https://example.supabase.co", anonKey: "anon", secretKey: "sb_secret_test",
    tenantSigningKey: "k".repeat(48), publicOrigin: "https://desk.example.test"
  }, async () => { requests++; throw Error("provider must not be called"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = "http://127.0.0.1:" + address.port;
    const csrf = await fetch(base + "/api/auth/csrf");
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const valid = signTenantSelection(userId, tenantId, Date.now() + 60000, "k".repeat(48));
    const tampered = valid.slice(0, -1) + (valid.endsWith("0") ? "1" : "0");
    for (const selection of [tampered, "invalid", valid.replace(userId, "33333333-3333-4333-8333-333333333333")]) {
      const response = await fetch(base + "/api/auth/refresh", { method: "POST",
        headers: { Origin: "https://desk.example.test", "x-csrf-token": csrfToken,
          Cookie: "sd-csrf=" + csrfToken + "; sd-refresh-token=mock-refresh-only; sd-tenant-selection=" + selection } });
      assert.equal(response.status, 401);
    }
    assert.equal(requests, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("multi-company discovery revokes provisional session before returning authorized choices", async () => {
  let revoked = 0;
  const alternate = "33333333-3333-4333-8333-333333333333";
  const server = createAuthApiServer({
    supabaseUrl: "https://example.supabase.co", anonKey: "anon",
    secretKey: "sb_secret_test", tenantSigningKey: "k".repeat(48),
    publicOrigin: "https://desk.example.test"
  }, async (url, init) => {
    const path = String(url);
    if (path.includes("/auth/v1/logout")) {
      revoked++;
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer verified-access-token");
      return new Response(null, { status: 204 });
    }
    if (path.includes("/auth/v1/token")) return new Response(JSON.stringify({
      access_token: "verified-access-token", refresh_token: "verified-refresh-token", expires_in: 1800
    }), { status: 200 });
    if (path.includes("/auth/v1/user")) return new Response(JSON.stringify({
      id: userId, email: "agent@example.test"
    }), { status: 200 });
    if (path.includes("/rest/v1/users")) return new Response(JSON.stringify([
      { id: userId, tenant_id: tenantId, display_name: "Agent" }
    ]), { status: 200 });
    return new Response(JSON.stringify([tenantId, alternate].map((id, index) => ({
      user_id: userId, tenant_id: id, status: "active",
      roles: { code: "requester", tenant_id: id }, tenants: { name: "Company " + index }
    }))), { status: 200 });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = "http://127.0.0.1:" + address.port;
    const csrf = await fetch(base + "/api/auth/csrf");
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { Origin: "https://desk.example.test", "x-csrf-token": csrfToken,
        Cookie: "sd-csrf=" + csrfToken, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "agent@example.test", password: "password", tenantId: "" })
    });
    assert.equal(response.status, 409);
    const payload = await response.json() as { code: string; tenants: unknown[] };
    assert.equal(payload.code, "tenant_selection_required");
    assert.equal(payload.tenants.length, 2);
    assert.equal(revoked, 1);
    assert.equal(response.headers.get("set-cookie"), null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("ticket HTTP workflow creates and lists real-shaped tickets with verified user JWT and tenant", async () => {
  const { signTenantSelection } = await import("../src/authentication/session-cookies");
  const selected = signTenantSelection(userId, tenantId, Date.now() + 300000, "k".repeat(48));
  const ticketId = "33333333-3333-4333-8333-333333333333";
  const record = { id: ticketId, tenant_id: tenantId, protocol: "T-000007",
    subject: "Servidor indisponível", description: "Erro ao conectar", priority: "high",
    status: "new", created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z" };
  let inserts = 0;
  const server = createAuthApiServer({
    supabaseUrl: "https://example.supabase.co", anonKey: "publishable-test",
    secretKey: "sb_secret_test", tenantSigningKey: "k".repeat(48),
    publicOrigin: "https://desk.example.test"
  }, async (url, init) => {
    const target = String(url);
    if (target.includes("/auth/v1/user")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-for-qa");
      return new Response(JSON.stringify({ id: userId, email: "agent@example.test" }), { status: 200 });
    }
    if (target.includes("/rest/v1/users"))
      return new Response(JSON.stringify([{ id: userId, tenant_id: tenantId, display_name: "Agent" }]), { status: 200 });
    if (target.includes("/rest/v1/memberships")) return new Response(JSON.stringify([{
      user_id: userId, tenant_id: tenantId, status: "active",
      roles: { code: "requester", tenant_id: tenantId }, tenants: { name: "Company" }
    }]), { status: 200 });
    if (target.includes("/rest/v1/tickets")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-for-qa");
      assert.equal(new Headers(init?.headers).get("apikey"), "publishable-test");
      assert.equal(new URL(target).searchParams.get("tenant_id"), "eq." + tenantId);
      if (init?.method === "POST") {
        inserts++;
        const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(payload).sort(), ["tenant_id", "requester_user_id", "subject", "description", "priority"].sort());
        assert.equal(payload.requester_user_id, userId);
        return new Response(JSON.stringify([record]), { status: 201 });
      }
      return new Response(JSON.stringify([record]), { status: 200 });
    }
    throw Error("Unexpected provider request: " + target);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    const base = "http://127.0.0.1:" + addr.port;
    const csrf = await fetch(base + "/api/auth/csrf");
    const { csrfToken } = await csrf.json() as {csrfToken: string};
    const cookie = "sd-csrf=" + csrfToken + "; sd-access-token=access-for-qa; sd-tenant-selection=" + selected;
    const headers = { Origin: "https://desk.example.test", Cookie: cookie, "x-csrf-token": csrfToken };
    const create = await fetch(base + "/api/tickets", { method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Servidor indisponível", description: "Erro ao conectar", priority: "high" }) });
    assert.equal(create.status, 201);
    assert.equal((await create.json() as {ticket: {protocol: string}}).ticket.protocol, "T-000007");
    assert.equal(inserts, 1);
    const list = await fetch(base + "/api/tickets", { headers: { Cookie: cookie } });
    assert.equal(list.status, 200);
    assert.equal((await list.json() as {items: unknown[]}).items.length, 1);
    const detail = await fetch(base + "/api/tickets/" + ticketId, { headers: { Cookie: cookie } });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json() as {ticket: {id: string}}).ticket.id, ticketId);
    const rejected = await fetch(base + "/api/tickets", {
      method: "POST", headers: { Cookie: cookie, Origin: "https://malicious.test" },
      body: JSON.stringify({subject:"Ataque"}) });
    assert.equal(rejected.status, 403);
    assert.equal(inserts, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
