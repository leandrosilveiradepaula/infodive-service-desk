import assert from "node:assert/strict";
import test from "node:test";
import { loadServerEnvironment, toPublicRuntimeConfig } from "../src/config/server-env";
import { ValidationError } from "../src/shared/errors";

test("loads valid server configuration and only projects safe client configuration", () => {
  const environment = loadServerEnvironment({
    NODE_ENV: "test",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "server-secret"
  });

  assert.equal(environment.supabaseServiceRoleKey, "server-secret");
  assert.deepEqual(toPublicRuntimeConfig(environment), { nodeEnv: "test" });
});

test("rejects missing or invalid server configuration", () => {
  assert.throws(
    () => loadServerEnvironment({ NODE_ENV: "preview", SUPABASE_URL: "not-a-url" }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.deepEqual(error.details, {
        issues: [
          "NODE_ENV must be development, test, or production",
          "SUPABASE_SERVICE_ROLE_KEY is required",
          "SUPABASE_URL must be a valid URL"
        ]
      });
      return true;
    }
  );
});
