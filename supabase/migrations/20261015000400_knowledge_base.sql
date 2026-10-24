-- Tenant-scoped knowledge base with immutable revision snapshots and visibility-aware access.

insert into public.permissions (resource, action, description) values
  ('knowledge_article', 'read', 'Read tenant-visible knowledge articles'),
  ('knowledge_article', 'manage', 'Create, review, publish, archive, and grant access to knowledge articles'),
  ('knowledge_article', 'attach_to_ticket', 'Associate authorized knowledge articles with tickets'),
  ('knowledge_article', 'rate', 'Rate authorized knowledge articles')
on conflict (resource, action) do nothing;

create table public.knowledge_collections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_collections_name_not_blank check (char_length(trim(name)) between 2 and 120),
  constraint knowledge_collections_tenant_name_key unique (tenant_id, name),
  constraint knowledge_collections_id_tenant_key unique (id, tenant_id)
);

create index knowledge_collections_tenant_id_idx on public.knowledge_collections (tenant_id);

create table public.knowledge_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  collection_id uuid not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_categories_name_not_blank check (char_length(trim(name)) between 2 and 120),
  constraint knowledge_categories_collection_name_key unique (collection_id, name),
  constraint knowledge_categories_collection_tenant_fk foreign key (collection_id, tenant_id)
    references public.knowledge_collections(id, tenant_id) on delete cascade
);

create index knowledge_categories_tenant_collection_idx on public.knowledge_categories (tenant_id, collection_id);

create table public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  collection_id uuid not null references public.knowledge_collections(id) on delete restrict,
  category_id uuid references public.knowledge_categories(id) on delete set null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  updated_by_user_id uuid not null references auth.users(id) on delete restrict,
  title text not null,
  summary text,
  body text not null,
  status text not null default 'draft',
  visibility text not null default 'tenant',
  revision_number integer not null default 1,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_articles_title_length check (char_length(trim(title)) between 3 and 240),
  constraint knowledge_articles_body_not_blank check (char_length(trim(body)) > 0),
  constraint knowledge_articles_status check (status in ('draft', 'in_review', 'published', 'archived')),
  constraint knowledge_articles_visibility check (visibility in ('public', 'tenant', 'private')),
  constraint knowledge_articles_revision_positive check (revision_number > 0),
  constraint knowledge_articles_archive_state check ((status = 'archived') = (archived_at is not null))
);

create index knowledge_articles_tenant_status_idx on public.knowledge_articles (tenant_id, status);
create index knowledge_articles_collection_category_idx on public.knowledge_articles (collection_id, category_id);
create index knowledge_articles_published_search_idx on public.knowledge_articles using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, ''))
);

create table public.knowledge_article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision_number integer not null,
  title text not null,
  summary text,
  body text not null,
  status text not null,
  visibility text not null,
  changed_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint knowledge_article_versions_revision_positive check (revision_number > 0),
  constraint knowledge_article_versions_status check (status in ('draft', 'in_review', 'published', 'archived')),
  constraint knowledge_article_versions_visibility check (visibility in ('public', 'tenant', 'private')),
  constraint knowledge_article_versions_article_revision_key unique (article_id, revision_number)
);

create index knowledge_article_versions_tenant_article_idx on public.knowledge_article_versions (tenant_id, article_id, revision_number desc);

create table public.knowledge_article_access_grants (
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (article_id, user_id)
);

create index knowledge_article_access_grants_user_idx on public.knowledge_article_access_grants (user_id, article_id);

create table public.knowledge_ticket_articles (
  ticket_id uuid not null,
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  associated_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (ticket_id, article_id)
);

create index knowledge_ticket_articles_tenant_ticket_idx on public.knowledge_ticket_articles (tenant_id, ticket_id);

create table public.knowledge_article_ratings (
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  useful boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (article_id, user_id)
);

create or replace function public.validate_knowledge_collection_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  collection_tenant_id uuid;
  category_record public.knowledge_categories;
begin
  select tenant_id into collection_tenant_id from public.knowledge_collections where id = new.collection_id;
  if collection_tenant_id is distinct from new.tenant_id then
    raise exception 'Knowledge collection must belong to the article tenant';
  end if;

  if new.category_id is not null then
    select * into category_record from public.knowledge_categories where id = new.category_id;
    if not found or category_record.tenant_id <> new.tenant_id or category_record.collection_id <> new.collection_id then
      raise exception 'Knowledge category must belong to the selected tenant collection';
    end if;
  end if;
  return new;
