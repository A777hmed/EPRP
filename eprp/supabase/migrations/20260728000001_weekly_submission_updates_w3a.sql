-- EPRP Phase W3A — Department and Discipline Updates: data and capture.
--
-- `docs/06_WEEKLY_REPORT_SPEC.md` §2 section 7. The existing
-- `weekly_submissions` table already models department-owned rows with
-- multiple disciplines per department, so this migration only adds the
-- attributes it was missing. No new table.
--
-- `health_status` is the department's own verdict on the work (On Track /
-- At Risk / …) and is deliberately separate from `status`, which is the
-- submission lifecycle (Pending → Submitted → Returned → Accepted) from
-- `docs/03_WORKFLOW.md` §2. Conflating the two was the gap this phase closes.
--
-- All columns are additive and nullable: existing rows keep their data.
-- No RLS change — the table's existing policy covers every column.

alter table public.weekly_submissions
  add column if not exists health_status text,
  add column if not exists risks_issues text,
  add column if not exists return_reason text,
  add column if not exists reviewed_by_contact_id uuid
    references public.contacts(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

-- Department's verdict on its own work.
alter table public.weekly_submissions
  drop constraint if exists weekly_submissions_health_status_valid;
alter table public.weekly_submissions
  add constraint weekly_submissions_health_status_valid
    check (
      health_status is null
      or health_status in ('on_track', 'at_risk', 'delayed', 'blocked')
    );

-- Submission lifecycle. The column has carried these values since it was
-- created; this is the first time the database enforces them.
alter table public.weekly_submissions
  drop constraint if exists weekly_submissions_status_valid;
alter table public.weekly_submissions
  add constraint weekly_submissions_status_valid
    check (
      status in ('pending', 'in_progress', 'submitted', 'returned', 'approved')
    );

create index if not exists idx_weekly_submissions_health_status
  on public.weekly_submissions(health_status)
  where health_status is not null;
create index if not exists idx_weekly_submissions_reviewed_by
  on public.weekly_submissions(reviewed_by_contact_id)
  where reviewed_by_contact_id is not null;

comment on column public.weekly_submissions.health_status is
  'Department verdict on the work: on_track | at_risk | delayed | blocked. Distinct from status, which is the submission lifecycle.';
comment on column public.weekly_submissions.risks_issues is
  'Free-text risks / issues summary for this department-discipline row.';
comment on column public.weekly_submissions.return_reason is
  'Why Project Control returned the submission (docs/03_WORKFLOW.md section 3). Written by the review workflow in a later phase.';
comment on column public.weekly_submissions.reviewed_by_contact_id is
  'Who reviewed the submission. Populated by the review workflow in a later phase.';
comment on column public.weekly_submissions.reviewed_at is
  'When the submission was reviewed. Populated by the review workflow in a later phase.';
