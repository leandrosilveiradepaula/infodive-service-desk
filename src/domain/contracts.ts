export interface ContractServiceAuthorization {
  readonly serviceId: string;
  readonly active: boolean;
}

export interface ServiceContract {
  readonly id: string;
  readonly tenantId: string;
  readonly clientCompanyId: string;
  readonly name: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly timezone: string;
  readonly includedMinutes: number | null;
  readonly authorizedServices: readonly ContractServiceAuthorization[];
}

/** Ensures a contract has a valid term and can only expose explicitly authorized services. */
export function assertValidContract(contract: ServiceContract): void {
  if (contract.tenantId.trim().length === 0 || contract.clientCompanyId.trim().length === 0) {
    throw new Error("A contract must belong to a tenant and client company.");
  }
  if (contract.name.trim().length < 2) {
    throw new Error("A contract name is required.");
  }
  if (Number.isNaN(contract.startsAt.getTime())) {
    throw new Error("A contract start date is required.");
  }
  if (contract.endsAt !== null && contract.endsAt <= contract.startsAt) {
    throw new Error("A contract end date must be after its start date.");
  }
  if (contract.includedMinutes !== null && (!Number.isInteger(contract.includedMinutes) || contract.includedMinutes < 0)) {
    throw new Error("Included contract minutes must be a non-negative integer.");
  }
  if (contract.timezone.trim().length === 0) {
    throw new Error("A contract timezone is required.");
  }

  const serviceIds = new Set<string>();
  for (const service of contract.authorizedServices) {
    if (service.serviceId.trim().length === 0 || serviceIds.has(service.serviceId)) {
      throw new Error("Authorized contract services must be unique and non-empty.");
    }
    serviceIds.add(service.serviceId);
  }
}

/** Returns whether the contract was effective and authorized the service at the supplied instant. */
export function isServiceAuthorizedByContract(
  contract: ServiceContract,
  serviceId: string,
  at: Date
): boolean {
  assertValidContract(contract);
  return (
    at >= contract.startsAt &&
    (contract.endsAt === null || at < contract.endsAt) &&
    contract.authorizedServices.some((service) => service.serviceId === serviceId && service.active)
  );
}
