import { timingSafeEqual } from "node:crypto";
import { cookieValue, signTenantSelection } from "./session-cookies";
import type { VerifiedIdentityProvider, MembershipRepository } from "./session-adapters";

export interface TenantSelectionResult {
  readonly status: 200 | 400 | 401 | 403 | 405 | 503;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: { readonly ok: boolean };
}
const baseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, private",
  "Vary": "Cookie, Origin",
  "X-Content-Type-Options": "nosniff"
};
const denied = (status: TenantSelectionResult["status"]): TenantSelectionResult =>
  ({ status, headers: baseHeaders, body: { ok: false } });

function sameOrigin(origin: string | undefined, expected: string): boolean {
  if (!origin || !expected.startsWith("https://")) return false;
  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch { return false; }
}
function validCsrf(cookie: string | undefined, submitted: string | undefined): boolean {
  const expected = cookieValue(cookie, "sd-csrf");
  if (!expected || !submitted || !/^[a-f0-9]{64}$/.test(expected) ||
      !/^[a-f0-9]{64}$/.test(submitted)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(submitted));
}
/** Explicit tenant switching must be authorized independently of the active tenant. */
export async function selectTenant(
  input: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly tenantId: string;
  },
  options: {
    readonly origin: string;
    readonly signingKey: string;
    readonly identity: VerifiedIdentityProvider;
    readonly memberships: MembershipRepository;
  }
): Promise<TenantSelectionResult> {
  if (input.method !== "POST") return denied(405);
  if (!sameOrigin(input.headers.origin, options.origin) ||
      !validCsrf(input.headers.cookie, input.headers["x-csrf-token"])) return denied(403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.tenantId)) return denied(400);
  try {
    const identity = await options.identity.verifySession(input.headers);
    if (!identity) return denied(401);
    const rows = await options.memberships.findByUserId(identity.userId);
    if (!rows.some(row => row.userId === identity.userId && row.tenantId === input.tenantId &&
      row.membershipStatus === "active")) return denied(403);
    const signed = signTenantSelection(identity.userId, input.tenantId, Date.now() + 3600000, options.signingKey);
    return {
      status: 200,
      headers: { ...baseHeaders,
        "Set-Cookie": "sd-tenant-selection=" + signed + "; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax"
      },
      body: { ok: true }
    };
  } catch { return denied(503); }
}
