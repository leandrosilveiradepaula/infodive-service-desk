import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthApiServer } from "../src/authentication/auth-api-server";
test("one origin serves bundled UI and API without exposing private files", async () => {
  const root=mkdtempSync(join(tmpdir(),"desk-web-"));
  mkdirSync(join(root,"assets"));
  writeFileSync(join(root,"index.html"),"<title>Desk</title>");
  writeFileSync(join(root,"assets","app.js"),"console.log('safe')");
  writeFileSync(join(root,"private.txt"),"secret");
  symlinkSync(join(root,"private.txt"),join(root,"assets","link.js"));
  const server=createAuthApiServer({supabaseUrl:"https://example.supabase.co",anonKey:"anon",secretKey:"sb_secret_test",tenantSigningKey:"k".repeat(48),publicOrigin:"https://desk.test",webRoot:root},async()=>new Response("{}",{status:503}));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const address=server.address(); assert.ok(address && typeof address!=="string");
    const base="http://127.0.0.1:"+address.port;
    const html=await fetch(base+"/"); assert.equal(html.status,200);assert.match(await html.text(),/Desk/);
    assert.match(html.headers.get("content-security-policy")??"",/frame-ancestors 'none'/);
    assert.equal((await fetch(base+"/assets/app.js")).status,200);
    assert.equal((await fetch(base+"/assets/app.js",{method:"HEAD"})).status,200);
    assert.equal((await fetch(base+"/private.txt")).status,404);
    assert.equal((await fetch(base+"/assets/link.js")).status,404);
    assert.equal((await fetch(base+"/assets/app.js",{method:"POST"})).status,405);
    assert.equal((await fetch(base+"/api/session")).status,401);
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(root,{recursive:true,force:true}); }
});
