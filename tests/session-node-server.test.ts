import assert from "node:assert/strict";
import test from "node:test";
import { createSessionHttpServer } from "../src/authentication/session-node-server";

test("HTTP server responds with verified session and rejects unsupported methods", async () => {
  const server = createSessionHttpServer({
    verifyIdentity: async () => ({ userId: "u1", email: "u1@example.invalid" }),
    findActiveMembership: async () => ({
      tenantId: "t1", tenantName: "Tenant", displayName: "Operator", roles: ["service_agent"]
    })
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = "http://127.0.0.1:" + address.port;
    const ok = await fetch(base + "/api/session");
    assert.equal(ok.status, 200);
    assert.equal((await ok.json() as { authenticated: boolean }).authenticated, true);
    assert.equal(ok.headers.get("cache-control"), "no-store, private");
    const denied = await fetch(base + "/api/session", { method: "POST" });
    assert.equal(denied.status, 405);
    const missing = await fetch(base + "/api/unknown");
    assert.equal(missing.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
