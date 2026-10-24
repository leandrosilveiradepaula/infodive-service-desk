import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const packageInfo = JSON.parse(readFileSync("../package.json", "utf8"));
const tsconfig = JSON.parse(readFileSync("../tsconfig.web.json", "utf8"));
const entry = readFileSync("../src/web/main.tsx", "utf8");

test("CI compiles TSX and exercises real build rather than reporting an empty queue", () => {
  assert.equal(tsconfig.compilerOptions.jsx, "react-jsx");
  assert.ok(tsconfig.include.includes("src/**/*.tsx"));
  assert.match(packageInfo.scripts.ci, /typecheck/);
  assert.match(packageInfo.scripts.ci, /test/);
  assert.match(packageInfo.scripts.ci, /build:web/);
  assert.match(packageInfo.scripts["build:web"], /verify-web-build/);
});

test("preview fetches server-verified session and denies access without it", () => {
  assert.match(entry, /loadVerifiedSession/);
  assert.match(entry, /useState<AuthenticatedProfile \| null>\(null\)/);
  assert.match(entry, /profile === null/);
  assert.doesNotMatch(entry, /profile=\{\{.*userId/);
  assert.doesNotMatch(entry, /service_role|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/i);
});

test("dependencies are pinned without ranges and client does not depend on server credentials", () => {
  for (const [name, version] of Object.entries({ ...packageInfo.dependencies, ...packageInfo.devDependencies })) {
    assert.match(String(version), /^\d+\.\d+\.\d+$/, `${name} should be pinned`);
  }
  assert.equal("SUPABASE_SERVICE_ROLE_KEY" in packageInfo, false);
});

test("unauthenticated entrypoint uses a dedicated responsive branded login and accessible labels", () => {
  const css = readFileSync("../src/styles/login.module.css", "utf8");
  assert.match(entry, /import loginStyles from "\.\.\/styles\/login\.module\.css"/);
  assert.match(entry, /data-testid="login-layout"/);
  assert.match(entry, /data-testid="login-card"/);
  assert.match(entry, /htmlFor="service-desk-email"/);
  assert.match(entry, /htmlFor="service-desk-password"/);
  assert.match(entry, /aria-labelledby="login-title"/);
  assert.match(css, /\.layout\s*\{/);
  assert.match(css, /\.brandPanel\s*\{/);
  assert.match(css, /\.formPanel\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(entry, /<main className="loginPage">/);
  assert.doesNotMatch(css, /@import\s|url\(https?:/);
});
