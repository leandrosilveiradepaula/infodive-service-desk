import assert from "node:assert/strict";
import test from "node:test";
import { loadVerifiedSession } from "../src/authentication/load-session";
import { parseVerifiedSession, UNAUTHENTICATED_SESSION } from "../src/authentication/session-contract";

test("session is denied without verified server response", () => {
  for (const payload of [null, {}, { authenticated: true }, { authenticated: true, profile: { userId: "x" } }, { authenticated: false, profile: { userId: "x" } }]) {
    assert.deepEqual(parseVerifiedSession(payload), UNAUTHENTICATED_SESSION);
  }
});
test("verified response retains identity data but not authorization authority", () => {
  const profile = { userId: "u1", displayName: "Operator", email: "test@example.invalid", tenantName: "Tenant", roles: ["service_agent"] };
  assert.deepEqual(parseVerifiedSession({ authenticated: true, profile }), { authenticated: true, profile });
});
test("network failure, HTTP errors and malformed JSON deny the session", async () => {
  assert.deepEqual(await loadVerifiedSession(async () => { throw Error("network"); }), UNAUTHENTICATED_SESSION);
  assert.deepEqual(await loadVerifiedSession(async () => ({ ok: false, status: 401, json: async () => ({ authenticated: true }) })), UNAUTHENTICATED_SESSION);
  assert.deepEqual(await loadVerifiedSession(async () => ({ ok: true, status: 200, json: async () => { throw Error("invalid JSON"); } })), UNAUTHENTICATED_SESSION);
});
test("session request always uses same-origin credentials and disables caching", async () => {
  await loadVerifiedSession(async (url, init) => {
    assert.equal(url, "/api/session");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    return { ok: false, status: 401, json: async () => null };
  });
});
