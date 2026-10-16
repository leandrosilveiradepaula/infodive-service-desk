-- Contract, SLA, and time accounting records are tenant-scoped and historical facts are append-only.
insert into public.permissions (resource, action, description) values
  ('contract', 'read', 'View customer contracts and SLA terms'),
  ('contract', 'manage', 'Manage customer contracts and SLA terms'),
  ('time_entry', 'read', 'View authorized time entries'),
  ('time_entry', 'manage', 'Record authorized time entries')
on conflict (resource, action) do nothing;

create table public.service_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_company_id uuid not null references public.client_companies(id) on delete restrict,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'America/Sao_Paulo',
  included_minutes integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_contracts_name check (char_length(trim(name)) between 2 and 160),
  constraint service_contracts_term check (ends_at is null or ends_at > starts_at),
  constraint service_contracts_minutes check (included_minutes is null or included_minutes >= 0)
);
create index service_contracts_tenant_company_idx on public.service_contracts (tenant_id, client_company_id, active);

create table public.contract_authorized_services (
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  service_id uuid not null references public.ticket_services(id) on delete restrict,
  active boolean not null default true,
  primary key (contract_id, service_id)
);

create table public.sla_calendars (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  timezone text not null,
  schedule jsonb not null,
  created_at timestamptz not null default now(),
  constraint sla_calendars_name check (char_length(trim(name)) between 2 and 120),
  constraint sla_calendars_schedule_object check (jsonb_typeof(schedule) = 'object'),
  constraint sla_calendars_tenant_name unique (tenant_id, name)
);

create table public.sla_calendar_holidays (
  calendar_id uuid not null references public.sla_calendars(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  primary key (calendar_id, holiday_date)
);

create table public.sla_rule_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  calendar_id uuid not null references public.sla_calendars(id) on delete restrict,
  version integer not null,
  priority text not null,
  first_response_minutes integer not null,
  update_minutes integer not null,
  resolution_minutes integer not null,
  active_from timestamptz not null default now(),
  active_to timestamptz,
  created_at timestamptz not null default now(),
  constraint sla_rule_versions_unique unique (contract_id, version, priority),
  constraint sla_rule_versions_priority check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint sla_rule_versions_minutes check (first_response_minutes >= 0 and update_minutes >= 0 and resolution_minutes >= 0),
  constraint sla_rule_versions_term check (active_to is null or active_to > active_from)
);
create index sla_rule_versions_contract_priority_idx on public.sla_rule_versions (contract_id, priority, active_from desc);

create table public.ticket_sla_targets (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete restrict,
  rule_version_id uuid not null references public.sla_rule_versions(id) on delete restrict,
  first_response_at timestamptz not null,
  update_at timestamptz not null,
  resolution_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.sla_pauses (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_version_id uuid not null references public.sla_rule_versions(id) on delete restrict,
  reason text not null,
  paused_at timestamptz not null,
  resumed_at timestamptz,
  impact_minutes integer,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  constraint sla_pauses_reason check (char_length(trim(reason)) > 0),
  constraint sla_pauses_term check (resumed_at is null or resumed_at >= paused_at),
  constraint sla_pauses_impact check (impact_minutes is null or impact_minutes >= 0)
);
create index sla_pauses_ticket_idx on public.sla_pauses (ticket_id, paused_at);

create table public.sla_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_version_id uuid not null references public.sla_rule_versions(id) on delete restrict,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint sla_events_type check (event_type in ('started', 'paused', 'resumed', 'breached', 'met', 'reopened')),
  constraint sla_events_key check (char_length(trim(idempotency_key)) > 0),
  constraint sla_events_payload check (jsonb_typeof(payload) = 'object'),
  constraint sla_events_idempotency unique (ticket_id, idempotency_key)
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid references public.service_contracts(id) on delete restrict,
  ticket_id uuid references public.tickets(id) on delete restrict,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  worked_at timestamptz not null,
  minutes integer not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint time_entries_minutes check (minutes > 0),
  constraint time_entries_description check (char_length(trim(description)) > 0)
);
create index time_entries_contract_worked_idx on public.time_entries (contract_id, worked_at);
create index time_entries_ticket_worked_idx on public.time_entries (ticket_id, worked_at);

create table public.contract_time_consumption (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete restrict,
  time_entry_id uuid not null unique references public.time_entries(id) on delete restrict,
  consumed_minutes integer not null,
  recorded_at timestamptz not null default now(),
  constraint contract_time_consumption_minutes check (consumed_minutes > 0)
);

create or replace function public.validate_contract_sla_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'service_contracts' and not exists (select 1 from public.client_companies where id = new.client_company_id and tenant_id = new.tenant_id) then
    raise exception 'Contract client company must belong to the contract tenant';
  end if;
  if tg_table_name = 'ticket_sla_targets' and not exists (select 1 from public.tickets where id = new.ticket_id and tenant_id = new.tenant_id) then
    raise exception 'SLA target ticket must belong to its tenant';
  end if;
  if tg_table_name in ('sla_pauses', 'sla_events') and not exists (select 1 from public.tickets where id = new.ticket_id and tenant_id = new.tenant_id) then
    raise exception 'SLA activity ticket must belong to its tenant';
  end if;
  if tg_table_name = 'time_entries' and new.ticket_id is not null and not exists (select 1 from public.tickets where id = new.ticket_id and tenant_id = new.tenant_id) then
    raise exception 'Time entry ticket must belong to its tenant';
  end if;
  if tg_table_name = 'time_entries' and new.contract_id is not null and not exists (select 1 from public.service_contracts where id = new.contract_id and tenant_id = new.tenant_id) then
    raise exception 'Time entry contract must belong to its tenant';
  end if;
  return new;
