# Service Desk — autenticação e publicação

**Estado: candidato em branch Draft; não publicado em produção.**

## Integração HTTP + interface

O servidor Node em `src/authentication/start-session-server.ts` integra rotas de
autenticação e arquivos compilados Vite na mesma origem. Executar
`npm ci && npm run ci` antes do start; o build cria `dist/` e `dist-web/`.

Variáveis de ambiente **apenas no backend**:

- `PORT`: porta local, 1–65535
- `SERVICE_DESK_WEB_ROOT`: diretório absoluto existente que contém `dist-web/index.html`
- `SERVICE_DESK_PUBLIC_ORIGIN`: origem HTTPS exata da UI para validação Origin/CSRF
- `SERVICE_DESK_SUPABASE_URL`: URL HTTPS do Supabase dedicado ao Service Desk
- `SERVICE_DESK_SUPABASE_ANON_KEY`: chave pública usada com Supabase Auth
- `SERVICE_DESK_SUPABASE_SECRET_KEY`: chave privilegiada para consultas server-side
- `SERVICE_DESK_TENANT_SIGNING_KEY`: segredo de assinatura de empresa, ao menos 32 caracteres

Processo local: `node dist/src/authentication/start-session-server.js`.
Escuta `127.0.0.1`; é obrigatório um proxy HTTPS na **mesma origem** para
interface e `/api/**`, sem cache de respostas autenticadas. Não publicar
porta Node diretamente. Assets fora da whitelist permanecem indisponíveis.

Rotas:
- `GET /api/auth/csrf`
- `POST /api/auth/login`
- `POST /api/auth/select-tenant`
- `POST /api/auth/refresh` (rotação explícita, protegida por CSRF e tenant assinado)
- `GET /api/session`
- `POST /api/auth/logout`

As rotas mutantes validam Origin e CSRF. Login verifica identidade com
Supabase Auth e membership ativa com papéis reconhecidos; o cookie de
empresa é assinado e revalidado no backend. A UI não recebe chave privilegiada.

## Restrições e bloqueios antes de produção

1. **Renovação parcial**: a API de refresh exige CSRF, cookie de refresh HttpOnly,
   identidade Supabase e membership ativa; troca o refresh token retornado pelo provedor.
   A UI tenta renovar enquanto a página autenticada permanece aberta, a cada
   25 minutos; fechar ou suspender a aba além de uma hora pode exigir novo login.
   A seleção de empresa assinada expira em até uma hora; não assumir sessão
   persistente além desse período sem renovação efetivamente concluída.
2. **Logout remoto condicionado ao provedor**: chama o endpoint de logout local
   do Supabase e limpa cookies mesmo se o provedor falhar (HTTP 503 explícito).
   Mesmo após revogar refresh tokens, JWTs já emitidos permanecem válidos
   até expirar. É necessário validar esse comportamento em E2E real.
3. **Teste real pendente**: mocks de HTTP não equivalem a login autenticado
   na instância de destino; validar indisponibilidade, CSRF, expiração,
   múltiplas empresas e autorização em E2E real.
4. **Schema de segurança**: validar RLS e FKs com PostgreSQL descartável
   para a PR #5 e confirmar integração com REST após mudanças do schema.
5. **Preview não verificado**: falta domínio HTTPS, credenciais e QA de
   navegador no candidato SHA exato, com evidência durável.
6. **Produção requer gate humano**: não aplicar migrations nem efetuar
   merge que publique produção sem autorização específica.

A PR #3 e a PR #5 são Drafts independentes até reconciliação segura.
O Supabase da Factory não é banco de dados de produção do Service Desk.

## Seleção de empresa no login

O login não exige mais que o usuário conheça o UUID do tenant. Após verificar
as credenciais no Supabase e reler memberships ativas no servidor, o sistema
seleciona automaticamente o tenant somente se houver exatamente um. Havendo
múltiplos tenants válidos, responde HTTP 409 com nomes e IDs das empresas
**já autorizadas** e exige nova submissão da autenticação com seleção explícita.
A resposta 409 não emite cookies de acesso ou refresh. Os identificadores
não são aceitos como prova de autorização: memberships são revalidadas no
servidor na segunda submissão. Credenciais não são persistidas em storage
local. Isso ainda exige E2E autenticado em Preview para homologação.
