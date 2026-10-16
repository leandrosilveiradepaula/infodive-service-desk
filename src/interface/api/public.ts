export type PublicApiProblemCode = "unauthorized" | "forbidden" | "validation_failed" | "idempotency_conflict" | "internal_error";

export interface PublicApiProblem {
  readonly type: `https://api.infodive.example/problems/${PublicApiProblemCode}`;
  readonly title: string;
  readonly status: number;
  readonly code: PublicApiProblemCode;
  readonly fields?: Readonly<Record<string, string>>;
}

export interface PublicApiResponse<T> {
  readonly status: number;
  readonly body: T;
}

export interface ServicePrincipal {
  readonly kind: "service";
  readonly clientId: string;
  readonly tenantId: string;
  readonly scopes: readonly string[];
}

export interface EndUserPrincipal {
  readonly kind: "user";
  readonly userId: string;
  readonly tenantId: string;
}

/** Authentication entry points are intentionally separate for machine clients and end users. */
export interface PublicAuthenticator {
  authenticateService(authorization: string | undefined): Promise<ServicePrincipal | null>;
  authenticateUser(authorization: string | undefined): Promise<EndUserPrincipal | null>;
}

export interface CreatePublicTicketInput {
  readonly title: string;
  readonly description?: string;
}

export interface CreatedPublicTicket {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
}

export interface PublicTicketCommands {
  createTicket(input: CreatePublicTicketInput & { readonly tenantId: string; readonly serviceClientId: string }): Promise<CreatedPublicTicket>;
}

export interface IdempotencyExecutor {
  /** Implementations must atomically return the original result for a matching key and fingerprint. */
  execute<T>(scope: string, key: string, fingerprint: string, operation: () => Promise<T>): Promise<T>;
}

export interface CreatePublicApiDependencies {
  readonly authenticator: PublicAuthenticator;
  readonly idempotency: IdempotencyExecutor;
  readonly tickets: PublicTicketCommands;
}

export class InMemoryIdempotencyExecutor implements IdempotencyExecutor {
  private readonly entries = new Map<string, { readonly fingerprint: string; readonly result: Promise<unknown> }>();

  async execute<T>(scope: string, key: string, fingerprint: string, operation: () => Promise<T>): Promise<T> {
    const storageKey = `${scope}:${key}`;
    const existing = this.entries.get(storageKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError();
      }
      return existing.result as Promise<T>;
    }

    const result = operation();
    this.entries.set(storageKey, { fingerprint, result });
    try {
      return await result;
    } catch (error) {
      this.entries.delete(storageKey);
      throw error;
    }
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different request.");
  }
}

export function createPublicApi(dependencies: CreatePublicApiDependencies) {
  return {
    async createTicket(request: { readonly authorization?: string; readonly idempotencyKey?: string; readonly body: unknown }): Promise<PublicApiResponse<CreatedPublicTicket | PublicApiProblem>> {
      const principal = await dependencies.authenticator.authenticateService(request.authorization);
      if (principal === null) {
        return problem("unauthorized", "Service authentication is required.", 401);
      }
      if (!principal.scopes.includes("tickets:write")) {
        return problem("forbidden", "The service client lacks the tickets:write scope.", 403);
      }

      const input = validateCreateTicketInput(request.body);
      if ("problem" in input) {
        return input.problem;
      }
      const key = validateIdempotencyKey(request.idempotencyKey);
      if (key === null) {
        return problem("validation_failed", "Request validation failed.", 422, { "Idempotency-Key": "A non-empty key of at most 200 characters is required." });
      }

      try {
        const ticket = await dependencies.idempotency.execute(
          `${principal.tenantId}:${principal.clientId}:POST:/v1/tickets`,
          key,
          JSON.stringify(input.value),
          () => dependencies.tickets.createTicket({ ...input.value, tenantId: principal.tenantId, serviceClientId: principal.clientId })
        );
        return { status: 201, body: ticket };
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return problem("idempotency_conflict", error.message, 409);
        }
        return problem("internal_error", "The request could not be completed.", 500);
      }
    }
  };
}

function validateCreateTicketInput(body: unknown): { readonly value: CreatePublicTicketInput } | { readonly problem: PublicApiResponse<PublicApiProblem> } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { problem: problem("validation_failed", "Request validation failed.", 422, { body: "A JSON object is required." }) };
  }
  const candidate = body as Record<string, unknown>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  const description = candidate.description === undefined ? undefined : typeof candidate.description === "string" ? candidate.description.trim() : null;
  const fields: Record<string, string> = {};
  if (title.length < 3 || title.length > 240) fields.title = "Title must contain between 3 and 240 characters.";
  if (description === null || (description !== undefined && description.length > 10_000)) fields.description = "Description must be a string of at most 10000 characters.";
  if (Object.keys(fields).length > 0) return { problem: problem("validation_failed", "Request validation failed.", 422, fields) };
  return { value: description === undefined ? { title } : { title, description } };
}

function validateIdempotencyKey(key: string | undefined): string | null {
  const value = key?.trim();
  return value !== undefined && value.length > 0 && value.length <= 200 ? value : null;
}

function problem(code: PublicApiProblemCode, title: string, status: number, fields?: Readonly<Record<string, string>>): PublicApiResponse<PublicApiProblem> {
  return { status, body: { type: `https://api.infodive.example/problems/${code}`, title, status, code, ...(fields === undefined ? {} : { fields }) } };
}
