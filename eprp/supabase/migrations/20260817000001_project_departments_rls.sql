-- EPRP — scope Project Setup department links to the project managers.
-- The original Phase 5C rule was a temporary authenticated-wide CRUD policy.
-- This keeps RLS enabled and changes no data.

alter table public.project_departments enable row level security;

drop policy if exists project_departments_authenticated_all
  on public.project_departments;

create policy project_departments_select
  on public.project_departments
  for select to authenticated
  using (public.weekly_can_access_project(project_id));

create policy project_departments_insert
  on public.project_departments
  for insert to authenticated
  with check (public.weekly_can_manage_project(project_id));

create policy project_departments_update
  on public.project_departments
  for update to authenticated
  using (public.weekly_can_manage_project(project_id))
  with check (public.weekly_can_manage_project(project_id));

create policy project_departments_delete
  on public.project_departments
  for delete to authenticated
  using (public.weekly_can_manage_project(project_id));
