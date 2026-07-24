-- EPRP Phase 6A.3 — department update rows.
-- Extends weekly_submissions with the fields captured by the "Department
-- Updates" section: discipline link, cumulative progress, the narrative
-- summary fields, and the responsible person / target date.
--
-- The existing accomplishments / planned_next_week / blockers jsonb arrays
-- are retained for the detailed Phase 6B multi-entry form.

alter table public.weekly_submissions
  add column discipline_id uuid references public.disciplines(id) on delete set null,
  add column progress_percent integer,
  add column key_achievement text,
  add column delay_constraint text,
  add column next_week_plan text,
  add column responsible_contact_id uuid references public.contacts(id) on delete set null,
  add column target_date date;

alter table public.weekly_submissions
  add constraint weekly_submissions_progress_percent_range
    check (
      progress_percent is null
      or progress_percent between 0 and 100
    );

create index idx_weekly_submissions_discipline_id
  on public.weekly_submissions(discipline_id);
create index idx_weekly_submissions_responsible_contact_id
  on public.weekly_submissions(responsible_contact_id);

comment on column public.weekly_submissions.progress_percent is
  'Cumulative progress for this department in this reporting week (0-100).';
comment on column public.weekly_submissions.discipline_id is
  'Discipline within the department; expected to belong to department_id.';
