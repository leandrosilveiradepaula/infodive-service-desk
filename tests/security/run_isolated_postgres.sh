#!/usr/bin/env bash
# Fail closed: only the fixed disposable container database is supported.
set -euo pipefail
if [[ "$ISOLATED_PG_ONLY" != "1" ||
      "$PGHOST" != "127.0.0.1" ||
      "$PGPORT" != "5432" ||
      "$PGDATABASE" != "service_desk_security_test" ||
      "$PGUSER" != "postgres" ||
      "$PGPASSWORD" != "disposable-qa-only-password" ]]; then
  echo "Refusing non-disposable PostgreSQL target" >&2
  exit 2
fi
command -v psql >/dev/null || { echo "psql client missing" >&2; exit 2; }
test "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l)" -eq 6 ||
  { echo "Migration set changed, refuse implicit migration expansion" >&2; exit 2; }
psql -X -w -v ON_ERROR_STOP=1 -f tests/security/postgres_bootstrap.sql >/dev/null
for script in \
  supabase/migrations/20261015000100_foundation.sql \
  supabase/migrations/20261015000200_tenancy_rbac_rls.sql \
  supabase/migrations/20261015000300_audit_attachments_data_lifecycle.sql \
  supabase/migrations/20261015000400_knowledge_base.sql \
  supabase/migrations/20261015000500_ticket_domain.sql \
  supabase/migrations/20261015000600_contracts_sla_domain.sql; do
  echo "MIGRATION_ISOLATED: $(basename "$script")"
  psql -X -w -v ON_ERROR_STOP=1 -f "$script" >/dev/null
done
psql -X -w -v ON_ERROR_STOP=1 -f tests/security/two_tenant_isolation.sql
echo "ISOLATED_POSTGRES_RLS_PASS=1"
# QA fixture has no display_name by design; add one for the REST adapter test.
psql -X -w -v ON_ERROR_STOP=1 -c \
  "update public.users set display_name='QA User A' where id='10000000-0000-4000-8000-000000000011'" >/dev/null
bash tests/security/run_postgrest_contract.sh
