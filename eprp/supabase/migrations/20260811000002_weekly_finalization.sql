-- EPRP Weekly finalization: explicit Weekly update taxonomy/authorship and
-- Project Control planning rows. Weekly-only; no existing RLS rule is widened.

alter table public.weekly_entries
  add column update_type text,
  add column created_by_contact_id uuid references public.contacts(id) on delete set null,
  add column updated_by_contact_id uuid references public.contacts(id) on delete set null;

update public.weekly_entries
set update_type = case
  when entry_type = 'risk' then 'risk'
  when entry_type = 'issue' then 'issue'
  when entry_type = 'action' then 'action_required'
  when category = 'progress' then 'progress_update'
  else 'general'
end
where update_type is null;

alter table public.weekly_entries
  alter column update_type set default 'general',
  alter column update_type set not null,
  add constraint weekly_entries_update_type_valid check (
    update_type in (
      'progress_update',
      'achievement',
      'delay_constraint',
      'risk',
      'issue',
      'action_required',
      'general'
    )
  );

create or replace function public.set_weekly_entry_authorship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare actor uuid;
begin
  actor := public.current_contact_id();
  if tg_op = 'INSERT' then
    new.created_by_contact_id := coalesce(new.created_by_contact_id, actor);
    new.updated_by_contact_id := coalesce(new.updated_by_contact_id, actor);
  else
    new.created_by_contact_id := old.created_by_contact_id;
    new.updated_by_contact_id := coalesce(actor, old.updated_by_contact_id);
  end if;
  return new;
end;
$$;

create trigger weekly_entries_authorship
  before insert or update on public.weekly_entries
  for each row execute function public.set_weekly_entry_authorship();

create index idx_weekly_entries_update_type
  on public.weekly_entries(update_type);
create index idx_weekly_entries_created_by
  on public.weekly_entries(created_by_contact_id);

comment on column public.weekly_entries.update_type is
  'User-facing Weekly Update Type. entry_type/category remain compatibility and roll-up fields.';
comment on column public.weekly_entries.created_by_contact_id is
  'Original author, set from the authenticated profile and preserved on every edit.';
comment on column public.weekly_entries.updated_by_contact_id is
  'Most recent editor, set from the authenticated profile.';

create table public.weekly_plan_items (
  id uuid primary key default gen_random_uuid(),
  weekly_report_id uuid not null references public.weekly_reports(id) on delete cascade,
  kind text not null,
  title text not null,
  start_date date,
  end_date date not null,
  owner_contact_id uuid references public.contacts(id) on delete set null,
  department_id uuid references public.departments(id) on delete restrict,
  status text not null default 'not_started',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_plan_items_kind_valid
    check (kind in ('milestone', 'next_week')),
  constraint weekly_plan_items_title_not_blank
    check (length(btrim(title)) > 0),
  constraint weekly_plan_items_status_valid
    check (status in ('not_started', 'in_progress', 'completed', 'delayed')),
  constraint weekly_plan_items_date_order
    check (start_date is null or start_date <= end_date)
);

create trigger set_updated_at before update on public.weekly_plan_items
  for each row execute function public.set_updated_at();

create index idx_weekly_plan_items_report
  on public.weekly_plan_items(weekly_report_id, kind, sort_order);
create index idx_weekly_plan_items_due
  on public.weekly_plan_items(end_date);

alter table public.weekly_plan_items enable row level security;

create or replace function public.weekly_can_manage_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_system_admin()
    or (
      public.current_contact_id() is not null
      and exists (
        select 1 from public.projects pr
         where pr.id = p_project
           and (pr.project_control_manager_id = public.current_contact_id()
             or pr.reporting_coordinator_id = public.current_contact_id())
      )
    );
$$;

create policy weekly_plan_items_select on public.weekly_plan_items
  for select to authenticated
  using (public.weekly_can_access_project(
    public.weekly_report_project(weekly_report_id)));

create policy weekly_plan_items_insert on public.weekly_plan_items
  for insert to authenticated
  with check (public.weekly_can_manage_project(
    public.weekly_report_project(weekly_report_id)));

create policy weekly_plan_items_update on public.weekly_plan_items
  for update to authenticated
  using (public.weekly_can_manage_project(
    public.weekly_report_project(weekly_report_id)))
  with check (public.weekly_can_manage_project(
    public.weekly_report_project(weekly_report_id)));

create policy weekly_plan_items_delete on public.weekly_plan_items
  for delete to authenticated
  using (public.weekly_can_manage_project(
    public.weekly_report_project(weekly_report_id)));

comment on table public.weekly_plan_items is
  'Weekly Project Control baselines: look-ahead milestones and next-week plan rows.';
