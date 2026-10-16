-- Disposable two-tenant integration assertions. Never run on a live Supabase database.
create or replace function public.qa_reject(statement text, reason text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when foreign_key_violation or check_violation or raise_exception then
    return;
  end;
  raise exception 'UNEXPECTED CROSS-TENANT ACCEPTANCE: %',reason;
end $$;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000011'),('10000000-0000-4000-8000-000000000022');
insert into public.tenants(id,slug,name) values
('10000000-0000-4000-8000-000000000001','qa-a','QA Tenant A'),
('10000000-0000-4000-8000-000000000002','qa-b','QA Tenant B');
insert into public.organizations(id,tenant_id,slug,name) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','org-a','Org A'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','org-b','Org B');
insert into public.users(id,tenant_id,organization_id,email) values
('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','a@qa.test'),
('10000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','b@qa.test');
insert into public.roles(id,tenant_id,code,name) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','qa_a','QA A'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','qa_b','QA B');
insert into public.memberships(tenant_id,user_id,role_id) values
('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000001'),
('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000002');
insert into public.client_companies(id,tenant_id,name) values
('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Company A'),
('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Company B');
select public.qa_reject($q$insert into public.memberships(tenant_id,user_id,role_id) values
('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000002')$q$,'membership role');
select public.qa_reject($q$update public.users set organization_id='20000000-0000-4000-8000-000000000002'
where id='10000000-0000-4000-8000-000000000011'$q$,'user organization');
select public.qa_reject($q$insert into public.operational_links(tenant_id,client_company_id,platform_user_id) values
('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000011')$q$,'operational company');
grant usage on schema public,auth to authenticated,anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage,select on all sequences in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',false);
do $$
begin
 if (select count(*) from public.tenants) <> 1 then raise exception 'Tenant A RLS leak'; end if;
 if (select count(*) from public.client_companies) <> 1 then raise exception 'Company RLS leak'; end if;
end $$;
reset role;
set role anon;
select set_config('request.jwt.claim.sub','',false);
do $$
begin
 if (select count(*) from public.tenants) <> 0 then raise exception 'Anonymous tenant leak'; end if;
end $$;
reset role;
select 'TWO_TENANT_RLS_FK_PASS' as result;
