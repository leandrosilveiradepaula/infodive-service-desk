import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseIdentityProvider } from "../src/authentication/supabase-identity";
test("Supabase Auth verifies the bearer identity against the user endpoint", async () => {
  const provider = createSupabaseIdentityProvider(
    "https://example.supabase.co", "public-test-key",
    headers => headers.authorization?.replace(/^Bearer /, "") ?? null,
    async (url, init) => {
      assert.equal(url, "https://example.supabase.co/auth/v1/user");
      assert.equal(init.headers.apikey, "public-test-key");
      assert.equal(init.headers.Authorization, "Bearer opaque");
      assert.equal(init.cache, "no-store");
      return { ok: true, status: 200, json: async () => ({ id: "u1", email: "u@example.invalid" }) };
    }
  );
  assert.deepEqual(await provider.verifySession({ authorization: "Bearer opaque" }),
    { userId: "u1", email: "u@example.invalid" });
});
test("Supabase identity fails closed for missing, rejected and malformed sessions", async () => {
  const provider = createSupabaseIdentityProvider(
    "https://example.supabase.co", "public-test-key",
    headers => headers.authorization ?? null,
    async () => ({ ok: false, status: 401, json: async () => null })
  );
  assert.equal(await provider.verifySession({}), null);
  assert.equal(await provider.verifySession({ authorization: "invalid" }), null);
  const malformed = createSupabaseIdentityProvider(
    "https://example.supabase.co", "public-test-key",
    () => "opaque",
    async () => ({ ok: true, status: 200, json: async () => ({ id: "u1" }) })
  );
  assert.equal(await malformed.verifySession({}), null);
});
