-- EPRP Phase W2 — Major Activities Completed.
--
-- `docs/06_WEEKLY_REPORT_SPEC.md` §2 section 6. A separate table rather than
-- another `weekly_entries.entry_type`: that table's `category` and `priority`
-- are NOT NULL and meaningless for an activity, its status CHECK is
-- (open | in_progress | resolved | closed | escalated) which conflicts with the
-- activity lifecycle, and it has a single text column where an activity needs
-- both a title and separate remarks.
--
-- The project is reached through `weekly_reports.project_id` and is
-- deliberately not duplicated here (CLAUDE.md: do not duplicate project master
-- data in reports). Department and discipline use `on delete restrict` so a
-- referenced master record must be archived, never deleted.

create table public.weekly_activities (
  id                uuid primary key default gen_random_uuid(),
  weekly_report_id  uuid not null references public.weekly_reports(id) on delete cascade,
  title             text not null,
  department_id     uuid references public.departments(id) on delete restrict,
  discipline_id     uuid references public.disciplines(id) on delete restrict,
  owner_contact_id  uuid references public.contacts(id) on delete set null,
  status            text not null default 'not_started',
  progress_percent  integer,
  remarks           text,
  -- Authoring order for the numbered list; presentation only.
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint weekly_activities_title_not_blank
    check (length(btrim(title)) > 0),
  constraint weekly_activities_status_valid
    check (status in ('not_started', 'in_progress', 'completed')),
  constraint weekly_activities_progress_range
    check (progress_percent is null or progress_percent between 0 and 100)
);

create trigger set_updated_at before update on public.weekly_activities
  for each row execute function public.set_updated_at();

create index idx_weekly_activities_report_id
  on public.weekly_activities(weekly_report_id);
create index idx_weekly_activities_department_id
  on public.weekly_activities(department_id);
create index idx_weekly_activities_discipline_id
  on public.weekly_activities(discipline_id);
create index idx_weekly_activities_owner_contact_id
  on public.weekly_activities(owner_contact_id);
create index idx_weekly_activities_sort_order
  on public.weekly_activities(weekly_report_id, sort_order);

-- Same temporary development policy as every other table: authenticated users
-- have full access until login and role-based RLS land (spec §9).
alter table public.weekly_activities enable row level security;
create policy weekly_activities_authenticated_all on public.weekly_activities
  for all to authenticated using (true) with check (true);

comment on table public.weekly_activities is
  'Major activities completed in a reporting week (spec section 6).';
comment on column public.weekly_activities.progress_percent is
  'Whole percentage 0-100, or null when not tracked.';
comment on column public.weekly_activities.sort_order is
  'Authoring order within the report. Presentation only, not a priority.';
