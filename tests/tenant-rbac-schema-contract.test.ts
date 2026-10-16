import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/20261015000200_tenancy_rbac_rls.sql", import.meta.url)), "utf8");

test("cross-tenant role and company relationships use composite database constraints", () => {
  for (const key of [
    "users_org_tenant_fk", "memberships_role_tenant_fk", "memberships_org_tenant_fk",
    "client_companies_org_tenant_fk", "operational_links_company_tenant_fk",
    "delegated_access_link_scope_fk", "delegated_access_role_tenant_fk",
    "delegated_access_company_tenant_fk", "delegated_access_audit_scope_fk"
  ]) {
    assert.ok(sql.includes(key), `Missing composite constraint: ${key}`);
  }
  assert.match(sql, /foreign key \(role_id, tenant_id\) references public\.roles \(id, tenant_id\)/);
  assert.match(sql, /foreign key \(operational_link_id, tenant_id, client_company_id, platform_user_id\)/);
  assert.match(sql, /foreign key \(delegated_access_grant_id, tenant_id, client_company_id, actor_user_id\)/);
});

test("nullable organization references preserve tenant identifiers on deletes", () => {
  assert.equal((sql.match(/on delete set null \(organization_id\)/g) ?? []).length, 3);
});

test("delegated access validation tests the link itself and revokes public EXECUTE", () => {
  const fn = sql.split("create or replace function public.validate_delegated_access_grant()", 2)[1].split("$$;", 1)[0];
  assert.match(fn, /link_record\.id is null/);
  assert.doesNotMatch(fn, /if not found or/);
  assert.match(sql, /revoke all on function public\.validate_delegated_access_grant\(\) from public, anon, authenticated/);
});

test("tenant authorization remains bound to actual session and membership", () => {
  assert.match(sql, /membership\.tenant_id = target_tenant_id/);
  assert.match(sql, /membership\.user_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /raw_user_meta_data|user_metadata/i);
});


test("later domain migrations enforce the same tenant in linked records", () => {
  const knowledge = readFileSync(fileURLToPath(new URL("../../supabase/migrations/20261015000400_knowledge_base.sql", import.meta.url)), "utf8");
  assert.match(knowledge, /knowledge_categories_collection_tenant_fk/);
  assert.match(knowledge, /foreign key \(collection_id, tenant_id\)/);
  const tickets = readFileSync(fileURLToPath(new URL("../../supabase/migrations/20261015000500_ticket_domain.sql", import.meta.url)), "utf8");
  const sla = readFileSync(fileURLToPath(new URL("../../supabase/migrations/20261015000600_contracts_sla_domain.sql", import.meta.url)), "utf8");

  assert.match(knowledge, /ticket\.id = new\.ticket_id and ticket\.tenant_id = new\.tenant_id/);
  assert.match(tickets, /resource_id = new\.ticket_id/);
  for (const trigger of [
    "contract_services_validate_scope", "sla_rule_versions_validate_scope",
    "contract_time_consumption_validate_scope"
  ]) assert.ok(sla.includes(trigger), trigger);
  assert.match(sla, /rule\.contract_id = new\.contract_id/);
  assert.match(sla, /entry\.contract_id = new\.contract_id/);
  assert.match(sla, /rule\.id = new\.rule_version_id and rule\.tenant_id = new\.tenant_id/);
  assert.match(sla, /elsif tg_table_name = 'contract_authorized_services' then/);
  assert.match(sla, /revoke all on function public\.validate_contract_sla_scope\(\) from public, anon, authenticated/);
});

test("delegated audit events cannot be submitted through the authenticated Data API", () => {
  assert.doesNotMatch(sql, /create policy delegated_access_audit_insert/);
  assert.match(sql, /create policy delegated_access_audit_select/);
});
