/**
 * Disposable HTTPS browser QA with REAL local Supabase Auth (GoTrue).
 * This test does NOT connect to a managed Supabase instance.
 * It must NEVER be imported by production code or used as a release probe.
 *
 * Authentication: pinned GoTrue container on 127.0.0.1:3321, real password
 * grant, user verification, refresh and logout.
 * Membership lookups: ephemeral PostgreSQL via privileged loopback PostgREST.
 * Ticket CRUD: ephemeral PostgreSQL via JWT/RLS-scoped loopback PostgREST.
 */
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { resolve } from "node:path";
import { createAuthApiServer } from "../../src/authentication/auth-api-server";

const expected: Record<string,string> = {
  ISOLATED_PG_ONLY: "1",
  PGHOST: "127.0.0.1",
  PGPORT: "5432",
  PGDATABASE: "service_desk_security_test",
  PGUSER: "postgres",
  PGPASSWORD: "disposable-qa-only-password",
  SERVICE_DESK_QA_REAL_AUTH: "1",
};
for (const [name,value] of Object.entries(expected)) {
  if (process.env[name] !== value) throw Error("Refusing non-disposable GoTrue QA: "+name);
}
const tlsKey=process.env.QA_TLS_KEY;
const tlsCert=process.env.QA_TLS_CERT;
if (!tlsKey || !tlsCert) throw Error("Disposable QA TLS is required");

const json=(value: unknown,status: number)=>new Response(JSON.stringify(value),{
  status,headers: {"Content-Type":"application/json"}
});
const apiRequest: typeof fetch=async (raw,init)=>{
  const source=new URL(String(raw));
  if (source.origin !== "https://qa-only.invalid")
    throw Error("Non-disposable Auth/REST origin refused");
  const headers=new Headers(init?.headers);
  const method=init?.method ?? "GET";
  const body=init?.body;
  const opts: RequestInit={
    method,headers,cache:"no-store",redirect:"manual",
    ...(body!==undefined?{body}:{}),
    signal:AbortSignal.timeout(8000),
  };
  if (source.pathname.startsWith("/auth/v1/")) {
    // GoTrue's own HTTP service is mounted behind /auth/v1 in production,
    // but exposes /token, /user and /logout directly on its internal port.
    const path=source.pathname.slice("/auth/v1".length);
    if (!["/token","/user","/logout"].includes(path))
      throw Error("Unexpected auth endpoint");
    return fetch("http://127.0.0.1:3321"+path+source.search,opts);
  }
  if (source.pathname==="/rest/v1/users" || source.pathname==="/rest/v1/memberships") {
    if (headers.get("apikey")!=="sb_secret_qa_only") return json({error:"forbidden"},403);
    // The memberships adapter is server-only. This privileged PostgREST
    // target is accessible only in the disposable runner and never from UI.
    headers.delete("apikey");
    headers.delete("Authorization");
    return fetch("http://127.0.0.1:3318"+source.pathname.slice("/rest/v1".length)+source.search,opts);
  }
  if (source.pathname==="/rest/v1/tickets") {
    // The real GoTrue token is forwarded unchanged. PostgREST validates its
    // signature and role and applies tenant/user RLS; no fixed test JWT here.
    if (!headers.get("Authorization")?.startsWith("Bearer "))
      return json({error:"unauthenticated"},401);
    headers.delete("apikey");
    return fetch("http://127.0.0.1:3319/tickets"+source.search,{
      ...opts,
      headers:{
        Authorization:headers.get("Authorization")??"",
        Accept:"application/json",
        ...(body!==undefined?{
          "Content-Type":"application/json","Prefer":"return=representation"
        }:{}),
      }
    });
  }
  throw Error("Unknown disposable provider route");
};

const app=createAuthApiServer({
  supabaseUrl:"https://qa-only.invalid",
  anonKey:"qa-only-publishable",
  secretKey:"sb_secret_qa_only",
  tenantSigningKey:"qa-only-hmac-key-that-cannot-exist-in-production",
  publicOrigin:"https://localhost:3320",
  webRoot:resolve("dist-web"),
},apiRequest);
const listener=app.listeners("request")[0];
if (typeof listener!=="function") throw Error("Missing real auth app HTTP handler");
createHttpsServer({key:readFileSync(tlsKey),cert:readFileSync(tlsCert)},
  (request,response)=>{listener(request,response);})
  .listen(3320,"127.0.0.1",()=>console.log("QA_LIVE_GOTRUE_HTTPS_READY=1"));
