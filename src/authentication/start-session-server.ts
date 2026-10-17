import { createAuthApiServer } from "./auth-api-server";
import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw Error("Missing " + name);
  return value;
};
export function startSessionServer() {
  const port = Number(required("PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid PORT");
  const webRoot = required("SERVICE_DESK_WEB_ROOT");
  if (!isAbsolute(webRoot) || !statSync(join(webRoot, "index.html")).isFile()) throw Error("Invalid web root");
  const server = createAuthApiServer({
    supabaseUrl: required("SERVICE_DESK_SUPABASE_URL"),
    anonKey: required("SERVICE_DESK_SUPABASE_ANON_KEY"),
    secretKey: required("SERVICE_DESK_SUPABASE_SECRET_KEY"),
    tenantSigningKey: required("SERVICE_DESK_TENANT_SIGNING_KEY"),
    publicOrigin: required("SERVICE_DESK_PUBLIC_ORIGIN"),
    webRoot
  });
  return server.listen(port, "127.0.0.1");
}
if (require.main === module) startSessionServer();
