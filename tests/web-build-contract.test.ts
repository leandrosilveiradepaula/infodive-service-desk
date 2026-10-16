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

test("preview is fail-closed until the real session provider is implemented", () => {
  assert.match(entry, /AuthenticationProvider profile=\{null\}/);
  assert.doesNotMatch(entry, /service_role|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/i);
});

test("dependencies are pinned without ranges and client does not depend on server credentials", () => {
  for (const [name, version] of Object.entries({ ...packageInfo.dependencies, ...packageInfo.devDependencies })) {
    assert.match(String(version), /^\d+\.\d+\.\d+$/, `${name} should be pinned`);
  }
  assert.equal("SUPABASE_SERVICE_ROLE_KEY" in packageInfo, false);
});