end;
$$;

create trigger knowledge_articles_validate_scope
before insert or update of tenant_id, collection_id, category_id on public.knowledge_articles
for each row execute function public.validate_knowledge_collection_scope();

create or replace function public.validate_knowledge_article_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status in ('in_review', 'archived'))
    or (old.status = 'in_review' and new.status in ('draft', 'published', 'archived'))
    or (old.status = 'published' and new.status in ('in_review', 'archived'))
    or (old.status = 'archived' and new.status = 'draft')
  ) then
    raise exception 'Invalid knowledge article editorial transition from % to %', old.status, new.status;
  end if;

  if old.status = 'published' and (new.title, new.summary, new.body, new.visibility) is distinct from (old.title, old.summary, old.body, old.visibility) then
    raise exception 'Published articles must return to review before their content or visibility changes';
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status = 'archived' then
    new.archived_at := now();
  else
    new.archived_at := null;
  end if;

  if (new.title, new.summary, new.body, new.status, new.visibility, new.collection_id, new.category_id) is distinct from
     (old.title, old.summary, old.body, old.status, old.visibility, old.collection_id, old.category_id) then
    new.revision_number := old.revision_number + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger knowledge_articles_validate_change
before update on public.knowledge_articles
for each row execute function public.validate_knowledge_article_change();

create or replace function public.snapshot_knowledge_article_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.knowledge_article_versions (
    article_id, tenant_id, revision_number, title, summary, body, status, visibility, changed_by_user_id
  ) values (
    new.id, new.tenant_id, new.revision_number, new.title, new.summary, new.body,
    new.status, new.visibility, new.updated_by_user_id
  );
  return new;
end;
$$;

create trigger knowledge_articles_snapshot_insert
after insert on public.knowledge_articles
for each row execute function public.snapshot_knowledge_article_version();

create trigger knowledge_articles_snapshot_update
after update of title, summary, body, status, visibility, collection_id, category_id on public.knowledge_articles
for each row when (new.revision_number <> old.revision_number)
execute function public.snapshot_knowledge_article_version();

create or replace function public.can_read_knowledge_article(target_article_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.knowledge_articles article
    where article.id = target_article_id
      and auth.uid() is not null
      and (
        article.author_user_id = auth.uid()
        or (
          article.status = 'published'
          and article.visibility = 'public'
        )
        or (
          article.status = 'published'
          and article.visibility = 'tenant'
          and public.is_active_tenant_member(article.tenant_id)
          and (
            public.has_tenant_permission(article.tenant_id, 'knowledge_article', 'read')
            or public.has_tenant_permission(article.tenant_id, 'knowledge_article', 'manage')
          )
        )
        or (
          article.visibility = 'private'
          and public.is_active_tenant_member(article.tenant_id)
          and (
            public.has_tenant_permission(article.tenant_id, 'knowledge_article', 'manage')
            or exists (
              select 1 from public.knowledge_article_access_grants grant_access
              where grant_access.article_id = article.id and grant_access.user_id = auth.uid()
            )
          )
        )
      )
  );
$$;

create or replace function public.validate_knowledge_ticket_article_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  article_tenant_id uuid;
begin
  select tenant_id into article_tenant_id from public.knowledge_articles where id = new.article_id;
  if article_tenant_id is distinct from new.tenant_id
     or not exists (select 1 from public.tickets ticket
                    where ticket.id = new.ticket_id and ticket.tenant_id = new.tenant_id) then
    raise exception 'Knowledge article and ticket association must have the same tenant';
  end if;
  return new;
end;
$$;

create trigger knowledge_ticket_articles_validate_scope
before insert or update on public.knowledge_ticket_articles
for each row execute function public.validate_knowledge_ticket_article_scope();

revoke all on function public.can_read_knowledge_article(uuid) from public;
grant execute on function public.can_read_knowledge_article(uuid) to authenticated;

alter table public.knowledge_collections enable row level security;
alter table public.knowledge_categories enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.knowledge_article_versions enable row level security;
alter table public.knowledge_article_access_grants enable row level security;
alter table public.knowledge_ticket_articles enable row level security;
alter table public.knowledge_article_ratings enable row level security;

create policy knowledge_collections_select on public.knowledge_collections for select
  using (public.is_active_tenant_member(tenant_id));
