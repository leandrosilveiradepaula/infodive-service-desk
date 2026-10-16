export interface IdentityProvider {
  userExists(userId: string): Promise<boolean>;
}
