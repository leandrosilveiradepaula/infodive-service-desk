-- Tenant-scoped ticket domain. Protocols, state rules, and all associated records
-- are constrained to one tenant; RLS remains the authoritative access boundary.

insert into public.permissions (resource, action, description) values
  ('ticket', 'read', 'View authorized tickets and public ticket activity'),
  ('ticket', 'manage', 'Create and manage tickets and internal ticket activity')
on conflict (resource, action) do nothing;

create table public.ticket_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_forms_name_not_blank check (char_length(trim(name)) between 2 and 120),
  constraint ticket_forms_tenant_name_key unique (tenant_id, name)
);

create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_categories_name_not_blank check (char_length(trim(name)) between 2 and 120),
  constraint ticket_categories_tenant_name_key unique (tenant_id, name)
);

create table public.ticket_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_services_name_not_blank check (char_length(trim(name)) between 2 and 120),
  constraint ticket_services_tenant_name_key unique (tenant_id, name)
);

create table public.ticket_teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_teams_name_not_blank check (char_length(trim(name)) between 2 and 120),
  constraint ticket_teams_tenant_name_key unique (tenant_id, name)
);

create table public.ticket_status_definitions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  is_initial boolean not null default false,
  is_terminal boolean not null default false,
  display_order integer not null,
  primary key (tenant_id, code),
  constraint ticket_status_definitions_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint ticket_status_definitions_name_not_blank check (char_length(trim(name)) between 2 and 80),
  constraint ticket_status_definitions_order_positive check (display_order > 0)
);
create unique index ticket_status_definitions_one_initial_idx
  on public.ticket_status_definitions (tenant_id) where is_initial;

create table public.ticket_transition_rules (
  tenant_id uuid not null,
  from_status text not null,
  to_status text not null,
  enabled boolean not null default true,
  primary key (tenant_id, from_status, to_status),
  foreign key (tenant_id, from_status) references public.ticket_status_definitions (tenant_id, code) on delete cascade,
  foreign key (tenant_id, to_status) references public.ticket_status_definitions (tenant_id, code) on delete cascade,
  constraint ticket_transition_rules_distinct_statuses check (from_status <> to_status)
);

create table public.ticket_protocol_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_value bigint not null default 0,
  constraint ticket_protocol_counters_nonnegative check (last_value >= 0)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  protocol text not null default '',
  origin text not null default 'portal',
  requester_user_id uuid not null references auth.users(id) on delete restrict,
  client_company_id uuid references public.client_companies(id) on delete restrict,
  form_id uuid references public.ticket_forms(id) on delete set null,
  category_id uuid references public.ticket_categories(id) on delete set null,
  service_id uuid references public.ticket_services(id) on delete set null,
  priority text not null default 'normal',
  status text not null default 'new',
  team_id uuid references public.ticket_teams(id) on delete set null,
  assignee_user_id uuid references auth.users(id) on delete set null,
  subject text not null,
  description text,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_tenant_protocol_key unique (tenant_id, protocol),
  foreign key (tenant_id, status) references public.ticket_status_definitions (tenant_id, code) on delete restrict,
  constraint tickets_protocol_not_blank check (char_length(trim(protocol)) > 0),
  constraint tickets_origin_not_blank check (char_length(trim(origin)) between 2 and 80),
  constraint tickets_subject_length check (char_length(trim(subject)) between 3 and 240),
  constraint tickets_priority check (priority in ('low', 'normal', 'high', 'urgent'))
);
create index tickets_tenant_created_idx on public.tickets (tenant_id, created_at desc);
create index tickets_tenant_status_idx on public.tickets (tenant_id, status, updated_at desc);
create index tickets_tenant_company_idx on public.tickets (tenant_id, client_company_id, updated_at desc);
create index tickets_tenant_assignee_idx on public.tickets (tenant_id, assignee_user_id, updated_at desc);

create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  visibility text not null default 'public',
  created_at timestamptz not null default now(),
  constraint ticket_comments_body_not_blank check (char_length(trim(body)) > 0),
  constraint ticket_comments_visibility check (visibility in ('public', 'internal'))
);
create index ticket_comments_ticket_created_idx on public.ticket_comments (ticket_id, created_at);

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete restrict,
  event_type text not null,
  visibility text not null default 'public',
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint ticket_events_type_not_blank check (char_length(trim(event_type)) > 0),
  constraint ticket_events_visibility check (visibility in ('public', 'internal')),
  constraint ticket_events_payload_object check (jsonb_typeof(payload) = 'object')
);
create index ticket_events_ticket_occurred_idx on public.ticket_events (ticket_id, occurred_at);

