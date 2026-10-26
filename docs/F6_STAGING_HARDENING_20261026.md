# F6: endurecimento de banco homologado e pendência de Preview

## Estado verificado em 26/10/2026

A instância Supabase **somente de homologação** `jbswryivihaxcrhnzkpl` contém as seis migrations originais do Service Desk e uma migration de hardening, aplicada exclusivamente ao staging. Nenhum dado do CRM foi copiado.

A sétima migration, versionada neste PR, corresponde à correção do staging `f6_preview_defensive_rls_and_routine_permissions` (26/10/2026, 22:50 UTC). No banco real de homologação, a verificação indicou 49 tabelas públicas com RLS, zero tabelas sem RLS, zero funções `SECURITY DEFINER` executáveis por `anon`, e contadores de protocolo sem acesso direto de `anon` ou escrita de `authenticated`.

**O staging já contém esta mudança**. Não reaplicar a mesma migração por efeito colateral só para registrar histórico. O arquivo existe para transportar o hardening à linhagem oficial e ser validado em CI/ambiente descartável antes de qualquer eventual produção.

## Preview F6

Vercel `infodive-service-desk`, target `Preview`, branch exata `factory/change-set-60dd6b73`:
- `SERVICE_DESK_SUPABASE_URL`: configurada; projeto isolado.
- `SERVICE_DESK_SUPABASE_ANON_KEY`: configurada; chave publishable.
- `SERVICE_DESK_TENANT_SIGNING_KEY`: configurada; segredo forte gerado no runtime e armazenado somente na Vercel.
- `SERVICE_DESK_SUPABASE_SECRET_KEY`: **pendente**, privada, exclusiva do mesmo projeto staging; sem valor na conversa, código ou issue.

A inexistência da última chave deve produzir `503 backend_unavailable`, e não autenticidade simulada. Não configurar valores em Production. O segredo pode ser definido apenas pelo operador diretamente no painel Vercel após obtê-lo no projeto Supabase **F6**; nunca reutilizar chave do CRM.

A CI local/Actions de Auth e PostgREST usa um banco descartável. O E2E hospedado exige dois usuários e tenants de teste autorizados, memberships/roles com isolamento RLS e credenciais custodiadas, mais deployment do candidato exato e teste via navegador.

## Linhagem e release

Este PR é dependente da PR [#10](https://github.com/leandrosilveiradepaula/infodive-service-desk/pull/10) e tem como *base* a branch F6, não `main`: isso evita publicar produção. Integrar o hardening somente após CI verde. Qualquer alteração no SHA da candidata exige novos checks e recibo de Preview correspondente; **não** atribuir os recibos do SHA `17edf217dceb0b75bf944e8e1737a0ba92bfb2fc` a um SHA posterior.

Não executar auto-merge de `main`. O Control Plane da Factory mantém a Change Set original; retomar pelo procedimento `docs/PREVIEW_BACKEND_RECOVERY.md` somente depois de Preflight e Browser E2E real. Se o histórico exigir um SHA fixo para recuperação, usar repin explícito suportado pelo runtime em vez de fingir que a branch não mudou.

Avisos residuais do Supabase incluem funções `SECURITY DEFINER` executáveis por `authenticated`, esperadas para o contrato RLS e ainda sujeitas a revisão antes de produção; tabelas sem policies intencionalmente negam acesso.

**Limites:** sem mudança em CRM, produção, credenciais privilegiadas, usuários reais, serviços pagos ou benchmark de modelo.
