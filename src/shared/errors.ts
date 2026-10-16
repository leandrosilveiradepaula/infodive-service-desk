export type ErrorDetails = Record<string, unknown>;

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: ErrorDetails;
  };
}

export class DomainError extends Error {
  public readonly code: string;
  public readonly details?: ErrorDetails;

  public constructor(code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }

  public toApiError(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details })
      }
    };
  }
}

export class ValidationError extends DomainError {
  public constructor(message: string, details?: ErrorDetails) {
    super("VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof DomainError) {
    return error.toApiError();
  }

  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred."
    }
  };
}