create table public.ticket_transfers (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_team_id uuid references public.ticket_teams(id) on delete set null,
  to_team_id uuid references public.ticket_teams(id) on delete set null,
  from_assignee_user_id uuid references auth.users(id) on delete set null,
  to_assignee_user_id uuid references auth.users(id) on delete set null,
  transferred_by_user_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  constraint ticket_transfers_has_destination check (to_team_id is not null or to_assignee_user_id is not null)
);
create index ticket_transfers_ticket_created_idx on public.ticket_transfers (ticket_id, created_at);

create table public.ticket_relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_ticket_id uuid not null references public.tickets(id) on delete cascade,
  target_ticket_id uuid not null references public.tickets(id) on delete cascade,
  relationship_type text not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint ticket_relationships_distinct_tickets check (source_ticket_id <> target_ticket_id),
  constraint ticket_relationships_type check (relationship_type in ('relates_to', 'blocks', 'blocked_by', 'duplicates', 'duplicated_by', 'parent_of', 'child_of')),
  constraint ticket_relationships_unique_link unique (tenant_id, source_ticket_id, target_ticket_id, relationship_type)
);

create table public.ticket_attachments (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  attachment_id uuid not null unique references public.attachments(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visibility text not null default 'public',
  attached_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (ticket_id, attachment_id),
  constraint ticket_attachments_visibility check (visibility in ('public', 'internal'))
);

create or replace function public.provision_ticket_statuses(target_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ticket_status_definitions (tenant_id, code, name, is_initial, is_terminal, display_order)
  values
    (target_tenant_id, 'new', 'Novo', true, false, 1),
    (target_tenant_id, 'open', 'Aberto', false, false, 2),
    (target_tenant_id, 'in_progress', 'Em andamento', false, false, 3),
    (target_tenant_id, 'waiting_customer', 'Aguardando cliente', false, false, 4),
    (target_tenant_id, 'waiting_third_party', 'Aguardando terceiro', false, false, 5),
    (target_tenant_id, 'resolved', 'Resolvido', false, false, 6),
    (target_tenant_id, 'closed', 'Fechado', false, true, 7),
    (target_tenant_id, 'reopened', 'Reaberto', false, false, 8)
  on conflict (tenant_id, code) do nothing;

  insert into public.ticket_transition_rules (tenant_id, from_status, to_status)
  select target_tenant_id, transition_rule.from_status, transition_rule.to_status
  from (values
    ('new', 'open'), ('new', 'in_progress'), ('new', 'waiting_customer'), ('new', 'waiting_third_party'), ('new', 'resolved'), ('new', 'closed'),
    ('open', 'in_progress'), ('open', 'waiting_customer'), ('open', 'waiting_third_party'), ('open', 'resolved'), ('open', 'closed'),
    ('in_progress', 'open'), ('in_progress', 'waiting_customer'), ('in_progress', 'waiting_third_party'), ('in_progress', 'resolved'), ('in_progress', 'closed'),
    ('waiting_customer', 'open'), ('waiting_customer', 'in_progress'), ('waiting_customer', 'waiting_third_party'), ('waiting_customer', 'resolved'), ('waiting_customer', 'closed'),
    ('waiting_third_party', 'open'), ('waiting_third_party', 'in_progress'), ('waiting_third_party', 'waiting_customer'), ('waiting_third_party', 'resolved'), ('waiting_third_party', 'closed'),
    ('resolved', 'open'), ('resolved', 'in_progress'), ('resolved', 'closed'), ('resolved', 'reopened'),
    ('closed', 'reopened'),
    ('reopened', 'open'), ('reopened', 'in_progress'), ('reopened', 'waiting_customer'), ('reopened', 'waiting_third_party'), ('reopened', 'resolved'), ('reopened', 'closed')
  ) as transition_rule(from_status, to_status)
  on conflict (tenant_id, from_status, to_status) do nothing;
end;
$$;

select public.provision_ticket_statuses(id) from public.tenants;

create or replace function public.provision_ticket_statuses_for_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.provision_ticket_statuses(new.id);
  return new;
end;
$$;

create trigger tenants_provision_ticket_statuses
after insert on public.tenants
for each row execute function public.provision_ticket_statuses_for_tenant();

create or replace function public.validate_ticket_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.memberships where user_id = new.requester_user_id and tenant_id = new.tenant_id and status = 'active') then
    raise exception 'Ticket requester must have active membership in the ticket tenant';
  end if;
  if new.client_company_id is not null and not exists (select 1 from public.client_companies where id = new.client_company_id and tenant_id = new.tenant_id) then
    raise exception 'Ticket client company must belong to the ticket tenant';
  end if;
  if new.form_id is not null and not exists (select 1 from public.ticket_forms where id = new.form_id and tenant_id = new.tenant_id) then
    raise exception 'Ticket form must belong to the ticket tenant';
  end if;
  if new.category_id is not null and not exists (select 1 from public.ticket_categories where id = new.category_id and tenant_id = new.tenant_id) then
    raise exception 'Ticket category must belong to the ticket tenant';
  end if;
  if new.service_id is not null and not exists (select 1 from public.ticket_services where id = new.service_id and tenant_id = new.tenant_id) then
    raise exception 'Ticket service must belong to the ticket tenant';
  end if;
  if new.team_id is not null and not exists (select 1 from public.ticket_teams where id = new.team_id and tenant_id = new.tenant_id) then
    raise exception 'Ticket team must belong to the ticket tenant';
  end if;
  if new.assignee_user_id is not null and not exists (select 1 from public.memberships where user_id = new.assignee_user_id and tenant_id = new.tenant_id and status = 'active') then
    raise exception 'Ticket assignee must have active membership in the ticket tenant';
  end if;
  return new;
end;
$$;

create or replace function public.assign_ticket_protocol_and_validate_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sequence_value bigint;
begin
  if new.protocol = '' then
    insert into public.ticket_protocol_counters (tenant_id, last_value) values (new.tenant_id, 1)
    on conflict (tenant_id) do update set last_value = public.ticket_protocol_counters.last_value + 1
    returning last_value into sequence_value;
    new.protocol := 'T-' || lpad(sequence_value::text, 6, '0');
  end if;
  if not exists (select 1 from public.ticket_status_definitions where tenant_id = new.tenant_id and code = new.status and is_initial) then
    raise exception 'New tickets must use an initial tenant status';
  end if;
  return new;
end;
$$;

create or replace function public.validate_ticket_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> old.status and not exists (
    select 1 from public.ticket_transition_rules
    where tenant_id = old.tenant_id and from_status = old.status and to_status = new.status and enabled
  ) then
    raise exception 'Invalid ticket transition from % to %', old.status, new.status;
  end if;
  if new.status = 'resolved' and old.status <> 'resolved' then new.resolved_at := now(); end if;
  if new.status = 'closed' and old.status <> 'closed' then new.closed_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger tickets_validate_scope
before insert or update of tenant_id, requester_user_id, client_company_id, form_id, category_id, service_id, team_id, assignee_user_id on public.tickets
for each row execute function public.validate_ticket_scope();
create trigger tickets_assign_protocol
before insert on public.tickets
for each row execute function public.assign_ticket_protocol_and_validate_state();
create trigger tickets_validate_transition
before update on public.tickets
for each row execute function public.validate_ticket_status_transition();

create or replace function public.record_ticket_history()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, tenant_id, actor_user_id, event_type, payload)
    values (new.id, new.tenant_id, auth.uid(), 'ticket.created', jsonb_build_object('protocol', new.protocol, 'status', new.status));
  elsif new.status <> old.status then
    insert into public.ticket_events (ticket_id, tenant_id, actor_user_id, event_type, payload)
    values (new.id, new.tenant_id, auth.uid(), 'ticket.status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;
create trigger tickets_record_history_insert after insert on public.tickets for each row execute function public.record_ticket_history();
create trigger tickets_record_history_status after update of status on public.tickets for each row when (new.status <> old.status) execute function public.record_ticket_history();

create or replace function public.validate_ticket_child_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.tickets where id = new.ticket_id and tenant_id = new.tenant_id) then
    raise exception 'Ticket activity must belong to the ticket tenant';
  end if;
  return new;
