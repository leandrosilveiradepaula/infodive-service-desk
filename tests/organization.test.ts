import assert from "node:assert/strict";
import test from "node:test";
import { validateOrganizationInput } from "../src/domain/organization";
import { ValidationError } from "../src/shared/errors";

test("normalizes valid organization input", () => {
  assert.deepEqual(
    validateOrganizationInput({
      tenantId: " tenant-1 ",
      name: " Operations ",
      slug: "Service-Desk"
    }),
    { tenantId: "tenant-1", name: "Operations", slug: "service-desk" }
  );
});

test("returns consistent validation details for invalid organization input", () => {
  assert.throws(
    () => validateOrganizationInput({ tenantId: " ", name: "A", slug: "not valid" }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.deepEqual(error.details, {
        fields: {
          tenantId: "Tenant is required.",
          name: "Name must contain between 2 and 120 characters.",
          slug: "Slug must use lowercase letters, numbers, and single hyphens, up to 80 characters."
        }
      });
      return true;
    }
  );
});
