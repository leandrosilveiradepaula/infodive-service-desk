import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(__dirname,
  "../../supabase/migrations/20261026225030_f6_preview_defensive_rls_and_routine_permissions.sql"), "utf8");

test("F6 hardening is transactional, fail-closed and non-destructive", () => {
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /SET LOCAL lock_timeout/);
  assert.match(sql, /SET LOCAL statement_timeout/);
  assert.doesNotMatch(sql, /\b(?:DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\.)\b/i);
});

test("ticket protocol counters are RLS-protected and not directly client-writable", () => {
  assert.match(sql, /ALTER TABLE public\.ticket_protocol_counters ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.ticket_protocol_counters FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /has_table_privilege\('authenticated','public\.ticket_protocol_counters','UPDATE'\)/);
});

test("anonymous role cannot invoke SECURITY DEFINER functions, with enforced postconditions", () => {
  assert.match(sql, /p\.prosecdef/);
  assert.match(sql, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon/);
  assert.match(sql, /has_function_privilege\('anon',p\.oid,'EXECUTE'\)/);
  assert.match(sql, /RAISE EXCEPTION 'Anonymous SECURITY DEFINER EXECUTE survived'/);
});

test("legacy immutable audit and ticket history triggers have pinned search_path", () => {
  for(const fn of ["prevent_audit_log_mutation", "prevent_ticket_history_mutation",
    "prevent_contract_history_mutation"]) {
    assert.ok(sql.includes(`ALTER FUNCTION public.${fn}()`));
  }
  assert.equal((sql.match(/SET search_path = pg_catalog, public, pg_temp/g)??[]).length,3);
});