end;
$$;
create trigger ticket_comments_validate_scope before insert or update on public.ticket_comments for each row execute function public.validate_ticket_child_scope();
create trigger ticket_events_validate_scope before insert or update on public.ticket_events for each row execute function public.validate_ticket_child_scope();
create trigger ticket_transfers_validate_scope before insert or update on public.ticket_transfers for each row execute function public.validate_ticket_child_scope();

create or replace function public.validate_ticket_relationship_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.tickets where id = new.source_ticket_id and tenant_id = new.tenant_id)
     or not exists (select 1 from public.tickets where id = new.target_ticket_id and tenant_id = new.tenant_id) then
    raise exception 'Related tickets must belong to the relationship tenant';
  end if;
  return new;
end;
$$;
create trigger ticket_relationships_validate_scope before insert or update on public.ticket_relationships for each row execute function public.validate_ticket_relationship_scope();

create or replace function public.validate_ticket_attachment_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.tickets where id = new.ticket_id and tenant_id = new.tenant_id)
     or not exists (select 1 from public.attachments where id = new.attachment_id and tenant_id = new.tenant_id
          and resource_type = 'ticket' and resource_id = new.ticket_id) then
    raise exception 'Ticket attachments must be ticket resources in the same tenant';
  end if;
  return new;
end;
$$;
create trigger ticket_attachments_validate_scope before insert or update on public.ticket_attachments for each row execute function public.validate_ticket_attachment_scope();

