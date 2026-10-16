import type { Organization } from "../domain/organization";

export interface CreateOrganizationRecord {
  tenantId: string;
  name: string;
  slug: string;
}

/** Persistence port implemented by the server-side database adapter. */
export interface OrganizationRepository {
  create(input: CreateOrganizationRecord): Promise<Organization>;
  findByTenantAndSlug(tenantId: string, slug: string): Promise<Organization | null>;
}
