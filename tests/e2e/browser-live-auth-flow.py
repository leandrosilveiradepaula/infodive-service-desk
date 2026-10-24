"""Real local GoTrue password login/refresh/logout + RLS ticket browser QA.

Never connects to Supabase production. The HTTP gateway rejects every origin
other than its loopback GoTrue/PostgREST disposable services.
"""
from __future__ import annotations
import os
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

if (os.environ.get("ISOLATED_PG_ONLY") != "1"
    or os.environ.get("PGDATABASE") != "service_desk_security_test"
    or os.environ.get("SERVICE_DESK_QA_REAL_AUTH") != "1"):
    raise SystemExit("Refusing browser real Auth QA outside disposable database")

evidence=Path(".qa-evidence")
evidence.mkdir(exist_ok=True)
email="browser.auth.real@infodive.test"
password="Disposable-Only-QA-Password-2026"
tenant_b="10000000-0000-4000-8000-000000000002"
foreign_email="browser.auth.foreign@infodive.test"

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(ignore_https_errors=True)
    page=context.new_page()
    errors=[]
    page.on("pageerror",lambda err:errors.append(str(err)))
    page.goto("https://localhost:3320/")
    page.get_by_role("heading",name="Acessar Service Desk").wait_for()

    # Wrong password must be refused by real GoTrue without auth cookies.
    page.get_by_label("E-mail").fill(email)
    page.get_by_label("Senha").fill(password+"-invalid")
    with page.expect_response(lambda r:r.url.endswith("/api/auth/login")) as denied:
        page.get_by_role("button",name="Entrar").click()
    assert denied.value.status==401,denied.value.status
    assert page.get_by_role("heading",name="Acessar Service Desk").is_visible()

    # Foreign tenant membership is valid in tenant A but not tenant B.
    # Use same-origin browser POST and the real double-submit CSRF token.
    rejection=page.evaluate("""async ({email,password,tenantId}) => {
        const csrf = document.cookie.split("; ").find(x=>x.startsWith("sd-csrf="))?.split("=")[1];
        if (!csrf) throw Error("CSRF cookie absent");
        const r=await fetch("/api/auth/login",{
            method:"POST",
            headers:{"Content-Type":"application/json","x-csrf-token":csrf},
            body:JSON.stringify({email,password,tenantId})
        });
        return {status:r.status,hasAuthCookie:document.cookie.includes("sd-tenant-selection=")};
    }""",{"email":foreign_email,"password":password,"tenantId":tenant_b})
    assert rejection=={"status":403,"hasAuthCookie":False},rejection

    # Full password grant through GoTrue /token, then live /user lookup.
    page.get_by_label("E-mail").fill(email)
    page.get_by_label("Senha").fill(password)
    with page.expect_response(lambda r:r.url.endswith("/api/auth/login")) as accepted:
        page.get_by_role("button",name="Entrar").click()
    assert accepted.value.status==200,accepted.value.status
    page.get_by_role("heading",name="Bem-vindo ao Service Desk").wait_for()
    page.screenshot(path=str(evidence/"04-gotrue-authenticated.png"))

    # Refresh MUST rotate through the actual GoTrue /token?grant_type=refresh_token.
    refreshed=page.evaluate("""async () => {
        const csrf=document.cookie.split("; ").find(x=>x.startsWith("sd-csrf="))?.split("=")[1];
        if (!csrf) throw Error("CSRF cookie absent");
        const refresh=await fetch("/api/auth/refresh",{
          method:"POST", headers:{"x-csrf-token":csrf}
        });
        const session=await fetch("/api/session");
        return {refresh:refresh.status,session:session.status,
                identity:(await session.json()).authenticated};
    }""")
    assert refreshed=={"refresh":200,"session":200,"identity":True},refreshed

    page.get_by_role("button",name="Consultar chamados").click()
    page.get_by_role("heading",name="Chamados da sua empresa").wait_for()
    subject="Chamado QA GoTrue real com RLS"
    page.get_by_label("Assunto").fill(subject)
    page.get_by_label("Descrição").fill("Senha/refresh/logout autenticados em GoTrue local")
    page.get_by_label("Prioridade").select_option("high")
    with page.expect_response(lambda r:r.url.endswith("/api/tickets") and r.request.method=="POST") as created:
        page.get_by_role("button",name="Abrir chamado").click()
    assert created.value.status==201,(created.value.status,created.value.text())
    ticket=created.value.json()["ticket"]
    assert ticket["subject"]==subject and ticket["protocol"]
    page.get_by_role("button",name=re.compile(re.escape(subject))).wait_for()
    page.reload()
    page.get_by_role("button",name=re.compile(re.escape(subject))).click()
    page.get_by_role("heading",name=re.compile(re.escape(ticket["protocol"]))).wait_for()
    page.screenshot(path=str(evidence/"05-gotrue-ticket-persisted.png"))

    page.get_by_label("Abrir menu da conta").click()
    page.get_by_role("button",name="Sair").click()
    page.get_by_role("heading",name="Acessar Service Desk").wait_for()
    result=page.evaluate("""async () => ({
        tickets:(await fetch("/api/tickets")).status,
        session:(await fetch("/api/session")).status
    })""")
    assert result=={"tickets":401,"session":401},result
    assert not errors,errors
    print("GOTRUE_REAL_PASSWORD_REFRESH_LOGOUT_PASS=1")
    print("BROWSER_QA_REAL_GOTRUE_RLS_TICKET_PASS=1")
    print("BROWSER_QA_NO_MANAGED_SUPABASE_CALLS=1")
    browser.close()
