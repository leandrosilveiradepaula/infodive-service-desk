# Service Desk - Preview Vercel (sem liberar producao)

A PR #5 Draft usa React/Vite (dist-web/) e Vercel Functions Node (api/).
As funcoes importam o mesmo handler HTTP de Auth, sessao e tickets do servidor Node.
Nenhuma API simulada, bypass de CSRF ou novo middleware de autorizacao foi criado.

Configuracao:
- vercel.json executa npm run build:web, serve dist-web e reescreve /chamados para /index.html.
- Rotas /api sao arquivos no diretorio api; nao ha proxy externo, cron ou producao automatica no codigo.
- Em VERCEL_ENV=preview, a origem de CSRF vem de VERCEL_URL trusted, nunca de Host do cliente.
- Variaveis privadas necessarias para autenticacao hospedada:
  SERVICE_DESK_SUPABASE_URL, SERVICE_DESK_SUPABASE_ANON_KEY,
  SERVICE_DESK_SUPABASE_SECRET_KEY, SERVICE_DESK_TENANT_SIGNING_KEY (32+ caracteres).
- Fora de Preview e obrigatoria SERVICE_DESK_PUBLIC_ORIGIN com origem HTTPS exata.
- Sem backend configurado, frontend pode ser renderizado, mas API retorna 503 backend_unavailable.
  Isso nao comprova integracao de Auth/Tickets e nao autoriza product_ready ou release.

Verificacao obrigatoria:
1. CI nativa na PR e QA PostgreSQL/PostgREST/GoTrue/Playwright isolada, no SHA exato.
2. Associar o projeto Vercel ao repo sem liberar merge/main de producao.
3. Deployment de Preview READY no SHA da PR e browser smoke test contra URL HTTPS exata.
4. Para E2E hospedado: Supabase homologacao isolado, migrations revisadas, usuarios e
   memberships descartaveis; testar sessao real, renovacao, CSRF, tenant e chamados.

Sem auto-merge, migration produtiva, criacao de projeto pago ou API de modelo.
