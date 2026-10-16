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
- `GET /api/session`
- `POST /api/auth/logout`

As rotas mutantes validam Origin e CSRF. Login verifica identidade com
Supabase Auth e membership ativa com papéis reconhecidos; o cookie de
empresa é assinado e revalidado no backend. A UI não recebe chave privilegiada.

## Restrições e bloqueios antes de produção

1. **Refresh ausente**: o access token expira em até 1 hora; não assumir
   renovação silenciosa. Implementar refresh seguro com rotação e revogação.
2. **Logout remoto ausente**: apaga cookies locais, mas o token previamente
   obtido pode continuar válido no provedor até expirar. Não declarar
   revogação no Supabase.
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
