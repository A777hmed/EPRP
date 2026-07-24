-- EPRP Phase 6A.1 — persist the managed discipline scope selected in the
-- weekly-report header. Existing records receive an empty scope and can be
-- completed through the edit form.

alter table public.weekly_reports
  add column discipline_ids uuid[] not null default '{}'::uuid[];

create index idx_weekly_reports_discipline_ids
  on public.weekly_reports using gin (discipline_ids);

comment on column public.weekly_reports.discipline_ids is
  'Managed discipline ids in scope for this weekly report.';
