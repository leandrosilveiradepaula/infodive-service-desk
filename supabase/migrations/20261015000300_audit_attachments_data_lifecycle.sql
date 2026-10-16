-- Tenant-isolated audit, attachments, private storage, and data lifecycle controls.
-- Storage objects are never public; a server must authorize a download before issuing
-- a signed URL and uploads must first have an authorized pending attachment record.

insert into public.permissions (resource, action, description) values
  ('audit_log', 'read', 'View tenant audit records'),
  ('attachment', 'read', 'View and download attachments'),
  ('attachment', 'manage', 'Create and manage attachment metadata and uploads'),
  ('data_lifecycle', 'manage', 'Configure retention and record data lifecycle actions'),
  ('data_export', 'manage', 'Authorize tenant data exports')
on conflict (resource, action) do nothing;

create table public.attachment_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  allowed_content_types jsonb not null default '[
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp"
  ]'::jsonb,
  max_file_size_bytes bigint not null default 10485760,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attachment_settings_allowed_types_array check (jsonb_typeof(allowed_content_types) = 'array'),
  constraint attachment_settings_max_size_conservative check (max_file_size_bytes between 1 and 52428800)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  visibility text not null default 'tenant',
  storage_state text not null default 'pending',
  storage_path text not null unique,
  original_file_name text not null,
  content_type text not null,
  byte_size bigint not null,
  checksum_sha256 text,
  retained_until timestamptz,
  legal_hold boolean not null default false,
  discarded_at timestamptz,
  discarded_by_user_id uuid references auth.users(id) on delete restrict,
  anonymized_at timestamptz,
  anonymized_by_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attachments_resource_type_not_blank check (char_length(trim(resource_type)) > 0),
  constraint attachments_visibility check (visibility in ('tenant', 'restricted')),
  constraint attachments_storage_state check (storage_state in ('pending', 'available', 'quarantined', 'discarded')),
  constraint attachments_storage_path_not_blank check (char_length(trim(storage_path)) > 0),
  constraint attachments_file_name_not_blank check (char_length(trim(original_file_name)) > 0),
  constraint attachments_file_name_safe check (original_file_name !~ '[\\/\u0000]'),
  constraint attachments_content_type_not_blank check (char_length(trim(content_type)) > 0),
  constraint attachments_byte_size_positive check (byte_size between 1 and 52428800),
  constraint attachments_checksum_sha256_format check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  constraint attachments_discard_audit check (
    (discarded_at is null and discarded_by_user_id is null)
    or (discarded_at is not null and discarded_by_user_id is not null)
  ),
  constraint attachments_anonymize_audit check (
    (anonymized_at is null and anonymized_by_user_id is null)
    or (anonymized_at is not null and anonymized_by_user_id is not null)
  )
);

create index attachments_tenant_resource_idx on public.attachments (tenant_id, resource_type, resource_id);
create index attachments_tenant_state_idx on public.attachments (tenant_id, storage_state);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  resource_type text not null,
  resource_id uuid not null,
  action text not null,
  origin text not null,
  correlation_id uuid not null,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_log_resource_type_not_blank check (char_length(trim(resource_type)) > 0),
  constraint audit_log_action_not_blank check (char_length(trim(action)) > 0),
  constraint audit_log_origin_not_blank check (char_length(trim(origin)) > 0),
  constraint audit_log_changes_object check (jsonb_typeof(changes) = 'object'),
  constraint audit_log_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index audit_log_tenant_occurred_idx on public.audit_log (tenant_id, occurred_at desc);
create index audit_log_tenant_correlation_idx on public.audit_log (tenant_id, correlation_id);
create index audit_log_tenant_resource_idx on public.audit_log (tenant_id, resource_type, resource_id, occurred_at desc);

create table public.data_lifecycle_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  default_retention_days integer not null default 365,
  export_requires_legal_approval boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_lifecycle_settings_retention_range check (default_retention_days between 1 and 3650)
);

