# Revisão de integridade multi-tenant — somente branch de QA

Esta revisão da migration inicial de RBAC corrige referências por ID que
permitiam vínculos lógicos entre tenants distintos e um erro no uso de FOUND
em validate_delegated_access_grant(). As constraints compostas ficam no próprio
DDL inicial, antes dos inserts e das funções de autorização.

## Proteções no candidato

- Organization, role, client company, operational link, delegated grant e
  audit log passam a preservar a igualdade de tenant nos relacionamentos.
- A relação entre grant e operational link também compara company e user.
- A auditoria de delegação referencia a mesma pessoa, company e tenant do grant.
- A remoção da organização zera apenas organization_id; tenant_id permanece.
- Trigger de validação não depende mais do FOUND de outro SELECT.
- EXECUTE herdado de PUBLIC para o trigger é revogado.

## Não validado / sem publicação

Testes de contrato textual não são testes de isolamento. É obrigatória
uma instância PostgreSQL/Supabase **isolada**, com duas contas/tenants, testes de
RLS, escrita e leitura cruzadas, revogação, expiração, deleção e concorrência.
As migrations de tickets/SLA e ondas 7/8 também devem receber revisão.
Não aplicar no Supabase da Factory nem no banco de produção do piloto.

A branch é isolada; a PR será Draft. O Actions do repositório privado não
aloca runner (issue #4), portanto o CI real ainda não foi executado.
O gate humano de merge e release de produção continua obrigatório.
