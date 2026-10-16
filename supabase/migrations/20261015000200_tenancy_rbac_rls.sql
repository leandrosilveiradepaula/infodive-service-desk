-- Tenant-scoped RBAC and RLS. Provisioning is performed by the server/service role;
-- authenticated users receive access only through memberships or explicit delegation.

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  resource text not null,
  action text not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint permissions_resource_not_blank check (char_length(trim(resource)) > 0),
  constraint permissions_action_not_blank check (char_length(trim(action)) > 0),
  constraint permissions_resource_action_key unique (resource, action)
);

create table public.role_templates (
  code text primary key,
  name text not null,
  description text not null,
  constraint role_templates_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

create table public.role_template_permissions (
  template_code text not null references public.role_templates(code) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (template_code, permission_id)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_code text references public.role_templates(code) on delete set null,
  code text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint roles_name_not_blank check (char_length(trim(name)) > 0),
  constraint roles_tenant_code_key unique (tenant_id, code)
);

create index roles_tenant_id_idx on public.roles (tenant_id);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_status check (status in ('active', 'suspended')),
  constraint memberships_tenant_user_role_key unique (tenant_id, user_id, role_id)
);

create index memberships_tenant_user_idx on public.memberships (tenant_id, user_id) where status = 'active';
create index memberships_user_id_idx on public.memberships (user_id) where status = 'active';

create table public.client_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_companies_name_length check (char_length(trim(name)) between 2 and 120),
  constraint client_companies_tenant_name_key unique (tenant_id, name)
);

create index client_companies_tenant_id_idx on public.client_companies (tenant_id);

-- An operational link must exist before platform staff can be granted delegated access.
create table public.operational_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_company_id uuid not null references public.client_companies(id) on delete cascade,
  platform_user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint operational_links_active_revocation check ((active and revoked_at is null) or (not active))
);

create index operational_links_active_lookup_idx
  on public.operational_links (tenant_id, client_company_id, platform_user_id)
  where active;