create table public.data_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  event_type text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint data_lifecycle_events_resource_type_not_blank check (char_length(trim(resource_type)) > 0),
  constraint data_lifecycle_events_type check (event_type in (
    'retention_scheduled', 'retention_extended', 'discarded', 'anonymized',
    'export_requested', 'export_authorized', 'export_completed', 'export_rejected'
  )),
  constraint data_lifecycle_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index data_lifecycle_events_tenant_occurred_idx
  on public.data_lifecycle_events (tenant_id, occurred_at desc);

-- Provision conservative defaults for current and newly created tenants.
insert into public.attachment_settings (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

insert into public.data_lifecycle_settings (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

create or replace function public.provision_data_governance_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.attachment_settings (tenant_id) values (new.id)
  on conflict (tenant_id) do nothing;
  insert into public.data_lifecycle_settings (tenant_id) values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

create trigger tenants_provision_data_governance_settings
after insert on public.tenants
for each row execute function public.provision_data_governance_settings();

-- Audit records are append-only, including for privileged application connections.
create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit records are immutable';
end;
$$;

create trigger audit_log_immutable
before update or delete on public.audit_log
for each row execute function public.prevent_audit_log_mutation();

-- Use this RPC from authenticated request handling to ensure every event includes
-- its actor, origin, correlation identifier, and relevant change set.
create or replace function public.record_audit_event(
  target_tenant_id uuid,
  target_resource_type text,
  target_resource_id uuid,
  target_action text,
  request_origin text,
  request_correlation_id uuid,
  relevant_changes jsonb default '{}'::jsonb,
  event_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  event_id uuid;
begin
  if auth.uid() is null or not public.is_active_tenant_member(target_tenant_id) then
    raise exception 'An active tenant member is required to record an audit event' using errcode = '42501';
  end if;

  insert into public.audit_log (
    tenant_id, actor_user_id, resource_type, resource_id, action, origin,
    correlation_id, changes, metadata
  ) values (
    target_tenant_id, auth.uid(), target_resource_type, target_resource_id,
    target_action, request_origin, request_correlation_id,
    coalesce(relevant_changes, '{}'::jsonb), coalesce(event_metadata, '{}'::jsonb)
  ) returning id into event_id;

  return event_id;
end;
$$;

-- This authorization RPC must be called by the server immediately before it
-- creates a short-lived signed URL. It records the authorization, not the URL.
create or replace function public.authorize_attachment_download(
  target_attachment_id uuid,
  request_origin text,
  request_correlation_id uuid
)
returns table (storage_path text, content_type text, original_file_name text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  attachment_record public.attachments;
begin
  select * into attachment_record
  from public.attachments
  where id = target_attachment_id;

  if not found
    or attachment_record.storage_state <> 'available'
    or not public.has_tenant_permission(attachment_record.tenant_id, 'attachment', 'read') then
    raise exception 'Attachment access is not authorized' using errcode = '42501';
  end if;

  perform public.record_audit_event(
    attachment_record.tenant_id,
    'attachment',
    attachment_record.id,
    'attachment.download_authorized',
    request_origin,
    request_correlation_id,
    '{}'::jsonb,
    jsonb_build_object('resource_type', attachment_record.resource_type, 'resource_id', attachment_record.resource_id)
  );

  return query select attachment_record.storage_path, attachment_record.content_type, attachment_record.original_file_name;
end;
$$;

-- Called by storage RLS policies. A pending metadata record is required before
-- object persistence and the object metadata must match the tenant's allowlist.
create or replace function public.can_upload_attachment_object(
  object_bucket_id text,
  object_name text,
  object_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.attachments attachment
    join public.attachment_settings settings on settings.tenant_id = attachment.tenant_id
    where object_bucket_id = 'attachments'
      and attachment.storage_path = object_name
      and attachment.storage_state = 'pending'
      and public.has_tenant_permission(attachment.tenant_id, 'attachment', 'manage')
      and attachment.content_type = coalesce(object_metadata ->> 'mimetype', '')
      and attachment.content_type in (
        select jsonb_array_elements_text(settings.allowed_content_types)
      )
      and coalesce(object_metadata ->> 'size', '') ~ '^[0-9]+$'
      and (object_metadata ->> 'size')::bigint = attachment.byte_size
      and attachment.byte_size <= settings.max_file_size_bytes
  );
$$;

create or replace function public.can_access_attachment_object(
  object_bucket_id text,
  object_name text,
  required_action text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.attachments attachment
    where object_bucket_id = 'attachments'
      and attachment.storage_path = object_name
      and attachment.storage_state = 'available'
      and public.has_tenant_permission(attachment.tenant_id, 'attachment', required_action)
  );
$$;

revoke all on function public.record_audit_event(uuid, text, uuid, text, text, uuid, jsonb, jsonb) from public;
revoke all on function public.authorize_attachment_download(uuid, text, uuid) from public;
revoke all on function public.can_upload_attachment_object(text, text, jsonb) from public;
revoke all on function public.can_access_attachment_object(text, text, text) from public;
grant execute on function public.record_audit_event(uuid, text, uuid, text, text, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.authorize_attachment_download(uuid, text, uuid) to authenticated;

alter table public.attachment_settings enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_log enable row level security;
alter table public.data_lifecycle_settings enable row level security;
alter table public.data_lifecycle_events enable row level security;

create policy attachment_settings_select on public.attachment_settings for select
  using (public.is_active_tenant_member(tenant_id));
create policy attachment_settings_manage on public.attachment_settings for all
  using (public.has_tenant_permission(tenant_id, 'attachment', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'attachment', 'manage'));

create policy attachments_select on public.attachments for select
  using (public.has_tenant_permission(tenant_id, 'attachment', 'read'));
create policy attachments_insert on public.attachments for insert
  with check (
    author_user_id = auth.uid()
    and storage_state = 'pending'
    and public.has_tenant_permission(tenant_id, 'attachment', 'manage')
  );
create policy attachments_update on public.attachments for update
  using (public.has_tenant_permission(tenant_id, 'attachment', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'attachment', 'manage'));

create policy audit_log_select on public.audit_log for select
  using (public.has_tenant_permission(tenant_id, 'audit_log', 'read'));
create policy audit_log_insert on public.audit_log for insert
  with check (
    actor_user_id = auth.uid()
    and public.is_active_tenant_member(tenant_id)
  );

create policy data_lifecycle_settings_select on public.data_lifecycle_settings for select
  using (public.is_active_tenant_member(tenant_id));
create policy data_lifecycle_settings_manage on public.data_lifecycle_settings for all
  using (public.has_tenant_permission(tenant_id, 'data_lifecycle', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'data_lifecycle', 'manage'));

create policy data_lifecycle_events_select on public.data_lifecycle_events for select
  using (public.has_tenant_permission(tenant_id, 'data_lifecycle', 'manage'));
create policy data_lifecycle_events_insert on public.data_lifecycle_events for insert
  with check (
    actor_user_id = auth.uid()
    and (
      public.has_tenant_permission(tenant_id, 'data_lifecycle', 'manage')
      or (event_type in ('export_requested', 'export_authorized', 'export_completed', 'export_rejected')
          and public.has_tenant_permission(tenant_id, 'data_export', 'manage'))
    )
  );

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do update set public = false;

create policy attachment_storage_read on storage.objects for select to authenticated
  using (public.can_access_attachment_object(bucket_id, name, 'read'));
create policy attachment_storage_upload on storage.objects for insert to authenticated
  with check (public.can_upload_attachment_object(bucket_id, name, metadata));
create policy attachment_storage_delete on storage.objects for delete to authenticated
  using (public.can_access_attachment_object(bucket_id, name, 'manage'));
