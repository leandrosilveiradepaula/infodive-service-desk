from pathlib import Path
import re
from playwright.sync_api import sync_playwright
folder=Path(".qa-evidence")
folder.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(ignore_https_errors=True)
    page=context.new_page()
    errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.goto("https://localhost:3320/")
    page.get_by_role("heading",name="Acessar Service Desk").wait_for()
    layout=page.get_by_test_id("login-layout")
    card=page.get_by_test_id("login-card")
    assert layout.evaluate("element => getComputedStyle(element).display")=="grid"
    assert card.evaluate("element => getComputedStyle(element).fontFamily") != "Times New Roman"
    assert card.bounding_box()["width"] > 280
    page.screenshot(path=str(folder/"01-login.png"))
    page.set_viewport_size({"width":390,"height":844})
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2")
    assert page.get_by_role("heading",name="Acessar Service Desk").is_visible()
    page.screenshot(path=str(folder/"01-login-mobile.png"))
    page.set_viewport_size({"width":1280,"height":900})
    page.get_by_label("E-mail").fill("browser.qa@infodive.test")
    page.get_by_label("Senha").fill("Disposable-Only-QA-Password-2026")
    page.get_by_role("button",name="Entrar").click()
    page.get_by_role("heading",name="Bem-vindo ao Service Desk").wait_for()
    page.get_by_role("button",name="Consultar chamados").click()
    page.get_by_role("heading",name="Chamados da sua empresa").wait_for()
    subject="Chamado QA Chromium persistido"
    page.get_by_label("Assunto").fill(subject)
    page.get_by_label("Descrição").fill("Teste real com PostgREST e RLS")
    page.get_by_label("Prioridade").select_option("high")
    with page.expect_response(lambda r:r.url.endswith("/api/tickets") and r.request.method=="POST") as result:
        page.get_by_role("button",name="Abrir chamado").click()
    response=result.value
    assert response.status==201, (response.status,response.text())
    ticket=response.json()["ticket"]
    assert ticket["subject"]==subject and ticket["protocol"]
    button=page.get_by_role("button",name=re.compile(re.escape(subject)))
    button.wait_for()
    page.screenshot(path=str(folder/"02-created.png"))
    page.reload()
    page.get_by_role("button",name=re.compile(re.escape(subject))).click()
    page.get_by_role("heading",name=re.compile(re.escape(ticket["protocol"]))).wait_for()
    page.screenshot(path=str(folder/"03-persisted.png"))
    page.get_by_label("Abrir menu da conta").click()
    page.get_by_role("button",name="Sair").click()
    page.get_by_role("heading",name="Acessar Service Desk").wait_for()
    status=page.evaluate("async () => (await fetch('/api/tickets')).status")
    assert status==401,status
    assert not errors,errors
    print("BROWSER_QA_HTTPS_TICKET_CREATE_RELOAD_LOGOUT_PASS=1")
    print("QA_AUTH_MOCKED_POSTGREST_REAL=1")
    browser.close()
