import { createHmac, timingSafeEqual } from "node:crypto";

/** Session cookies are HttpOnly, Secure, SameSite=Lax and issued by a trusted login flow. */
export function cookieValue(header: string | undefined, name: string): string | null {
  const entry = (header ?? "").split(";").map(item => item.trim()).find(item => item.startsWith(name + "="));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return null; }
}
export function extractAccessToken(headers: Readonly<Record<string, string | undefined>>): string | null {
  const token = cookieValue(headers.cookie, "sd-access-token");
  return token && token.length <= 8192 ? token : null;
}
/** Signed tenant selection is bound to the verified Supabase user ID. */
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

/** Verify the tenant HMAC *before* consuming a single-use refresh token. */
export function readSignedTenantSelection(
  cookie: string | undefined, signingKey: string
): { userId: string; tenantId: string } | null {
  if (signingKey.length < 32) return null;
  const value = cookieValue(cookie, "sd-tenant-selection");
  if (!value) return null;
  const match = /^([0-9a-f-]{36})\.([0-9a-f-]{36})\.([0-9]{13})\.([0-9a-f]{64})$/.exec(value);
  if (!match) return null;
  const [, userId, tenantId, expires, signature] = match;
  if (!userId || !tenantId || !expires || !signature ||
      !uuidPattern.test(userId) || !uuidPattern.test(tenantId)) return null;
  const expiry = Number(expires);
  const now = Date.now();
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + 3600000) return null;
  const expected = createHmac("sha256", signingKey)
    .update(userId + "." + tenantId + "." + expires).digest();
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { userId, tenantId };
}
export function verifyTenantSelection(
  cookie: string | undefined, userId: string, signingKey: string
): string | null {
  const selection = readSignedTenantSelection(cookie, signingKey);
  return selection?.userId === userId ? selection.tenantId : null;
}
export function signTenantSelection(userId: string, tenantId: string, expiresAt: number, key: string): string {
  const now = Date.now();
  if (key.length < 32 || !uuidPattern.test(userId) || !uuidPattern.test(tenantId) ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 3600000)
    throw Error("Invalid tenant selection");
  const expires = String(expiresAt);
  const signature = createHmac("sha256", key)
    .update(userId + "." + tenantId + "." + expires).digest("hex");
  return userId + "." + tenantId + "." + expires + "." + signature;
}

/** The refresh and tenant cookies are bounded to one hour, not permanent browser storage. */
export const SESSION_COOKIE_MAX_AGE = 3600;
export function extractRefreshToken(header: string | undefined): string | null {
  const value = cookieValue(header, "sd-refresh-token");
  return value && value.length >= 10 && value.length <= 8192 ? value : null;
}
export function issueAuthCookies(
  accessToken: string, refreshToken: string, selection: string, accessSeconds: number
): string[] {
  if (!accessToken || !refreshToken || !selection ||
      !Number.isInteger(accessSeconds) || accessSeconds < 1 || accessSeconds > 3600) {
    throw Error("Invalid session cookies");
  }
  return [
    "sd-access-token=" + encodeURIComponent(accessToken) +
      "; Path=/; Max-Age=" + accessSeconds + "; HttpOnly; Secure; SameSite=Lax",
    "sd-refresh-token=" + encodeURIComponent(refreshToken) +
      "; Path=/api/auth; Max-Age=" + SESSION_COOKIE_MAX_AGE + "; HttpOnly; Secure; SameSite=Lax",
    "sd-tenant-selection=" + selection +
      "; Path=/; Max-Age=" + SESSION_COOKIE_MAX_AGE + "; HttpOnly; Secure; SameSite=Lax"
  ];
}
