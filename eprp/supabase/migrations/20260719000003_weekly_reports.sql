-- EPRP Phase 6A — Weekly reports workspace.
-- weekly_reports, weekly_submissions, weekly_comments — with the same
-- conventions as Phase 5C (UUID PKs, timestamps, active/archived, FKs,
-- indexes, updated_at triggers, RLS).

create table public.weekly_reports (
  id                      uuid primary key default gen_random_uuid(),
  report_number           text not null unique,
  project_id              uuid not null references public.projects(id) on delete restrict,
  status                  text not null default 'draft',
  source                  text not null default 'platform',
  week_number             integer not null,
  period_start            date not null,
  period_end              date not null,
  planned_progress        integer not null default 0,
  actual_progress         integer not null default 0,
  prepared_by_contact_id  uuid references public.contacts(id) on delete set null,
  reviewed_by_contact_id  uuid references public.contacts(id) on delete set null,
  approved_by_contact_id  uuid references public.contacts(id) on delete set null,
  active                  boolean not null default true,
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint weekly_reports_planned_range check (planned_progress between 0 and 100),
  constraint weekly_reports_actual_range check (actual_progress between 0 and 100),
  unique (project_id, period_start)
);

create table public.weekly_submissions (
  id                     uuid primary key default gen_random_uuid(),
  weekly_report_id       uuid not null references public.weekly_reports(id) on delete cascade,
  department_id          uuid not null references public.departments(id) on delete restrict,
  status                 text not null default 'pending',
  progress_delta         integer,
  summary                text,
  accomplishments        jsonb not null default '[]'::jsonb,
  planned_next_week      jsonb not null default '[]'::jsonb,
  blockers               jsonb not null default '[]'::jsonb,
  submitted_by_contact_id uuid references public.contacts(id) on delete set null,
  submitted_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (weekly_report_id, department_id)
);

create table public.weekly_comments (
  id                uuid primary key default gen_random_uuid(),
  weekly_report_id  uuid not null references public.weekly_reports(id) on delete cascade,
  department_id     uuid references public.departments(id) on delete set null,
  category          text not null,
  priority          text not null,
  text              text not null,
  important         boolean not null default false,
  author_contact_id uuid references public.contacts(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- updated_at triggers ------------------------------------------------------
create trigger set_updated_at before update on public.weekly_reports
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.weekly_submissions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.weekly_comments
  for each row execute function public.set_updated_at();

-- Indexes ------------------------------------------------------------------
create index idx_weekly_reports_project_id on public.weekly_reports(project_id);
create index idx_weekly_reports_status on public.weekly_reports(status);
create index idx_weekly_reports_period_start on public.weekly_reports(period_start);
create index idx_weekly_reports_active on public.weekly_reports(active) where active;
create index idx_weekly_submissions_report_id on public.weekly_submissions(weekly_report_id);
create index idx_weekly_submissions_department_id on public.weekly_submissions(department_id);
create index idx_weekly_comments_report_id on public.weekly_comments(weekly_report_id);

-- RLS ----------------------------------------------------------------------
alter table public.weekly_reports     enable row level security;
alter table public.weekly_submissions enable row level security;
alter table public.weekly_comments    enable row level security;

do $$
declare
  tbl text;
  tables text[] := array['weekly_reports', 'weekly_submissions', 'weekly_comments'];
begin
  foreach tbl in array tables loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      tbl || '_authenticated_all',
      tbl
    );
  end loop;
end;
$$;
