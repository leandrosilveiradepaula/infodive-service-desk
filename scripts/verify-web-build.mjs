import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const output = "dist-web";
assert.ok(existsSync(join(output, "index.html")), "Vite HTML output missing");
const html = readFileSync(join(output, "index.html"), "utf8");
assert.match(html, /<script[^>]+src="[^"]+\.js"/, "No bundled client entrypoint");
const assets = readdirSync(join(output, "assets"));
assert.ok(assets.some((file) => file.endsWith(".js")), "No client JS output");
assert.ok(assets.some((file) => file.endsWith(".css")), "No CSS module output");
for (const path of assets.filter((file) => file.endsWith(".js"))) {
  const js = readFileSync(join(output, "assets", path), "utf8");
  assert.ok(!js.includes("SUPABASE_SERVICE_ROLE_KEY"), "Server-only variable bundled");
  assert.ok(!js.includes("sb_secret_"), "Supabase secret key marker bundled");
}
console.log("web_bundle_verified: true; auth_not_integrated: true");
