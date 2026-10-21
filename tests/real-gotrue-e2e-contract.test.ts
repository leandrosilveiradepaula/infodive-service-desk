import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// These tests guard the disposable QA adapter's separation from production.
// The actual identity flow is tested by the browser in GitHub Actions, not
// by these static contracts.
const file = (path: string) => readFileSync(resolve(__dirname, "../../", path), "utf8");
const real = file("tests/e2e/qa-https-live-auth-server.ts");
const startup = file("tests/e2e/run_real_auth_qa.sh");
const parent = file("tests/e2e/run_browser_qa.sh");
const bootstrap = file("tests/e2e/bootstrap_real_auth_qa.py");
const browser = file("tests/e2e/browser-live-auth-flow.py");

test("real GoTrue QA is separate from the existing mocked Auth flow", () => {
  assert.match(real, /Real local Supabase Auth/);
  assert.match(real, /"\/auth\/v1\/token"|"\u002ftoken"/);
  assert.match(real, /http:\/\/127\.0\.0\.1:3321/);
  assert.match(real, /http:\/\/127\.0\.0\.1:3319\/tickets/);
  assert.doesNotMatch(real, /createHmac|const jwt=|mock-refresh-token/);
  assert.match(parent, /QA_TLS_KEY=.*run_real_auth_qa\.sh/s);
  assert.ok(parent.indexOf("BROWSER_QA_HTTPS_TICKET_CREATE_RELOAD_LOGOUT_PASS=1")
    < parent.indexOf("run_real_auth_qa.sh"));
});

test("all GoTrue credentials and DB endpoints are disposable and local", () => {
  for (const key of [
    "ISOLATED_PG_ONLY", "PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD",
    "SERVICE_DESK_QA_REAL_AUTH",
  ]) {
    assert.ok(startup.includes(key), "missing safety guard " + key);
    assert.ok(real.includes(key), "missing gateway safety guard " + key);
  }
  assert.match(startup, /GOTRUE_API_HOST=127\.0\.0\.1/);
  assert.match(startup, /GOTRUE_DB_DATABASE_URL="postgres:\/\/postgres:disposable-qa-only-password@127\.0\.0\.1:5432\/service_desk_auth_test/);
  assert.match(startup, /supabase\/gotrue@sha256:[0-9a-f]{64}/);
  assert.match(startup, /dropdb -h 127\.0\.0\.1/);
  assert.match(real, /source\.origin !== "https:\/\/qa-only\.invalid"/);
  assert.doesNotMatch(startup, /VERCEL_TOKEN|OPENAI_API_KEY|SERVICE_ROLE_KEY|SUPABASE_URL=/);
});

test("real password sessions are bound to two independent tenant memberships", () => {
  assert.match(bootstrap, /\/signup/);
  assert.match(bootstrap, /REAL_GOTRUE_PASSWORD_SIGNUP_AND_TENANT_FIXTURES_PASS=1/);
  assert.match(bootstrap, /insert into auth\.users/);
  assert.match(bootstrap, /insert into public\.memberships/);
  assert.match(bootstrap, /10000000-0000-4000-8000-000000000001/);
  assert.match(bootstrap, /10000000-0000-4000-8000-000000000002/);
  assert.doesNotMatch(bootstrap, /factory_|fjplmxfcshhbmzgvyqlm/);
});

test("browser tests password rejection, foreign tenant, real refresh and logout", () => {
  for (const signal of [
    'status==401', 'status":403', "/api/auth/refresh", "/api/session",
    "Chamados da sua empresa", "GOTRUE_REAL_PASSWORD_REFRESH_LOGOUT_PASS=1",
    "BROWSER_QA_REAL_GOTRUE_RLS_TICKET_PASS=1",
  ]) {
    assert.ok(browser.includes(signal), "missing live browser assertion: " + signal);
  }
  assert.match(startup, /grep -Fx 'GOTRUE_REAL_PASSWORD_REFRESH_LOGOUT_PASS=1'/);
  assert.match(startup, /grep -Fx 'BROWSER_QA_REAL_GOTRUE_RLS_TICKET_PASS=1'/);
});

test("no test marker can be written by merely starting GoTrue", () => {
  const assertion = browser.indexOf('assert result=={"tickets":401,"session":401}');
  const passed = browser.indexOf('print("GOTRUE_REAL_PASSWORD_REFRESH_LOGOUT_PASS=1")');
  assert.ok(assertion >= 0 && passed > assertion);
  assert.doesNotMatch(real, /BROWSER_QA_REAL_GOTRUE_RLS_TICKET_PASS=1/);
});
