import assert from "node:assert/strict";
import test from "node:test";
import { revokeCurrentSession } from "../src/authentication/revoke-session";
test("logout revokes only the current Supabase session with server-side bearer", async () => {
  let called = false;
  const result = await revokeCurrentSession("https://example.supabase.co", "public-key",
    "sd-access-token=opaque-session-access", async (url, init) => {
      called = true;
      assert.match(String(url), /\/auth\/v1\/logout\?scope=local$/);
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer opaque-session-access");
      return new Response(null, { status: 204 });
    });
  assert.equal(called, true);
  assert.equal(result, "revoked");
});
test("logout without cookie makes no provider request", async () => {
  assert.equal(await revokeCurrentSession("https://example.supabase.co", "public-key", undefined,
    async () => { throw Error("provider should not be contacted"); }), "anonymous");
});
test("logout provider errors are explicit instead of claiming remote revocation", async () => {
  assert.equal(await revokeCurrentSession("https://example.supabase.co", "public-key",
    "sd-access-token=opaque-session-access", async () => new Response(null, { status: 503 })), "unavailable");
});
