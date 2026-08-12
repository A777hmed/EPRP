-- Repair the Monthly RLS policies left missing by the partial 20260812000001 run.
-- This migration changes no tables, Monthly data, Weekly data, or Weekly functions.
-- system_id remains Monthly context only; Weekly scope access accepts project, department,
-- and discipline.

drop policy if exists monthly_comments_insert on public.monthly_comments;
drop policy if exists monthly_comments_update on public.monthly_comments;
drop policy if exists monthly_comments_delete on public.monthly_comments;
drop policy if exists monthly_department_summaries_select on public.monthly_department_summaries;
drop policy if exists monthly_department_summaries_write on public.monthly_department_summaries;
drop policy if exists monthly_plan_items_select on public.monthly_plan_items;
drop policy if exists monthly_plan_items_write on public.monthly_plan_items;

create policy monthly_comments_insert on public.monthly_comments
  for insert to authenticated
  with check (
    public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id))
    or (
      department_id is not null
      and public.weekly_can_access_scope(
        public.monthly_report_project(monthly_report_id),
        department_id,
        discipline_id
      )
    )
  );

create policy monthly_comments_update on public.monthly_comments
  for update to authenticated
  using (
    public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id))
    or created_by_contact_id = public.current_contact_id()
  )
  with check (
    public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id))
    or (
      department_id is not null
      and public.weekly_can_access_scope(
        public.monthly_report_project(monthly_report_id),
        department_id,
        discipline_id
      )
    )
  );

create policy monthly_comments_delete on public.monthly_comments
  for delete to authenticated
  using (
    public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id))
    or created_by_contact_id = public.current_contact_id()
  );

create policy monthly_department_summaries_select on public.monthly_department_summaries
  for select to authenticated
  using (public.weekly_can_access_project(public.monthly_report_project(monthly_report_id)));

create policy monthly_department_summaries_write on public.monthly_department_summaries
  for all to authenticated
  using (
    public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id))
    or (
      department_id is not null
      and public.weekly_can_access_scope(
        public.monthly_report_project(monthly_report_id),
        department_id,
        discipline_id
      )
    )
  )
  with check (
    public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id))
    or (
      department_id is not null
      and public.weekly_can_access_scope(
        public.monthly_report_project(monthly_report_id),
        department_id,
        discipline_id
      )
    )
  );

create policy monthly_plan_items_select on public.monthly_plan_items
  for select to authenticated
  using (public.weekly_can_access_project(public.monthly_report_project(monthly_report_id)));

create policy monthly_plan_items_write on public.monthly_plan_items
  for all to authenticated
  using (public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id)))
  with check (public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id)));
