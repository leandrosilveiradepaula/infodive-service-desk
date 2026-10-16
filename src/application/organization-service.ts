import { validateOrganizationInput, type CreateOrganizationInput, type Organization } from "../domain/organization";
import { OrganizationRepository } from "../persistence/organization-repository";
import { DomainError } from "../shared/errors";

export class OrganizationService {
  public constructor(private readonly organizations: OrganizationRepository) {}

  public async create(input: CreateOrganizationInput): Promise<Organization> {
    const validInput = validateOrganizationInput(input);
    const existing = await this.organizations.findByTenantAndSlug(validInput.tenantId, validInput.slug);

    if (existing !== null) {
      throw new DomainError("ORGANIZATION_SLUG_CONFLICT", "An organization with this slug already exists.", {
        tenantId: validInput.tenantId,
        slug: validInput.slug
      });
    }

    return this.organizations.create(validInput);
  }
}
