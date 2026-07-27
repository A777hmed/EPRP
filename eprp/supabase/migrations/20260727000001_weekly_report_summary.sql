-- EPRP Phase W1A — Executive Summary on the weekly report.
--
-- `docs/06_WEEKLY_REPORT_SPEC.md` §2 section 5 requires a report-level
-- Executive Summary narrative. `weekly_submissions.summary` already exists but
-- is the *department's* per-submission narrative — a different field with a
-- different owner — so the report needs its own column.
--
-- Additive and nullable: existing rows keep their data and simply have no
-- summary until one is written. No RLS change; the table's existing policy
-- covers every column.

alter table public.weekly_reports
  add column if not exists summary text;

comment on column public.weekly_reports.summary is
  'Report-level Executive Summary narrative (spec §2 section 5). Distinct from weekly_submissions.summary, which is a department''s own narrative.';