create or replace function public.prevent_ticket_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Ticket history is immutable';
end;
$$;
create trigger ticket_comments_immutable before update or delete on public.ticket_comments for each row execute function public.prevent_ticket_history_mutation();
create trigger ticket_events_immutable before update or delete on public.ticket_events for each row execute function public.prevent_ticket_history_mutation();
create trigger ticket_transfers_immutable before update or delete on public.ticket_transfers for each row execute function public.prevent_ticket_history_mutation();

create or replace function public.can_read_ticket(target_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.tickets ticket
    where ticket.id = target_ticket_id and (
      (ticket.requester_user_id = auth.uid() and public.is_active_tenant_member(ticket.tenant_id))
      or public.has_tenant_permission(ticket.tenant_id, 'ticket', 'read')
      or public.has_tenant_permission(ticket.tenant_id, 'ticket', 'manage')
      or (ticket.client_company_id is not null and public.has_delegated_company_permission(ticket.tenant_id, ticket.client_company_id, 'ticket', 'read'))
      or (ticket.client_company_id is not null and public.has_delegated_company_permission(ticket.tenant_id, ticket.client_company_id, 'ticket', 'manage'))
    )
  );
$$;
create or replace function public.can_manage_ticket(target_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.tickets ticket
    where ticket.id = target_ticket_id and (
      public.has_tenant_permission(ticket.tenant_id, 'ticket', 'manage')
      or (ticket.client_company_id is not null and public.has_delegated_company_permission(ticket.tenant_id, ticket.client_company_id, 'ticket', 'manage'))
    )
  );
$$;

revoke all on function public.can_read_ticket(uuid) from public;
revoke all on function public.can_manage_ticket(uuid) from public;
grant execute on function public.can_read_ticket(uuid) to authenticated;
grant execute on function public.can_manage_ticket(uuid) to authenticated;

alter table public.ticket_forms enable row level security;
alter table public.ticket_categories enable row level security;
alter table public.ticket_services enable row level security;
alter table public.ticket_teams enable row level security;
alter table public.ticket_status_definitions enable row level security;
alter table public.ticket_transition_rules enable row level security;
alter table public.tickets enable row level security;
-- The Data API needs table privileges in addition to RLS. Every row is still
-- checked by the owner/member policies below; anon has no ticket privileges.
revoke all on public.tickets from anon;
grant usage on schema public to authenticated;
grant select, insert on public.tickets to authenticated;
alter table public.ticket_comments enable row level security;
alter table public.ticket_events enable row level security;
alter table public.ticket_transfers enable row level security;
alter table public.ticket_relationships enable row level security;
alter table public.ticket_attachments enable row level security;

