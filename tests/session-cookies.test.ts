import assert from "node:assert/strict";
import test from "node:test";
import { signTenantSelection, verifyTenantSelection, extractAccessToken } from "../src/authentication/session-cookies";
const user = "11111111-1111-4111-8111-111111111111";
const tenant = "22222222-2222-4222-8222-222222222222";
const key = "secret".repeat(8);
test("tenant selection is bound to identity, expiry and signature", () => {
  const signed = signTenantSelection(user, tenant, Date.now() + 60000, key);
  const cookie = "sd-tenant-selection=" + signed;
  assert.equal(verifyTenantSelection(cookie, user, key), tenant);
  assert.equal(verifyTenantSelection(cookie, "other-user", key), null);
  assert.equal(verifyTenantSelection(cookie, user, "different".repeat(5)), null);
  assert.equal(verifyTenantSelection(cookie.replace(/.$/, "0"), user, key), null);
  assert.equal(verifyTenantSelection("sd-tenant-selection=invalid", user, key), null);
});
test("access token only comes from dedicated session cookie", () => {
  assert.equal(extractAccessToken({ cookie: "sd-access-token=opaque" }), "opaque");
  assert.equal(extractAccessToken({ authorization: "Bearer opaque" }), null);
  assert.equal(extractAccessToken({ cookie: "other=opaque" }), null);
});
