import { ValidationError } from "../shared/errors";

export interface CreateOrganizationInput {
  tenantId: string;
  name: string;
  slug: string;
}

export interface Organization {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  createdAt: Date;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateOrganizationInput(input: CreateOrganizationInput): CreateOrganizationInput {
  const tenantId = input.tenantId.trim();
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const fields: Record<string, string> = {};

  if (tenantId.length === 0) {
    fields.tenantId = "Tenant is required.";
  }
  if (name.length < 2 || name.length > 120) {
    fields.name = "Name must contain between 2 and 120 characters.";
  }
  if (!slugPattern.test(slug) || slug.length > 80) {
    fields.slug = "Slug must use lowercase letters, numbers, and single hyphens, up to 80 characters.";
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Invalid organization data.", { fields });
  }

  return { tenantId, name, slug };
}
