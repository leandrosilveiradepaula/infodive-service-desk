import { parseVerifiedSession, UNAUTHENTICATED_SESSION, type VerifiedSessionResponse } from "./session-contract";

export interface SessionHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}
export type SessionRequest = (url: string, init: {
  readonly method: "GET";
  readonly credentials: "same-origin";
  readonly cache: "no-store";
  readonly headers: Readonly<Record<string, string>>;
}) => Promise<SessionHttpResponse>;

/** No localStorage/JWT decoding, no demo identity and no fallback principal. */
export async function loadVerifiedSession(request: SessionRequest): Promise<VerifiedSessionResponse> {
  try {
    const response = await request("/api/session", {
      method: "GET", credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok || response.status !== 200) return UNAUTHENTICATED_SESSION;
    return parseVerifiedSession(await response.json());
  } catch {
    return UNAUTHENTICATED_SESSION;
  }
}
