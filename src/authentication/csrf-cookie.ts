import { randomBytes } from "node:crypto";
import { cookieValue } from "./session-cookies";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, private",
  "Vary": "Cookie, Origin",
  "X-Content-Type-Options": "nosniff"
};
export interface CsrfResult {
  readonly status: 200 | 403 | 405;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: { readonly csrfToken?: string; readonly ok: boolean };
}
/** CSRF bootstrap is read-only and issues a random, non-authenticating double-submit token. */
export function issueCsrf(method: string): CsrfResult {
  if (method !== "GET") return { status: 405, headers: { ...headers, Allow: "GET" }, body: { ok: false } };
  const token = randomBytes(32).toString("hex");
  return { status: 200, headers: {
    ...headers,
    "Set-Cookie": "sd-csrf=" + token + "; Path=/; Max-Age=3600; Secure; SameSite=Lax"
  }, body: { ok: true, csrfToken: token } };
}
export function clearAuthCookies(): readonly string[] {
  return [
    "sd-access-token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    "sd-tenant-selection=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    "sd-csrf=; Path=/; Max-Age=0; Secure; SameSite=Lax"
  ];
}
export function hasCsrfCookie(cookie: string | undefined): boolean {
  return /^[0-9a-f]{64}$/.test(cookieValue(cookie, "sd-csrf") ?? "");
}
