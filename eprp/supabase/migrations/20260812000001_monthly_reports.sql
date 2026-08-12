-- EPRP Phase 9 — Monthly management-report consolidation.
-- Monthly rows snapshot selected Weekly entries without changing their source.

create table public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  report_number text not null unique,
  project_id uuid not null references public.projects(id) on delete restrict,
  reporting_month date not null,
  status text not null default 'draft',
  prepared_by_contact_id uuid references public.contacts(id) on delete set null,
  reviewed_by_contact_id uuid references public.contacts(id) on delete set null,
  approved_by_contact_id uuid references public.contacts(id) on delete set null,
  planned_progress numeric not null default 0,
  actual_progress numeric not null default 0,
  hse_status text,
  quality_status text,
  overall_progress_status text,
  executive_summary text,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_reports_month_start check (reporting_month = date_trunc('month', reporting_month)::date),
  constraint monthly_reports_project_month_unique unique (project_id, reporting_month)
);

create table public.monthly_comments (
  id uuid primary key default gen_random_uuid(),
  monthly_report_id uuid not null references public.monthly_reports(id) on delete cascade,
  source_weekly_entry_id uuid unique references public.weekly_entries(id) on delete set null,
  source_weekly_report_id uuid references public.weekly_reports(id) on delete set null,
  source_kind text not null default 'monthly_manual',
  week_number integer,
  department_id uuid references public.departments(id) on delete set null,
  system_id uuid references public.systems(id) on delete set null,
  discipline_id uuid references public.disciplines(id) on delete set null,
  update_type text not null default 'general',
  original_text text not null,
  presentation_text text,
  priority text not null default 'low',
  status text not null default 'open',
  responsible_contact_id uuid references public.contacts(id) on delete set null,
  target_date date,
  include_in_final boolean not null default true,
  escalate_to_management boolean not null default false,
  is_major_achievement boolean not null default false,
  created_by_contact_id uuid references public.contacts(id) on delete set null,
  updated_by_contact_id uuid references public.contacts(id) on delete set null,
  source_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_comments_source_kind check (source_kind in ('weekly', 'monthly_manual')),
  constraint monthly_comments_text_not_blank check (length(btrim(original_text)) > 0),
  constraint monthly_comments_update_type check (update_type in ('progress_update','achievement','challenge_constraint','risk_issue','decision_management_support','next_month_plan','action','general')),
  constraint monthly_comments_priority check (priority in ('low','medium','high','critical')),
  constraint monthly_comments_status check (status in ('open','in_progress','resolved','closed','escalated','pending'))
);

create table public.monthly_department_summaries (
  id uuid primary key default gen_random_uuid(),
  monthly_report_id uuid not null references public.monthly_reports(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  system_id uuid references public.systems(id) on delete set null,
  discipline_id uuid references public.disciplines(id) on delete set null,
  monthly_summary text,
  key_achievements text,
  challenges text,
  outstanding_actions text,
  next_month_plan text,
  created_by_contact_id uuid references public.contacts(id) on delete set null,
  updated_by_contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_department_summary_scope unique nulls not distinct (monthly_report_id, department_id, system_id, discipline_id)
);

create table public.monthly_plan_items (
  id uuid primary key default gen_random_uuid(),
  monthly_report_id uuid not null references public.monthly_reports(id) on delete cascade,
  title text not null,
  department_id uuid references public.departments(id) on delete set null,
  start_date date,
  target_date date,
  owner_contact_id uuid references public.contacts(id) on delete set null,
  status text not null default 'not_started',
  remarks text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_plan_items_title_not_blank check (length(btrim(title)) > 0),
  constraint monthly_plan_items_status check (status in ('not_started','in_progress','completed','delayed','pending')),
  constraint monthly_plan_items_date_order check (start_date is null or target_date is null or start_date <= target_date)
);

create trigger set_updated_at before update on public.monthly_reports for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.monthly_comments for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.monthly_department_summaries for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.monthly_plan_items for each row execute function public.set_updated_at();

create or replace function public.monthly_report_project(p_report uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.monthly_reports where id = p_report;
$$;

create or replace function public.monthly_can_manage_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or public.weekly_can_manage_project(p_project);
$$;

create or replace function public.set_monthly_comment_authorship()
returns trigger language plpgsql security definer set search_path = public as $$
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
create trigger monthly_comments_authorship before insert or update on public.monthly_comments for each row execute function public.set_monthly_comment_authorship();

create index idx_monthly_reports_project_month on public.monthly_reports(project_id, reporting_month desc);
create index idx_monthly_comments_report on public.monthly_comments(monthly_report_id, created_at);
create index idx_monthly_comments_weekly_source on public.monthly_comments(source_weekly_entry_id) where source_weekly_entry_id is not null;
create index idx_monthly_plan_items_report on public.monthly_plan_items(monthly_report_id, sort_order);

alter table public.monthly_reports enable row level security;
alter table public.monthly_comments enable row level security;
alter table public.monthly_department_summaries enable row level security;
alter table public.monthly_plan_items enable row level security;

create policy monthly_reports_select on public.monthly_reports for select to authenticated using (public.weekly_can_access_project(project_id));
create policy monthly_reports_insert on public.monthly_reports for insert to authenticated with check (public.monthly_can_manage_project(project_id));
create policy monthly_reports_update on public.monthly_reports for update to authenticated using (public.monthly_can_manage_project(project_id)) with check (public.monthly_can_manage_project(project_id));
create policy monthly_reports_delete on public.monthly_reports for delete to authenticated using (public.monthly_can_manage_project(project_id));

create policy monthly_comments_select on public.monthly_comments for select to authenticated using (public.weekly_can_access_project(public.monthly_report_project(monthly_report_id)));
create policy monthly_comments_insert on public.monthly_comments for insert to authenticated with check (
  public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id)) or
  (department_id is not null and public.weekly_can_access_scope(public.monthly_report_project(monthly_report_id), department_id, system_id, discipline_id))
);
create policy monthly_comments_update on public.monthly_comments for update to authenticated using (
  public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id)) or created_by_contact_id = public.current_contact_id()
) with check (
  public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id)) or
  (department_id is not null and public.weekly_can_access_scope(public.monthly_report_project(monthly_report_id), department_id, system_id, discipline_id))
);
create policy monthly_comments_delete on public.monthly_comments for delete to authenticated using (public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id)) or created_by_contact_id = public.current_contact_id());

create policy monthly_department_summaries_select on public.monthly_department_summaries for select to authenticated using (public.weekly_can_access_project(public.monthly_report_project(monthly_report_id)));
create policy monthly_department_summaries_write on public.monthly_department_summaries for all to authenticated using (public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id)) or public.weekly_can_access_scope(public.monthly_report_project(monthly_report_id), department_id, system_id, discipline_id)) with check (public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id)) or public.weekly_can_access_scope(public.monthly_report_project(monthly_report_id), department_id, system_id, discipline_id));

create policy monthly_plan_items_select on public.monthly_plan_items for select to authenticated using (public.weekly_can_access_project(public.monthly_report_project(monthly_report_id)));
create policy monthly_plan_items_write on public.monthly_plan_items for all to authenticated using (public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id))) with check (public.monthly_can_manage_project(public.monthly_report_project(monthly_report_id)));
