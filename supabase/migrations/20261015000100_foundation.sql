-- Shared foundation entities. Authorization and row-level security are introduced separately.
create extension if not exists pgcrypto;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint tenants_name_length check (char_length(name) between 2 and 120)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint organizations_name_length check (char_length(name) between 2 and 120),
  constraint organizations_tenant_slug_key unique (tenant_id, slug)
);

create index organizations_tenant_id_idx on public.organizations (tenant_id);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete set null,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_not_blank check (char_length(trim(email)) > 0),
  constraint users_tenant_email_key unique (tenant_id, email)
);

create index users_tenant_id_idx on public.users (tenant_id);
create index users_organization_id_idx on public.users (organization_id);

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_settings_object check (jsonb_typeof(settings) = 'object')
);
