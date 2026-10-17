import { resolveServerSession, type SessionDependencies, type SessionResult } from "./server-session";

export interface SessionHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}
/** Only the session path is handled; mount at the server edge after cookie parsing. */
export async function handleSessionHttpRequest(
  request: SessionHttpRequest,
  dependencies: SessionDependencies
): Promise<SessionResult | null> {
  const pathname = request.url.split("?")[0];
  if (pathname !== "/api/session") return null;
  if (request.method !== "GET") {
    return {
      status: 405,
      headers: {
        "Allow": "GET",
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, private",
        "Vary": "Cookie",
        "X-Content-Type-Options": "nosniff"
      },
      body: { authenticated: false, profile: null }
    };
  }
  return resolveServerSession(request.headers, dependencies);
}
