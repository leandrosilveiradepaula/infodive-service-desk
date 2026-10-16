"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PropsWithChildren
} from "react";

/** Papéis correspondentes aos templates persistidos para o tenant. */
export type UserRole =
  | "tenant_administrator"
  | "service_manager"
  | "service_agent"
  | "requester"
  | "customer_administrator"
  | "customer_user";

export interface AuthenticatedProfile {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly tenantName: string;
  readonly roles: readonly UserRole[];
}

export interface AuthenticationContextValue {
  readonly profile: AuthenticatedProfile | null;
  readonly isAuthenticated: boolean;
  readonly hasAnyRole: (roles: readonly UserRole[]) => boolean;
  readonly signOut: () => Promise<void>;
}

const AuthenticationContext = createContext<AuthenticationContextValue | null>(null);

export interface AuthenticationProviderProps extends PropsWithChildren {
  readonly profile: AuthenticatedProfile | null;
  readonly onSignOut?: () => Promise<void> | void;
}

/**
 * Supplies client-side identity information used to personalize the interface.
 * Route and command authorization must continue to be enforced by the server.
 */
export function AuthenticationProvider({
  children,
  profile,
  onSignOut
}: AuthenticationProviderProps) {
  const hasAnyRole = useCallback(
    (roles: readonly UserRole[]) =>
      profile !== null && roles.some((role) => profile.roles.includes(role)),
    [profile]
  );

  const signOut = useCallback(async () => {
    await onSignOut?.();
  }, [onSignOut]);

  const value = useMemo<AuthenticationContextValue>(
    () => ({
      profile,
      isAuthenticated: profile !== null,
      hasAnyRole,
      signOut
    }),
    [hasAnyRole, profile, signOut]
  );

  return <AuthenticationContext.Provider value={value}>{children}</AuthenticationContext.Provider>;
}

export function useAuthentication(): AuthenticationContextValue {
  const context = useContext(AuthenticationContext);

  if (context === null) {
    throw new Error("useAuthentication deve ser usado dentro de AuthenticationProvider.");
  }

  return context;
}
