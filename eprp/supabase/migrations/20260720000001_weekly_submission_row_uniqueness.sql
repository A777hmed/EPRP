-- EPRP Phase 6A.3 — allow one update per department/discipline pair.
-- The original table allowed only one row per department, which prevented a
-- department from reporting separate discipline updates.

alter table public.weekly_submissions
  drop constraint if exists weekly_submissions_weekly_report_id_department_id_key;

create unique index weekly_submissions_report_department_discipline_unique
  on public.weekly_submissions (
    weekly_report_id,
    department_id,
    coalesce(discipline_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

comment on index public.weekly_submissions_report_department_discipline_unique is
  'Prevents duplicate department/discipline rows while allowing multiple disciplines per department.';
