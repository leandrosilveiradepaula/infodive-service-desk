export interface AuthenticatedSession {
  readonly userId: string;
}

export interface DelegatedAccess {
  readonly grantId: string;
  readonly tenantId: string;
  readonly clientCompanyId: string;
  readonly justification: string;
}

export interface AuthorizationRepository {
  hasTenantPermission(input: {
    userId: string;
    tenantId: string;
    resource: string;
    action: string;
  }): Promise<boolean>;
  findDelegatedAccess(input: {
    userId: string;
    tenantId: string;
    clientCompanyId: string;
    resource: string;
    action: string;
  }): Promise<DelegatedAccess | null>;
  recordDelegatedAccess(input: {
    grantId: string;
    tenantId: string;
    clientCompanyId: string;
    actorUserId: string;
    resource: string;
    action: string;
    justification: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface ProtectedCommand {
  readonly session: AuthenticatedSession | null;
  readonly tenantId: string;
  readonly resource: string;
  readonly action: string;
  readonly clientCompanyId?: string;
  readonly auditMetadata?: Record<string, unknown>;
}

export class AuthorizationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Authorizes a server-side command. Delegated platform access is denied unless a
 * currently valid company-scoped grant exists, and every successful delegated
 * command is recorded before the caller continues.
 */
export async function authorizeCommand(
  repository: AuthorizationRepository,
  command: ProtectedCommand
): Promise<void> {
  const { session, tenantId, resource, action } = command;

  if (session === null) {
    throw new AuthorizationError("An authenticated session is required.");
  }
  if (tenantId.trim().length === 0 || resource.trim().length === 0 || action.trim().length === 0) {
    throw new AuthorizationError("Tenant, resource, and action scope are required.");
  }

  const hasDirectPermission = await repository.hasTenantPermission({
    userId: session.userId,
    tenantId,
    resource,
    action
  });

  if (hasDirectPermission) {
    return;
  }

  if (command.clientCompanyId === undefined || command.clientCompanyId.trim().length === 0) {
    throw new AuthorizationError("The requested tenant scope is not authorized.");
  }

  const delegatedAccess = await repository.findDelegatedAccess({
    userId: session.userId,
    tenantId,
    clientCompanyId: command.clientCompanyId,
    resource,
    action
  });

  if (delegatedAccess === null || delegatedAccess.justification.trim().length < 10) {
    throw new AuthorizationError("Delegated access is not authorized for this customer company.");
  }

  await repository.recordDelegatedAccess({
    grantId: delegatedAccess.grantId,
    tenantId,
    clientCompanyId: command.clientCompanyId,
    actorUserId: session.userId,
    resource,
    action,
    justification: delegatedAccess.justification,
    metadata: command.auditMetadata
  });
}
