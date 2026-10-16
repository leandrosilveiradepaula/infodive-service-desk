import type { VerifiedIdentityProvider } from "./session-adapters";
import type { ServerIdentity } from "./server-session";

export interface AuthHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}
export type AuthFetch = (url: string, init: {
  readonly method: "GET";
  readonly headers: Readonly<Record<string, string>>;
  readonly cache: "no-store";
}) => Promise<AuthHttpResponse>;
/**
 * Validates the opaque bearer token by asking Supabase Auth /user.
 * A bearer token is not accepted merely because it parses as a JWT.
 * The caller must provide a trusted server-side token extraction mechanism.
 */
export function createSupabaseIdentityProvider(
  supabaseUrl: string,
  publishableKey: string,
  extractToken: (headers: Readonly<Record<string, string | undefined>>) => string | null,
  request: AuthFetch
): VerifiedIdentityProvider {
  if (!/^https:\/\//.test(supabaseUrl) || !publishableKey.trim()) {
    throw Error("Supabase identity provider configuration is required");
  }
  const endpoint = supabaseUrl.replace(/\/$/, "") + "/auth/v1/user";
  return {
    verifySession: async headers => {
      const token = extractToken(headers);
      if (!token || !token.trim()) return null;
      const response = await request(endpoint, {
        method: "GET",
        headers: { apikey: publishableKey, Authorization: "Bearer " + token },
        cache: "no-store"
      });
      if (!response.ok || response.status !== 200) return null;
      const payload = await response.json();
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
      const user = payload as Record<string, unknown>;
      if (typeof user.id !== "string" || !user.id.trim() ||
          typeof user.email !== "string" || !user.email.trim()) return null;
      const identity: ServerIdentity = { userId: user.id, email: user.email };
      return identity;
    }
  };
}
