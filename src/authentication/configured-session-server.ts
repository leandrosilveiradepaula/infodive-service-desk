import { createSessionHttpServer } from "./session-node-server";
import { createRequestSessionDependencies } from "./session-adapters";
import { createSupabaseIdentityProvider } from "./supabase-identity";
import { createSupabaseMembershipRepository } from "./supabase-memberships";
import { extractAccessToken, verifyTenantSelection } from "./session-cookies";

export interface SessionServerConfig {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly secretKey: string;
  readonly tenantSigningKey: string;
}
export function createConfiguredSessionServer(config: SessionServerConfig, request: typeof fetch = fetch) {
  if (config.tenantSigningKey.length < 32) throw Error("Invalid tenant signing key");
  const identity = createSupabaseIdentityProvider(config.supabaseUrl, config.anonKey, extractAccessToken, request);
  const memberships = createSupabaseMembershipRepository(config.supabaseUrl, config.secretKey, request);
  return createSessionHttpServer(headers => {
    let verifiedUserId: string | null = null;
    return createRequestSessionDependencies(headers, {
      verifySession: async incoming => {
        const user = await identity.verifySession(incoming);
        verifiedUserId = user?.userId ?? null;
        return user;
      }
    }, memberships, {
      selectedTenantId: async () => verifiedUserId
        ? verifyTenantSelection(headers.cookie, verifiedUserId, config.tenantSigningKey)
        : null
    });
  });
}
