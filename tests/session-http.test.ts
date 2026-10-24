import assert from "node:assert/strict";
import test from "node:test";
import { handleSessionHttpRequest } from "../src/authentication/session-http";
import type { SessionDependencies } from "../src/authentication/server-session";

const dependencies: SessionDependencies = {
  verifyIdentity: async () => ({ userId: "u1", email: "u1@example.invalid" }),
  findActiveMembership: async () => ({
    tenantId: "t1", tenantName: "Tenant", displayName: "User", roles: ["service_agent"]
  })
};
test("only the exact same-origin session path is handled", async () => {
  assert.equal(await handleSessionHttpRequest({
    method: "GET", url: "/api/tickets", headers: {}
  }, dependencies), null);
  assert.equal(await handleSessionHttpRequest({
    method: "GET", url: "/api/session-extra", headers: {}
  }, dependencies), null);
  const result = await handleSessionHttpRequest({
    method: "GET", url: "/api/session?refresh=1", headers: {}
  }, dependencies);
  assert.equal(result?.status, 200);
});
test("unsupported methods are denied without verifying identity", async () => {
  const result = await handleSessionHttpRequest({
    method: "POST", url: "/api/session", headers: {}
  }, {
    verifyIdentity: async () => { throw Error("identity must not be queried"); },
    findActiveMembership: async () => { throw Error("membership must not be queried"); }
  });
  assert.equal(result?.status, 405);
  assert.equal(result?.headers.Allow, "GET");
  assert.equal(result?.body.authenticated, false);
});