create policy knowledge_collections_manage on public.knowledge_collections for all
  using (public.has_tenant_permission(tenant_id, 'knowledge_article', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'knowledge_article', 'manage'));

create policy knowledge_categories_select on public.knowledge_categories for select
  using (public.is_active_tenant_member(tenant_id));
create policy knowledge_categories_manage on public.knowledge_categories for all
  using (public.has_tenant_permission(tenant_id, 'knowledge_article', 'manage'))
  with check (public.has_tenant_permission(tenant_id, 'knowledge_article', 'manage'));

create policy knowledge_articles_select_authorized on public.knowledge_articles for select
  using (public.can_read_knowledge_article(id));
create policy knowledge_articles_insert on public.knowledge_articles for insert
  with check (
    author_user_id = auth.uid()
    and updated_by_user_id = auth.uid()
    and public.has_tenant_permission(tenant_id, 'knowledge_article', 'manage')
  );
create policy knowledge_articles_update on public.knowledge_articles for update
  using (public.has_tenant_permission(tenant_id, 'knowledge_article', 'manage'))
  with check (
    updated_by_user_id = auth.uid()
    and public.has_tenant_permission(tenant_id, 'knowledge_article', 'manage')
  );
create policy knowledge_articles_delete on public.knowledge_articles for delete
  using (public.has_tenant_permission(tenant_id, 'knowledge_article', 'manage'));

create policy knowledge_article_versions_select on public.knowledge_article_versions for select
  using (public.can_read_knowledge_article(article_id));

create policy knowledge_article_access_grants_select on public.knowledge_article_access_grants for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.knowledge_articles article
      where article.id = article_id
        and public.has_tenant_permission(article.tenant_id, 'knowledge_article', 'manage')
    )
  );
create policy knowledge_article_access_grants_manage on public.knowledge_article_access_grants for all
  using (
    exists (
      select 1 from public.knowledge_articles article
      where article.id = article_id
        and public.has_tenant_permission(article.tenant_id, 'knowledge_article', 'manage')
    )
  )
  with check (
    granted_by_user_id = auth.uid()
    and exists (
      select 1 from public.knowledge_articles article
      where article.id = article_id
        and article.visibility = 'private'
        and public.has_tenant_permission(article.tenant_id, 'knowledge_article', 'manage')
    )
  );

create policy knowledge_ticket_articles_select on public.knowledge_ticket_articles for select
  using (
    public.can_read_knowledge_article(article_id)
    and public.has_tenant_permission(tenant_id, 'ticket', 'read')
  );
create policy knowledge_ticket_articles_insert on public.knowledge_ticket_articles for insert
  with check (
    associated_by_user_id = auth.uid()
    and public.can_read_knowledge_article(article_id)
    and public.has_tenant_permission(tenant_id, 'ticket', 'manage')
    and public.has_tenant_permission(tenant_id, 'knowledge_article', 'attach_to_ticket')
  );
create policy knowledge_ticket_articles_delete on public.knowledge_ticket_articles for delete
  using (
    public.has_tenant_permission(tenant_id, 'ticket', 'manage')
    and public.has_tenant_permission(tenant_id, 'knowledge_article', 'attach_to_ticket')
  );

create policy knowledge_article_ratings_select_own on public.knowledge_article_ratings for select
  using (user_id = auth.uid());
create policy knowledge_article_ratings_insert on public.knowledge_article_ratings for insert
  with check (
    user_id = auth.uid()
    and public.can_read_knowledge_article(article_id)
    and exists (
      select 1 from public.knowledge_articles article
      where article.id = article_id
        and (
          article.visibility = 'public'
          or public.has_tenant_permission(article.tenant_id, 'knowledge_article', 'rate')
          or public.has_tenant_permission(article.tenant_id, 'knowledge_article', 'read')
        )
    )
  );
create policy knowledge_article_ratings_update_own on public.knowledge_article_ratings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_read_knowledge_article(article_id));
create policy knowledge_article_ratings_delete_own on public.knowledge_article_ratings for delete
  using (user_id = auth.uid());

-- Privileged trigger/provisioning implementations are internal, not browser RPC.
revoke all on function public.validate_knowledge_collection_scope() from public, anon, authenticated;
revoke all on function public.snapshot_knowledge_article_version() from public, anon, authenticated;
revoke all on function public.validate_knowledge_ticket_article_scope() from public, anon, authenticated;
