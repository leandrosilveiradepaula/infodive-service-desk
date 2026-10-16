import { toApiError, type ApiError } from "../shared/errors";

export interface ApiFailureResponse {
  status: number;
  body: ApiError;
}

export function toApiFailureResponse(error: unknown): ApiFailureResponse {
  const body = toApiError(error);

  return {
    status: body.error.code === "INTERNAL_ERROR" ? 500 : 400,
    body
  };
}
