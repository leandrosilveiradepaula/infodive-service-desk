import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";
const asset = /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|ico|woff2?)$/;
const mime: Record<string, string> = { js:"text/javascript", css:"text/css", svg:"image/svg+xml", png:"image/png", ico:"image/x-icon", woff:"font/woff", woff2:"font/woff2" };
const security = { "X-Content-Type-Options":"nosniff", "X-Frame-Options":"DENY", "Referrer-Policy":"no-referrer",
  "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" };
export async function serveStaticWeb(method: string, pathname: string, root: string | undefined, response: ServerResponse): Promise<boolean> {
  if (!root || !(pathname === "/" || pathname === "/index.html" || pathname === "/chamados" || asset.test(pathname))) return false;
  if (method !== "GET" && method !== "HEAD") { response.writeHead(405, {...security, Allow:"GET, HEAD"}); response.end(); return true; }
  const name = pathname === "/" || pathname === "/index.html" || pathname === "/chamados" ? "index.html" : pathname.slice(1);
  try {
    const [base, target] = await Promise.all([realpath(resolve(root)), realpath(resolve(root, name))]);
    const allowed = name === "index.html" ? base : await realpath(resolve(base, "assets"));
    if (!target.startsWith(allowed + sep)) throw Error("Invalid path");
    const body = await readFile(target);
    const type = name === "index.html" ? "text/html" : mime[name.split(".").pop() ?? ""] ?? "application/octet-stream";
    response.writeHead(200, {...security, "Content-Type":type+"; charset=utf-8", "Cache-Control":name==="index.html"?"no-store":"public, max-age=31536000, immutable"});
    response.end(method==="HEAD"?undefined:body);
  } catch { response.writeHead(404, security); response.end(); }
  return true;
}