create table public.delegated_access_grants (
  id uuid primary key default gen_random_uuid(),
  operational_link_id uuid not null references public.operational_links(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_company_id uuid not null references public.client_companies(id) on delete cascade,
  platform_user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  justification text not null,
  enabled boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint delegated_access_justification_not_blank check (char_length(trim(justification)) >= 10),
  constraint delegated_access_expiry check (expires_at is null or expires_at > created_at)
);

create index delegated_access_active_lookup_idx
  on public.delegated_access_grants (tenant_id, client_company_id, platform_user_id)
  where enabled and revoked_at is null;

create table public.delegated_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  delegated_access_grant_id uuid not null references public.delegated_access_grants(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_company_id uuid not null references public.client_companies(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  resource text not null,
  action text not null,
  justification text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint delegated_access_audit_resource_not_blank check (char_length(trim(resource)) > 0),
  constraint delegated_access_audit_action_not_blank check (char_length(trim(action)) > 0),
  constraint delegated_access_audit_justification_not_blank check (char_length(trim(justification)) >= 10),
  constraint delegated_access_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index delegated_access_audit_tenant_occurred_idx
  on public.delegated_access_audit_log (tenant_id, occurred_at desc);

-- The six initial profiles are templates only. Effective access always comes from
-- permission assignments, so tenants may add or change roles without code changes.
insert into public.permissions (resource, action, description) values
  ('tenant', 'read', 'View tenant settings'),
  ('tenant', 'manage', 'Manage tenant settings'),
  ('organization', 'read', 'View organizations'),
  ('organization', 'manage', 'Manage organizations'),
  ('user', 'read', 'View users'),
  ('user', 'manage', 'Manage users'),
  ('membership', 'read', 'View memberships'),
  ('membership', 'manage', 'Manage memberships'),
  ('role', 'read', 'View roles and permissions'),
  ('role', 'manage', 'Manage roles and permissions'),
  ('client_company', 'read', 'View customer companies'),
  ('client_company', 'manage', 'Manage customer companies'),
  ('delegated_access', 'manage', 'Manage delegated platform access'),
  ('ticket', 'read', 'View tickets'),
  ('ticket', 'manage', 'Manage tickets')
on conflict (resource, action) do nothing;

insert into public.role_templates (code, name, description) values
  ('tenant_administrator', 'Tenant administrator', 'Full tenant administration'),
  ('service_manager', 'Service manager', 'Manages service operations'),
  ('service_agent', 'Service agent', 'Handles assigned service work'),
  ('requester', 'Requester', 'Creates and follows requests'),
  ('customer_administrator', 'Customer administrator', 'Administers a customer company'),
  ('customer_user', 'Customer user', 'Limited customer access')
on conflict (code) do nothing;

create or replace function public.is_active_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

create or replace function public.has_tenant_permission(target_tenant_id uuid, target_resource text, target_action text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.memberships membership
    join public.role_permissions role_permission on role_permission.role_id = membership.role_id
    join public.permissions permission on permission.id = role_permission.permission_id
    where membership.tenant_id = target_tenant_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and permission.resource = target_resource
      and permission.action = target_action
  );
$$;

create or replace function public.has_delegated_company_permission(
  target_tenant_id uuid,
  target_client_company_id uuid,
  target_resource text,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.delegated_access_grants grant_access
    join public.operational_links link on link.id = grant_access.operational_link_id
    join public.role_permissions role_permission on role_permission.role_id = grant_access.role_id
    join public.permissions permission on permission.id = role_permission.permission_id
    where grant_access.tenant_id = target_tenant_id
      and grant_access.client_company_id = target_client_company_id
      and grant_access.platform_user_id = auth.uid()
      and grant_access.enabled
      and grant_access.revoked_at is null
      and (grant_access.expires_at is null or grant_access.expires_at > now())
      and link.active
      and link.revoked_at is null
      and link.tenant_id = grant_access.tenant_id
      and link.client_company_id = grant_access.client_company_id
      and link.platform_user_id = grant_access.platform_user_id
      and permission.resource = target_resource
      and permission.action = target_action
  );
$$;

create or replace function public.validate_delegated_access_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  link_record public.operational_links;
  role_tenant_id uuid;
begin
  select * into link_record from public.operational_links where id = new.operational_link_id;
  select tenant_id into role_tenant_id from public.roles where id = new.role_id;

  if not found or not link_record.active or link_record.revoked_at is not null
    or link_record.tenant_id <> new.tenant_id
    or link_record.client_company_id <> new.client_company_id
    or link_record.platform_user_id <> new.platform_user_id
    or role_tenant_id is distinct from new.tenant_id then
    raise exception 'Delegated access grant must reference an active matching operational link and tenant role';
  end if;

  return new;
end;
$$;

create trigger delegated_access_grants_validate_link
before insert or update on public.delegated_access_grants
for each row execute function public.validate_delegated_access_grant();

revoke all on function public.is_active_tenant_member(uuid) from public;
revoke all on function public.has_tenant_permission(uuid, text, text) from public;
revoke all on function public.has_delegated_company_permission(uuid, uuid, text, text) from public;
grant execute on function public.is_active_tenant_member(uuid) to authenticated;
grant execute on function public.has_tenant_permission(uuid, text, text) to authenticated;
grant execute on function public.has_delegated_company_permission(uuid, uuid, text, text) to authenticated;

alter table public.tenants enable row level security;
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.permissions enable row level security;
alter table public.role_templates enable row level security;
alter table public.role_template_permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.memberships enable row level security;
alter table public.client_companies enable row level security;
alter table public.operational_links enable row level security;
alter table public.delegated_access_grants enable row level security;
alter table public.delegated_access_audit_log enable row level security;

create policy tenants_select_member on public.tenants for select
  using (public.is_active_tenant_member(id));
create policy tenants_update_manager on public.tenants for update
  using (public.has_tenant_permission(id, 'tenant', 'manage'))
  with check (public.has_tenant_permission(id, 'tenant', 'manage'));

create policy organizations_select_member on public.organizations for select
  using (public.is_active_tenant_member(tenant_id));
create policy organizations_manage on public.organizations for all
  using (public.has_tenant_permission(tenant_id, 'organization', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'organization', 'manage'));

create policy users_select_scoped on public.users for select
  using (id = auth.uid() or public.has_tenant_permission(tenant_id, 'user', 'read'));
create policy users_manage on public.users for all
  using (public.has_tenant_permission(tenant_id, 'user', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'user', 'manage'));

create policy tenant_settings_select_member on public.tenant_settings for select
  using (public.is_active_tenant_member(tenant_id));
create policy tenant_settings_manage on public.tenant_settings for all
  using (public.has_tenant_permission(tenant_id, 'tenant', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'tenant', 'manage'));

create policy permissions_select_authenticated on public.permissions for select to authenticated using (true);
create policy role_templates_select_authenticated on public.role_templates for select to authenticated using (true);
create policy role_template_permissions_select_authenticated on public.role_template_permissions for select to authenticated using (true);

create policy roles_select_member on public.roles for select
  using (public.is_active_tenant_member(tenant_id));
create policy roles_manage on public.roles for all
  using (public.has_tenant_permission(tenant_id, 'role', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'role', 'manage'));

create policy role_permissions_select_member on public.role_permissions for select
  using (exists (select 1 from public.roles role where role.id = role_id and public.is_active_tenant_member(role.tenant_id)));
create policy role_permissions_manage on public.role_permissions for all
  using (exists (select 1 from public.roles role where role.id = role_id and public.has_tenant_permission(role.tenant_id, 'role', 'manage')))
  with check (exists (select 1 from public.roles role where role.id = role_id and public.has_tenant_permission(role.tenant_id, 'role', 'manage')));

create policy memberships_select_scoped on public.memberships for select
  using (user_id = auth.uid() or public.has_tenant_permission(tenant_id, 'membership', 'read'));
create policy memberships_manage on public.memberships for all
  using (public.has_tenant_permission(tenant_id, 'membership', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'membership', 'manage'));

create policy client_companies_select_scoped on public.client_companies for select
  using (public.is_active_tenant_member(tenant_id) or public.has_delegated_company_permission(tenant_id, id, 'client_company', 'read'));
create policy client_companies_manage on public.client_companies for all
  using (public.has_tenant_permission(tenant_id, 'client_company', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'client_company', 'manage'));

create policy operational_links_manage on public.operational_links for all
  using (public.has_tenant_permission(tenant_id, 'delegated_access', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'delegated_access', 'manage'));

create policy delegated_access_grants_manage on public.delegated_access_grants for all
  using (public.has_tenant_permission(tenant_id, 'delegated_access', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'delegated_access', 'manage'));

create policy delegated_access_audit_select on public.delegated_access_audit_log for select
  using (public.has_tenant_permission(tenant_id, 'delegated_access', 'manage'));
create policy delegated_access_audit_insert on public.delegated_access_audit_log for insert
  with check (
    actor_user_id = auth.uid()
    and exists (
      select 1 from public.delegated_access_grants grant_access
      where grant_access.id = delegated_access_grant_id
        and grant_access.tenant_id = tenant_id
        and grant_access.client_company_id = client_company_id
        and grant_access.platform_user_id = actor_user_id
        and grant_access.enabled
        and grant_access.revoked_at is null
        and (grant_access.expires_at is null or grant_access.expires_at > now())
    )
  );
