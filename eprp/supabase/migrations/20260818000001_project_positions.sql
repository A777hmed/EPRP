-- EPRP — additive "Additional Project Roles / Positions" foundation.
--
-- The five fixed responsibility roles (Project Manager, Project Control
-- Manager, Client Representative, Reporting Coordinator, Project Sponsor)
-- stay exactly where they are, as columns on public.projects. This table adds
-- the OPEN-ENDED positions beside them — Client Project Manager, Site Manager,
-- Deputy/Delegate Manager, Engineering Manager and whatever else a project
-- needs — without touching those columns or any existing row.
--
-- The position itself is a public.job_titles record, so the list stays
-- admin-managed rather than hardcoded, and the person is a public.contacts
-- record, so no Person is copied or duplicated onto the project.

create table public.project_positions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_title_id uuid not null references public.job_titles(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_positions_sort_order_nonnegative check (sort_order >= 0)
);

comment on table public.project_positions is
  'Additional, admin-configurable project positions beyond the five fixed responsibility roles on public.projects. Position comes from job_titles; the person comes from contacts. Neither master record is copied.';

-- The same person may hold two different positions on one project, and the
-- same position may be held by two people (e.g. two Site Managers). Only the
-- exact same person in the exact same position twice is meaningless.
create unique index project_positions_unique_assignment
  on public.project_positions(project_id, job_title_id, contact_id);

create index project_positions_project_sort
  on public.project_positions(project_id, sort_order);

create index project_positions_contact
  on public.project_positions(contact_id);

create trigger set_updated_at
  before update on public.project_positions
  for each row execute function public.set_updated_at();

alter table public.project_positions enable row level security;

create policy project_positions_select on public.project_positions
  for select to authenticated
  using (public.weekly_can_access_project(project_id));

create policy project_positions_insert on public.project_positions
  for insert to authenticated
  with check (public.weekly_can_manage_project(project_id));

create policy project_positions_update on public.project_positions
  for update to authenticated
  using (public.weekly_can_manage_project(project_id))
  with check (public.weekly_can_manage_project(project_id));

create policy project_positions_delete on public.project_positions
  for delete to authenticated
  using (public.weekly_can_manage_project(project_id));
