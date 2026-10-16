export interface ExternalIdentifier {
  readonly tenantId: string;
  readonly integration: string;
  readonly entityType: string;
  readonly externalId: string;
  readonly internalEntityId: string;
  readonly createdAt: Date;
}

/**
 * Validates a mapping owned by an integration boundary. The mapping stores the
 * internal entity id as an opaque value, so integration consumers do not need
 * access to (or knowledge of) internal entity tables.
 */
export function assertValidExternalIdentifier(identifier: ExternalIdentifier): void {
  const values = [
    identifier.tenantId,
    identifier.integration,
    identifier.entityType,
    identifier.externalId,
    identifier.internalEntityId
  ];

  if (values.some((value) => value.trim().length === 0) || Number.isNaN(identifier.createdAt.getTime())) {
    throw new Error("External identifiers require tenant, integration, entity type, external id, internal id, and creation time.");
  }
}

/** Stable uniqueness key for an external identifier within an integration tenant. */
export function externalIdentifierKey(identifier: Pick<ExternalIdentifier, "tenantId" | "integration" | "entityType" | "externalId">): string {
  assertNonEmptyParts([identifier.tenantId, identifier.integration, identifier.entityType, identifier.externalId]);
  return `${identifier.tenantId}:${identifier.integration}:${identifier.entityType}:${identifier.externalId}`;
}

function assertNonEmptyParts(parts: readonly string[]): void {
  if (parts.some((part) => part.trim().length === 0)) {
    throw new Error("Integration identifier key parts cannot be empty.");
  }
}
