-- Disposable two-tenant integration assertions. Never run on a live Supabase database.
create or replace function public.qa_reject(statement text, reason text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when foreign_key_violation or check_violation or raise_exception or insufficient_privilege then
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
declare
 visible_count integer;
 read_denied boolean := false;
begin
  -- Some policies intentionally deny access to their helper function
  -- before evaluating a tenant row. Both explicit denial and zero
  -- visible rows are safe; an unexpected SQL exception still fails.
  begin
    select count(*) into visible_count from public.tenants;
  exception when insufficient_privilege then
    read_denied := true;
  end;
  if not read_denied and visible_count <> 0 then
    raise exception 'Anonymous tenant leak: % rows', visible_count;
  end if;
  if has_function_privilege('anon','public.is_active_tenant_member(uuid)','EXECUTE') then
    raise exception 'Anonymous role can execute tenant membership helper';
  end if;
end $$;
reset role;

-- Next-domain FKs and triggers: a privileged write must never create a
-- cross-tenant association simply because RLS was bypassed.
insert into public.ticket_services(id,tenant_id,name) values
('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Service A'),
('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Service B');
insert into public.tickets(id,tenant_id,requester_user_id,client_company_id,subject) values
('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000001','Ticket A'),
('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000022','40000000-0000-4000-8000-000000000002','Ticket B');
select public.qa_reject($q$insert into public.ticket_relationships(tenant_id,source_ticket_id,target_ticket_id,relationship_type,created_by_user_id)
values ('10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','relates_to','10000000-0000-4000-8000-000000000011')$q$,'cross-tenant ticket relationship');

insert into public.knowledge_collections(id,tenant_id,name) values
('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Knowledge A'),
('70000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Knowledge B');
select public.qa_reject($q$insert into public.knowledge_categories(tenant_id,collection_id,name)
values ('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','Invalid category')$q$,'cross-tenant knowledge category');
insert into public.knowledge_articles(id,tenant_id,collection_id,author_user_id,updated_by_user_id,title,body)
values ('71000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011','Article A','Knowledge article for QA');
select public.qa_reject($q$insert into public.knowledge_ticket_articles(ticket_id,article_id,tenant_id,associated_by_user_id)
values ('60000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011')$q$,'knowledge link points to different tenant ticket');

insert into public.attachments(id,tenant_id,resource_type,resource_id,author_user_id,storage_path,original_file_name,content_type,byte_size)
values ('72000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ticket','60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000011','qa/invalid.txt','invalid.txt','text/plain',5);
select public.qa_reject($q$insert into public.ticket_attachments(ticket_id,attachment_id,tenant_id,attached_by_user_id)
values ('60000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011')$q$,'attachment resource ID not same ticket');

insert into public.service_contracts(id,tenant_id,client_company_id,name,starts_at) values
('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Contract A',now()),
('80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','Contract B',now());
select public.qa_reject($q$insert into public.contract_authorized_services(contract_id,service_id)
values ('80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002')$q$,'contract references other tenant service');
insert into public.sla_calendars(id,tenant_id,name,timezone,schedule) values
('81000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Calendar A','UTC','{}'::jsonb),
('81000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Calendar B','UTC','{}'::jsonb);
select public.qa_reject($q$insert into public.sla_rule_versions(tenant_id,contract_id,calendar_id,version,priority,first_response_minutes,update_minutes,resolution_minutes)
values ('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002',99,'normal',10,20,30)$q$,'SLA rule references other tenant calendar');
insert into public.sla_rule_versions(id,tenant_id,contract_id,calendar_id,version,priority,first_response_minutes,update_minutes,resolution_minutes)
values
('82000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',1,'normal',30,60,120),
('82000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002',1,'normal',30,60,120);
select public.qa_reject($q$insert into public.ticket_sla_targets(ticket_id,tenant_id,contract_id,rule_version_id,first_response_at,update_at,resolution_at)
values ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002',now(),now(),now())$q$,'SLA target references another tenant rule');
select public.qa_reject($q$insert into public.sla_events(ticket_id,tenant_id,rule_version_id,event_type,idempotency_key)
values ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','started','cross-tenant-event')$q$,'SLA event references another tenant rule');
insert into public.time_entries(id,tenant_id,contract_id,ticket_id,author_user_id,worked_at,minutes,description)
values ('83000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000022',now(),15,'QA time');
select public.qa_reject($q$insert into public.contract_time_consumption(tenant_id,contract_id,time_entry_id,consumed_minutes)
values ('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',15)$q$,'consumption references another tenant entry');

-- Validate policy behavior with real SELECT privileges (RLS, not missing GRANT).
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',false);
do $$
begin
 if (select count(*) from public.tickets where requester_user_id = auth.uid()) <> 1
    or (select count(*) from public.tickets where tenant_id = '10000000-0000-4000-8000-000000000002') <> 0 then
   raise exception 'Requester must see own ticket without cross-tenant data';
 end if;
end $$;
reset role;

-- Delegated audit events must be server-originated, not forged by an
-- authenticated actor merely holding the same grant ID.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',false);
select public.qa_reject($q$insert into public.delegated_access_audit_log
(delegated_access_grant_id,tenant_id,client_company_id,actor_user_id,resource,action,justification)
values ('10000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','ticket','read','Client-forged delegated audit event')$q$,'authenticated audit insert denied');
reset role;


-- Delegation: prove a VALID grant allows A but not B, client audit forgery
-- cannot use that valid FK, then revocation removes the authorized scope.
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000033');
insert into public.role_permissions(role_id,permission_id)
select '30000000-0000-4000-8000-000000000001',id from public.permissions
where (resource,action) in (('client_company','read'),('ticket','read'));
insert into public.operational_links(id,tenant_id,client_company_id,platform_user_id)
values ('90000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000001',
'40000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000033');
insert into public.delegated_access_grants
(id,operational_link_id,tenant_id,client_company_id,platform_user_id,role_id,justification)
values ('91000000-0000-4000-8000-000000000001',
'90000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000001',
'40000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000033',
'30000000-0000-4000-8000-000000000001',
'Explicit authorized QA platform access');
insert into public.delegated_access_audit_log
(delegated_access_grant_id,tenant_id,client_company_id,actor_user_id,resource,action,justification)
values ('91000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000001',
'40000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000033',
'ticket','read','Privileged authorized QA audit');

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000033',false);
do $$
begin
  if not public.has_delegated_company_permission(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'client_company','read') then
    raise exception 'Valid delegate is not authorized for A';
  end if;
  if public.has_delegated_company_permission(
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    'client_company','read') or (select count(*) from public.client_companies) <> 1 then
    raise exception 'Delegate can see more than company A';
  end if;
end $$;
select public.qa_reject($q$insert into public.delegated_access_audit_log
(delegated_access_grant_id,tenant_id,client_company_id,actor_user_id,resource,action,justification)
values ('91000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000001',
'40000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000033',
'ticket','read','Forged authenticated client audit')$q$,
'client cannot forge audit against a real grant');
reset role;
update public.delegated_access_grants set enabled=false,revoked_at=now()
where id='91000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000033',false);
do $$
begin
  if public.has_delegated_company_permission(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'client_company','read') or (select count(*) from public.client_companies) <> 0 then
    raise exception 'Revoked delegation still has access';
  end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000022',false);
do $$
begin
  if (select count(*) from public.tenants) <> 1
     or (select count(*) from public.client_companies) <> 1 then
    raise exception 'Tenant B row isolation incorrect';
  end if;
end $$;
reset role;
update public.memberships set status='suspended'
where user_id='10000000-0000-4000-8000-000000000011';
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',false);
do $$
begin
  if (select count(*) from public.tenants) <> 0
     or (select count(*) from public.client_companies) <> 0 then
    raise exception 'Suspended tenant A membership still has access';
  end if;
end $$;
reset role;

-- Integration contract for the auth adapter: the primary profile tenant is NOT
-- the only tenant a verified user may access. A suspended A membership must
-- not block a separately active B membership or grant access back to A.
insert into public.memberships(tenant_id,user_id,role_id) values
('10000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000011',
 '30000000-0000-4000-8000-000000000002');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',false);
do $$
begin
  if (select count(*) from public.tenants) <> 1
     or (select count(*) from public.tenants where slug='qa-b') <> 1
     or (select count(*) from public.client_companies where name='Company B') <> 1
     or (select count(*) from public.client_companies where name='Company A') <> 0 then
    raise exception 'Cross-tenant membership incorrectly follows primary profile or suspended A';
  end if;
end $$;
reset role;

-- PostgREST embeds in PR #3 explicitly select the original memberships role
-- FK because this schema also introduces an integrity-enforcing composite FK.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid='public.memberships'::regclass
                   and conname='memberships_role_id_fkey')
     or not exists (select 1 from pg_constraint
                    where conrelid='public.memberships'::regclass
                      and conname='memberships_role_tenant_fk') then
    raise exception 'Membership role relationship contract for PostgREST is missing';
  end if;
end $$;

-- Internal SECURITY DEFINER functions are never public/browser RPC endpoints.
do $$
declare routine text;
begin
 foreach routine in array array[
  'public.provision_data_governance_settings()',
  'public.validate_knowledge_collection_scope()',
  'public.snapshot_knowledge_article_version()',
  'public.validate_knowledge_ticket_article_scope()',
  'public.provision_ticket_statuses(uuid)',
  'public.provision_ticket_statuses_for_tenant()',
  'public.validate_ticket_scope()',
  'public.assign_ticket_protocol_and_validate_state()',
  'public.validate_ticket_status_transition()',
  'public.record_ticket_history()',
  'public.validate_ticket_child_scope()',
  'public.validate_ticket_relationship_scope()',
  'public.validate_ticket_attachment_scope()',
  'public.validate_contract_sla_scope()'
 ] loop
  if to_regprocedure(routine) is null then
   raise exception 'Missing privileged function %',routine;
  end if;
  if has_function_privilege('anon',routine,'EXECUTE')
     or has_function_privilege('authenticated',routine,'EXECUTE') then
   raise exception 'Unexpected browser EXECUTE on privileged function %',routine;
  end if;
 end loop;
end $$;

select 'TWO_TENANT_RLS_FK_PASS' as result;


-- Operational ticket contract: requester creates and reads their own B ticket
-- with a user JWT; an unrelated B member and tenant A must not see it.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000022', false);
insert into public.tickets(id,tenant_id,requester_user_id,subject,description,priority)
values ('60000000-0000-4000-8000-000000000099',
        '10000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000022',
        'REST operational create test', 'Ticket from requester', 'normal');
do $$
begin
  if (select count(*) from public.tickets where id = '60000000-0000-4000-8000-000000000099') <> 1 then
    raise exception 'Requester cannot read own ticket';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000011', false);
do $$
begin
  if (select count(*) from public.tickets where id = '60000000-0000-4000-8000-000000000099') <> 0 then
    raise exception 'Unrelated B membership can read another requester ticket without ticket read permission';
  end if;
end $$;
reset role;
select 'REQUESTER_TICKET_CREATE_READ_ISOLATION_PASS' as result;
