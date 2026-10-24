/**
 * Ephemeral HTTPS gateway for browser QA. NEVER import into production.
 * Supabase Auth is simulated; tickets use real RLS-scoped PostgREST in CI.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { resolve } from "node:path";
import { createAuthApiServer } from "../../src/authentication/auth-api-server";

const requirements: Record<string,string> = {
  ISOLATED_PG_ONLY: "1", PGHOST: "127.0.0.1", PGPORT: "5432",
  PGDATABASE: "service_desk_security_test", PGUSER: "postgres",
  PGPASSWORD: "disposable-qa-only-password"
};
for (const [key, value] of Object.entries(requirements))
  if (process.env[key] !== value) throw Error("Refusing non-disposable QA target");
const key = process.env.QA_TLS_KEY, cert = process.env.QA_TLS_CERT;
if (!key || !cert) throw Error("Missing QA TLS");

const userId = "10000000-0000-4000-8000-000000000022";
const tenantId = "10000000-0000-4000-8000-000000000002";
const jwtSecret = "disposable-service-desk-postgrest-jwt-key-qa-only-64-characters-minimum";
const email = "browser.qa@infodive.test", password = "Disposable-Only-QA-Password-2026";
const b64 = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
const now = Math.floor(Date.now()/1000);
const unsigned = b64({alg:"HS256",typ:"JWT"})+"."+b64({
  sub:userId, role:"authenticated", aud:"authenticated", iat:now, exp:now+600
});
const jwt=unsigned+"."+createHmac("sha256",jwtSecret).update(unsigned).digest("base64url");
const isUserToken=(candidate:string)=>{
  const expected=Buffer.from(jwt), actual=Buffer.from(candidate);
  return expected.length===actual.length && timingSafeEqual(expected,actual);
};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"Content-Type":"application/json"}
});
const request: typeof fetch=async (raw,init)=>{
  const url=new URL(String(raw));
  if(url.origin!=="https://qa-only.invalid") throw Error("External API refused");
  const headers=new Headers(init?.headers), bearer=(headers.get("Authorization")??"").replace(/^Bearer /,"");
  if(url.pathname==="/auth/v1/token" && url.searchParams.get("grant_type")==="password"){
    const data=JSON.parse(String(init?.body)) as {email?:string;password?:string};
    if(data.email!==email || data.password!==password) return json({},400);
    return json({access_token:jwt,refresh_token:"qa-only-refresh-token",expires_in:600});
  }
  if(url.pathname==="/auth/v1/user")
    return isUserToken(bearer)?json({id:userId,email}):json({},401);
  if(url.pathname==="/auth/v1/logout")
    return isUserToken(bearer)?new Response(null,{status:204}):json({},401);
  if(url.pathname==="/rest/v1/users" || url.pathname==="/rest/v1/memberships"){
    if(headers.get("apikey")!=="sb_secret_qa_only") return json({},403);
    if(url.pathname.endsWith("users")) return json([{
      id:userId,tenant_id:tenantId,display_name:"Agente QA"
    }]);
    return json([{user_id:userId,tenant_id:tenantId,status:"active",
      roles:{code:"requester",tenant_id:tenantId},tenants:{name:"Empresa de homologação"}}]);
  }
  if(url.pathname==="/rest/v1/tickets"){
    if(!isUserToken(bearer)) return json({},401);
    const upstream=new URL("http://127.0.0.1:3319/tickets");
    upstream.search=url.search;
    return fetch(upstream.toString(),{
      method:init?.method??"GET",
      headers:{
        Authorization:"Bearer "+jwt,Accept:"application/json",
        ...(init?.body!==undefined?{"Content-Type":"application/json",Prefer:"return=representation"}:{})
      },
      ...(init?.body!==undefined?{body:init.body}:{}),
      cache:"no-store",signal:AbortSignal.timeout(8000)
    });
  }
  throw Error("Unknown fixture route "+url.pathname);
};
const api=createAuthApiServer({
  supabaseUrl:"https://qa-only.invalid",anonKey:"qa-only-publishable",
  secretKey:"sb_secret_qa_only",
  tenantSigningKey:"qa-only-hmac-key-that-cannot-exist-in-production",
  publicOrigin:"https://localhost:3320",webRoot:resolve("dist-web")
},request);
const listener=api.listeners("request")[0];
if(typeof listener!=="function") throw Error("Missing API listener");
createHttpsServer({key:readFileSync(key),cert:readFileSync(cert)},
  (incoming,response)=>{listener(incoming,response);})
  .listen(3320,"127.0.0.1",()=>console.log("QA_HTTPS_READY=1"));