create policy ticket_forms_read on public.ticket_forms for select using (public.is_active_tenant_member(tenant_id));
create policy ticket_forms_manage on public.ticket_forms for all using (public.has_tenant_permission(tenant_id, 'ticket', 'manage')) with check (public.has_tenant_permission(tenant_id, 'ticket', 'manage'));
create policy ticket_categories_read on public.ticket_categories for select using (public.is_active_tenant_member(tenant_id));
create policy ticket_categories_manage on public.ticket_categories for all using (public.has_tenant_permission(tenant_id, 'ticket', 'manage')) with check (public.has_tenant_permission(tenant_id, 'ticket', 'manage'));
create policy ticket_services_read on public.ticket_services for select using (public.is_active_tenant_member(tenant_id));
create policy ticket_services_manage on public.ticket_services for all using (public.has_tenant_permission(tenant_id, 'ticket', 'manage')) with check (public.has_tenant_permission(tenant_id, 'ticket', 'manage'));
create policy ticket_teams_read on public.ticket_teams for select using (public.is_active_tenant_member(tenant_id));
create policy ticket_teams_manage on public.ticket_teams for all using (public.has_tenant_permission(tenant_id, 'ticket', 'manage')) with check (public.has_tenant_permission(tenant_id, 'ticket', 'manage'));
create policy ticket_statuses_read on public.ticket_status_definitions for select using (public.is_active_tenant_member(tenant_id));
create policy ticket_statuses_manage on public.ticket_status_definitions for all using (public.has_tenant_permission(tenant_id, 'ticket', 'manage')) with check (public.has_tenant_permission(tenant_id, 'ticket', 'manage'));
create policy ticket_transitions_read on public.ticket_transition_rules for select using (public.is_active_tenant_member(tenant_id));
create policy ticket_transitions_manage on public.ticket_transition_rules for all using (public.has_tenant_permission(tenant_id, 'ticket', 'manage')) with check (public.has_tenant_permission(tenant_id, 'ticket', 'manage'));

create policy tickets_read on public.tickets for select using (public.can_read_ticket(id));
create policy tickets_insert on public.tickets for insert to authenticated
  with check (requester_user_id = (select auth.uid()) and public.is_active_tenant_member(tenant_id));
create policy tickets_update on public.tickets for update using (public.can_manage_ticket(id)) with check (public.has_tenant_permission(tenant_id, 'ticket', 'manage'));
create policy ticket_comments_read on public.ticket_comments for select using (public.can_read_ticket(ticket_id) and (visibility = 'public' or public.can_manage_ticket(ticket_id)));
create policy ticket_comments_insert on public.ticket_comments for insert with check (author_user_id = auth.uid() and public.can_read_ticket(ticket_id) and (visibility = 'public' or public.can_manage_ticket(ticket_id)));
create policy ticket_events_read on public.ticket_events for select using (public.can_read_ticket(ticket_id) and (visibility = 'public' or public.can_manage_ticket(ticket_id)));
create policy ticket_events_insert on public.ticket_events for insert with check (actor_user_id = auth.uid() and public.can_manage_ticket(ticket_id));
create policy ticket_transfers_read on public.ticket_transfers for select using (public.can_manage_ticket(ticket_id));
create policy ticket_transfers_insert on public.ticket_transfers for insert with check (transferred_by_user_id = auth.uid() and public.can_manage_ticket(ticket_id));
create policy ticket_relationships_read on public.ticket_relationships for select using (public.can_read_ticket(source_ticket_id) and public.can_read_ticket(target_ticket_id));
create policy ticket_relationships_insert on public.ticket_relationships for insert with check (created_by_user_id = auth.uid() and public.can_manage_ticket(source_ticket_id) and public.can_manage_ticket(target_ticket_id));
create policy ticket_relationships_delete on public.ticket_relationships for delete using (public.can_manage_ticket(source_ticket_id) and public.can_manage_ticket(target_ticket_id));
create policy ticket_attachments_read on public.ticket_attachments for select using (public.can_read_ticket(ticket_id) and (visibility = 'public' or public.can_manage_ticket(ticket_id)));
create policy ticket_attachments_insert on public.ticket_attachments for insert with check (attached_by_user_id = auth.uid() and public.can_manage_ticket(ticket_id));
create policy ticket_attachments_delete on public.ticket_attachments for delete using (public.can_manage_ticket(ticket_id));

-- Privileged trigger/provisioning implementations are internal, not browser RPC.
revoke all on function public.provision_ticket_statuses(uuid) from public, anon, authenticated;
revoke all on function public.provision_ticket_statuses_for_tenant() from public, anon, authenticated;
revoke all on function public.validate_ticket_scope() from public, anon, authenticated;
revoke all on function public.assign_ticket_protocol_and_validate_state() from public, anon, authenticated;
revoke all on function public.validate_ticket_status_transition() from public, anon, authenticated;
revoke all on function public.record_ticket_history() from public, anon, authenticated;
revoke all on function public.validate_ticket_child_scope() from public, anon, authenticated;
revoke all on function public.validate_ticket_relationship_scope() from public, anon, authenticated;
revoke all on function public.validate_ticket_attachment_scope() from public, anon, authenticated;