end;
$$;
create trigger service_contracts_validate_scope before insert or update on public.service_contracts for each row execute function public.validate_contract_sla_scope();
create trigger ticket_sla_targets_validate_scope before insert or update on public.ticket_sla_targets for each row execute function public.validate_contract_sla_scope();
create trigger sla_pauses_validate_scope before insert or update on public.sla_pauses for each row execute function public.validate_contract_sla_scope();
create trigger sla_events_validate_scope before insert or update on public.sla_events for each row execute function public.validate_contract_sla_scope();
create trigger time_entries_validate_scope before insert or update on public.time_entries for each row execute function public.validate_contract_sla_scope();

create or replace function public.prevent_contract_history_mutation()
returns trigger language plpgsql as $$ begin raise exception 'Contract SLA and time history is immutable'; end; $$;
create trigger sla_events_immutable before update or delete on public.sla_events for each row execute function public.prevent_contract_history_mutation();
create trigger time_entries_immutable before update or delete on public.time_entries for each row execute function public.prevent_contract_history_mutation();
create trigger contract_consumption_immutable before update or delete on public.contract_time_consumption for each row execute function public.prevent_contract_history_mutation();

alter table public.service_contracts enable row level security;
alter table public.contract_authorized_services enable row level security;
alter table public.sla_calendars enable row level security;
alter table public.sla_calendar_holidays enable row level security;
alter table public.sla_rule_versions enable row level security;
alter table public.ticket_sla_targets enable row level security;
alter table public.sla_pauses enable row level security;
alter table public.sla_events enable row level security;
alter table public.time_entries enable row level security;
alter table public.contract_time_consumption enable row level security;

create policy service_contracts_read on public.service_contracts for select using (public.has_tenant_permission(tenant_id, 'contract', 'read') or public.has_tenant_permission(tenant_id, 'contract', 'manage'));
create policy service_contracts_manage on public.service_contracts for all using (public.has_tenant_permission(tenant_id, 'contract', 'manage')) with check (public.has_tenant_permission(tenant_id, 'contract', 'manage'));
create policy contract_services_read on public.contract_authorized_services for select using (exists (select 1 from public.service_contracts c where c.id = contract_id and (public.has_tenant_permission(c.tenant_id, 'contract', 'read') or public.has_tenant_permission(c.tenant_id, 'contract', 'manage'))));
create policy contract_services_manage on public.contract_authorized_services for all using (exists (select 1 from public.service_contracts c where c.id = contract_id and public.has_tenant_permission(c.tenant_id, 'contract', 'manage'))) with check (exists (select 1 from public.service_contracts c where c.id = contract_id and public.has_tenant_permission(c.tenant_id, 'contract', 'manage')));
create policy sla_calendars_read on public.sla_calendars for select using (public.has_tenant_permission(tenant_id, 'contract', 'read') or public.has_tenant_permission(tenant_id, 'contract', 'manage'));
create policy sla_calendars_manage on public.sla_calendars for all using (public.has_tenant_permission(tenant_id, 'contract', 'manage')) with check (public.has_tenant_permission(tenant_id, 'contract', 'manage'));
create policy sla_holidays_read on public.sla_calendar_holidays for select using (exists (select 1 from public.sla_calendars c where c.id = calendar_id and public.is_active_tenant_member(c.tenant_id)));
create policy sla_holidays_manage on public.sla_calendar_holidays for all using (exists (select 1 from public.sla_calendars c where c.id = calendar_id and public.has_tenant_permission(c.tenant_id, 'contract', 'manage'))) with check (exists (select 1 from public.sla_calendars c where c.id = calendar_id and public.has_tenant_permission(c.tenant_id, 'contract', 'manage')));
create policy sla_rules_read on public.sla_rule_versions for select using (public.is_active_tenant_member(tenant_id));
create policy sla_rules_manage on public.sla_rule_versions for all using (public.has_tenant_permission(tenant_id, 'contract', 'manage')) with check (public.has_tenant_permission(tenant_id, 'contract', 'manage'));
create policy ticket_sla_targets_read on public.ticket_sla_targets for select using (public.can_read_ticket(ticket_id));
create policy ticket_sla_targets_manage on public.ticket_sla_targets for all using (public.can_manage_ticket(ticket_id)) with check (public.can_manage_ticket(ticket_id));
create policy sla_pauses_read on public.sla_pauses for select using (public.can_read_ticket(ticket_id));
create policy sla_pauses_manage on public.sla_pauses for all using (public.can_manage_ticket(ticket_id)) with check (public.can_manage_ticket(ticket_id));
create policy sla_events_read on public.sla_events for select using (public.can_read_ticket(ticket_id));
create policy sla_events_manage on public.sla_events for insert with check (public.can_manage_ticket(ticket_id));
create policy time_entries_read on public.time_entries for select using (public.has_tenant_permission(tenant_id, 'time_entry', 'read') or public.has_tenant_permission(tenant_id, 'time_entry', 'manage'));
create policy time_entries_manage on public.time_entries for insert with check (author_user_id = auth.uid() and public.has_tenant_permission(tenant_id, 'time_entry', 'manage'));
create policy contract_consumption_read on public.contract_time_consumption for select using (public.has_tenant_permission(tenant_id, 'contract', 'read') or public.has_tenant_permission(tenant_id, 'contract', 'manage'));
create policy contract_consumption_manage on public.contract_time_consumption for insert with check (public.has_tenant_permission(tenant_id, 'contract', 'manage'));
