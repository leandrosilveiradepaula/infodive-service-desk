import assert from "node:assert/strict";
import test from "node:test";
import { clearAuthCookies, hasCsrfCookie, issueCsrf } from "../src/authentication/csrf-cookie";
test("CSRF bootstrap issues fresh random tokens and secure cookie attributes", () => {
  const first = issueCsrf("GET");
  const second = issueCsrf("GET");
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.body.csrfToken, second.body.csrfToken);
  assert.match(first.headers["Set-Cookie"] ?? "", /Secure; SameSite=Lax/);
  assert.equal(hasCsrfCookie("sd-csrf=" + first.body.csrfToken), true);
  assert.equal(issueCsrf("POST").status, 405);
});
test("logout cookie clearing covers access, tenant selection and CSRF", () => {
  const cookies = clearAuthCookies();
  assert.equal(cookies.length, 3);
  for (const cookie of cookies) assert.match(cookie, /Max-Age=0/);
  assert.match(cookies[0] ?? "", /HttpOnly; Secure; SameSite=Lax/);
});
