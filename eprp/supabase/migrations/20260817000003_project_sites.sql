-- EPRP P12 — additive Project Sites / Locations foundation.
-- Existing projects keep their legacy projects.site/city/country values.
-- One equivalent primary row is copied into this new table without updating
-- or deleting any existing Project record.

create table public.project_sites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  country text,
  city text,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_sites_name_not_blank check (length(btrim(name)) > 0),
  constraint project_sites_sort_order_nonnegative check (sort_order >= 0)
);

comment on table public.project_sites is
  'Named physical sites/locations owned by a Project. The primary row mirrors the legacy projects.site/city/country fields for backward compatibility.';

create unique index project_sites_one_primary_per_project
  on public.project_sites(project_id)
  where is_primary;

create index project_sites_project_sort
  on public.project_sites(project_id, sort_order, name);

create trigger set_updated_at
  before update on public.project_sites
  for each row execute function public.set_updated_at();

alter table public.project_sites enable row level security;

create policy project_sites_select on public.project_sites
  for select to authenticated
  using (public.weekly_can_access_project(project_id));

create policy project_sites_insert on public.project_sites
  for insert to authenticated
  with check (public.weekly_can_manage_project(project_id));

create policy project_sites_update on public.project_sites
  for update to authenticated
  using (public.weekly_can_manage_project(project_id))
  with check (public.weekly_can_manage_project(project_id));

create policy project_sites_delete on public.project_sites
  for delete to authenticated
  using (public.weekly_can_manage_project(project_id));

insert into public.project_sites (
  project_id,
  name,
  country,
  city,
  is_primary,
  sort_order
)
select
  id,
  btrim(site),
  country,
  city,
  true,
  0
from public.projects
where nullif(btrim(site), '') is not null;
