import { extractAccessToken } from "./session-cookies";

/** Revokes the current Supabase refresh-session; JWT access tokens remain valid until exp. */
export async function revokeCurrentSession(
  supabaseUrl: string, anonKey: string, cookie: string | undefined, request: typeof fetch
): Promise<"revoked" | "anonymous" | "unavailable"> {
  const token = extractAccessToken({ cookie });
  if (!token) return "anonymous";
  try {
    const response = await request(supabaseUrl.replace(/\/$/, "") + "/auth/v1/logout?scope=local", {
      method: "POST", headers: { apikey: anonKey, Authorization: "Bearer " + token },
      cache: "no-store", signal: AbortSignal.timeout(8000)
    });
    return response.ok ? "revoked" : "unavailable";
  } catch { return "unavailable"; }
}
