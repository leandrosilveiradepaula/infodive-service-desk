import { timingSafeEqual } from "node:crypto";
import { cookieValue } from "./session-cookies";

export function validLogoutRequest(
  headers: Readonly<Record<string, string | undefined>>,
  expectedOrigin: string
): boolean {
  if (!expectedOrigin.startsWith("https://") || !headers.origin) return false;
  let actual: string;
  try { actual = new URL(headers.origin).origin; } catch { return false; }
  if (actual !== new URL(expectedOrigin).origin) return false;
  const cookie = cookieValue(headers.cookie, "sd-csrf");
  const provided = headers["x-csrf-token"];
  if (!cookie || !provided || !/^[a-f0-9]{64}$/.test(cookie) ||
      !/^[a-f0-9]{64}$/.test(provided)) return false;
  return timingSafeEqual(Buffer.from(cookie), Buffer.from(provided));
}
