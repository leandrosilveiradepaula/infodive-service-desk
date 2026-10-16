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
export function verifyTenantSelection(
  cookie: string | undefined, userId: string, signingKey: string
): string | null {
  if (signingKey.length < 32) return null;
  const value = cookieValue(cookie, "sd-tenant-selection");
  if (!value) return null;
  const match = /^([0-9a-f-]{36})\.([0-9]{10,13})\.([0-9a-f]{64})$/.exec(value);
  if (!match) return null;
  const [, tenantId, expires, signature] = match;
  if (!tenantId || !expires || !signature || Number(expires) <= Date.now()) return null;
  const message = userId + "." + tenantId + "." + expires;
  const expected = createHmac("sha256", signingKey).update(message).digest();
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return tenantId;
}
export function signTenantSelection(userId: string, tenantId: string, expiresAt: number, key: string): string {
  if (key.length < 32 || !/^[0-9a-f-]{36}$/.test(tenantId) || !userId.trim() ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw Error("Invalid tenant selection");
  const expires = String(expiresAt);
  const signature = createHmac("sha256", key).update(userId + "." + tenantId + "." + expires).digest("hex");
  return tenantId + "." + expires + "." + signature;
}
