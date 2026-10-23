import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createVercelApiHandler, resolveVercelApiConfig } from "../src/authentication/vercel-function";

const env = {
  VERCEL_ENV: "preview",
  VERCEL_URL: "service-desk-git-preview-123.vercel.app",
  SERVICE_DESK_SUPABASE_URL: "https://example.supabase.co",
  SERVICE_DESK_SUPABASE_ANON_KEY: "anon-public-test",
  SERVICE_DESK_SUPABASE_SECRET_KEY: "sb_secret_test_do_not_log",
  SERVICE_DESK_TENANT_SIGNING_KEY: "k".repeat(48)
};

async function withServer(
  handler: ReturnType<typeof createVercelApiHandler>,
  action: (base: string) => Promise<void>
) {
  const server = createServer(handler as RequestListener);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr !== "string");
    await action("http://127.0.0.1:" + addr.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("Preview uses exact trusted VERCEL_URL, never client-provided Host", () => {
  const config = resolveVercelApiConfig(env);
  assert.equal(config.publicOrigin, "https://" + env.VERCEL_URL);
  assert.equal(config.tenantSigningKey.length, 48);
  for (const hostname of ["attacker.example.com", "example.vercel.app.evil.com", "bad/name.vercel.app"]) {
    assert.throws(() => resolveVercelApiConfig({ ...env, VERCEL_URL: hostname }));
  }
  assert.throws(() => resolveVercelApiConfig({ ...env, VERCEL_ENV: "production" }));
  assert.equal(resolveVercelApiConfig({
    ...env, VERCEL_ENV: "production",
    SERVICE_DESK_PUBLIC_ORIGIN: "https://desk.example.test"
  }).publicOrigin, "https://desk.example.test");
});

test("Vercel CSRF endpoint reuses real server logic and security cookies", async () => {
  await withServer(createVercelApiHandler("/api/auth/csrf", env), async base => {
    const response = await fetch(base + "/api/auth/csrf", {
      headers: { Host: "evil.example.test" }
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { csrfToken: string };
    assert.match(body.csrfToken, /^[a-f0-9]{64}$/);
    assert.match(response.headers.get("set-cookie") ?? "", /^sd-csrf=/);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    const disallowed = await fetch(base + "/api/auth/csrf", { method: "POST" });
    assert.equal(disallowed.status, 405);
  });
});

test("Vercel adapter exposes no privileged credentials when not configured", async () => {
  await withServer(createVercelApiHandler("/api/auth/csrf", { VERCEL_ENV: "preview",
    VERCEL_URL: "service-desk-git-preview-123.vercel.app" }), async base => {
    const response = await fetch(base + "/api/auth/csrf");
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { ok: false, error: "backend_unavailable" });
    assert.doesNotMatch(body, /sb_secret|token|SERVICE_DESK/i);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });
});

test("Wrong path, malformed ticket id and cross-origin mutation fail closed", async () => {
  await withServer(createVercelApiHandler("/api/tickets/:id", env), async base => {
    const wrong = await fetch(base + "/api/tickets/wrong");
    assert.equal(wrong.status, 404);
    const valid = await fetch(base + "/api/tickets/33333333-3333-4333-8333-333333333333");
    assert.equal(valid.status, 401);
  });
  await withServer(createVercelApiHandler("/api/auth/login", env, async () => {
    throw Error("CSRF rejected request must never reach Supabase");
  }), async base => {
    const response = await fetch(base + "/api/auth/login", {
      method: "POST", headers: { Origin: "https://attacker.example.test" },
      body: JSON.stringify({ email: "a@example.test", password: "password" })
    });
    assert.equal(response.status, 403);
  });
});

test("Vercel routes and static output are explicit, without production hooks", () => {
  const root = join(__dirname, "..", "..");
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
    outputDirectory: string; buildCommand: string; rewrites: {source:string;destination:string}[]
  };
  assert.equal(config.outputDirectory, "dist-web");
  assert.equal(config.buildCommand, "npm run build:web");
  assert.deepEqual(config.rewrites, [{source:"/chamados",destination:"/index.html"}]);
  assert.ok(!Object.hasOwn(config, "crons"));
  assert.ok(!Object.hasOwn(config, "builds"));
});
