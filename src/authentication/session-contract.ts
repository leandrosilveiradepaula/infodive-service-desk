/** Session response is server-verified. Browser claims are never authorization evidence. */
export interface VerifiedSessionProfile {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly tenantName: string;
  readonly roles: readonly string[];
}
export interface VerifiedSessionResponse {
  readonly authenticated: boolean;
  readonly profile: VerifiedSessionProfile | null;
}
export const UNAUTHENTICATED_SESSION: VerifiedSessionResponse = Object.freeze({
  authenticated: false,
  profile: null
});
export function parseVerifiedSession(input: unknown): VerifiedSessionResponse {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return UNAUTHENTICATED_SESSION;
  }
  const response = input as Record<string, unknown>;
  if (response.authenticated !== true || typeof response.profile !== "object" ||
      response.profile === null || Array.isArray(response.profile)) {
    return UNAUTHENTICATED_SESSION;
  }
  const profile = response.profile as Record<string, unknown>;
  if (typeof profile.userId !== "string" || profile.userId.trim() === "" ||
      typeof profile.displayName !== "string" || typeof profile.email !== "string" ||
      typeof profile.tenantName !== "string" || !Array.isArray(profile.roles) ||
      !profile.roles.every(role => typeof role === "string")) {
    return UNAUTHENTICATED_SESSION;
  }
  return { authenticated: true, profile: {
    userId: profile.userId, displayName: profile.displayName,
    email: profile.email, tenantName: profile.tenantName, roles: profile.roles
  }};
}
