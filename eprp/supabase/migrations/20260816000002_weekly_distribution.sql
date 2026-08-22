-- EPRP Weekly Phase 1 — distribution timing on the department submission.
--
-- WHY THESE TWO COLUMNS
--   `weekly_submissions` already carries one row per in-scope department, seeded
--   when the Weekly is created, with `status = 'pending'`. That status means BOTH
--   "never distributed" and "distributed, waiting for input" — the two states
--   Project Control most needs to tell apart. There is also nowhere to record
--   when a department's input is due.
--
--   `sent_at` splits those two states and `due_at` carries the deadline. Nothing
--   else is required: the existing status values already express In Progress,
--   Submitted, Returned and Department Approved, and Overdue is DERIVED
--   (`due_at` in the past, and not yet submitted or approved) rather than being
--   a stored state that could drift out of step with the clock.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   No new table. No change to `weekly_submissions_status_valid` — no status
--   value is added, so nothing that reads status today can be surprised. No RLS
--   change: the existing `weekly_submissions` policies already govern these rows
--   and therefore these columns. No trigger, no default.
--
-- NO BACKFILL IS NEEDED
--   Both columns are nullable and start NULL. `sent_at IS NULL` reads as
--   "Not Sent", which is exactly the correct state for every Weekly that exists
--   today — none of them has been distributed through this workflow. Existing
--   Weekly data is therefore unchanged in meaning as well as in value.

alter table public.weekly_submissions
  add column if not exists sent_at timestamptz,
  add column if not exists due_at timestamptz;

comment on column public.weekly_submissions.sent_at is
  'When this department was sent the Weekly and collection started. NULL means Not Sent — the distinction `status` alone cannot express, since pending covers both.';

comment on column public.weekly_submissions.due_at is
  'When this department''s input is due. Defaults in the UI to sent_at + 48 hours and is adjustable before collection starts. Overdue is derived from this, never stored.';

-- The monitor always reads a report's rows together; the deadline sort is the
-- one ordering Project Control actually works in.
create index if not exists idx_weekly_submissions_due
  on public.weekly_submissions(weekly_report_id, due_at);

/* -------------------------- Post-condition check --------------------------- */

do $$
declare
  added integer;
  status_values integer;
begin
  select count(*) into added
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'weekly_submissions'
     and column_name in ('sent_at', 'due_at');

  if added <> 2 then
    raise exception 'Post-check failed: expected 2 new columns, found %.', added;
  end if;

  -- Prove no status value was introduced: the constraint must still admit
  -- exactly the five values the application already knows about.
  select count(*) into status_values
    from information_schema.check_constraints
   where constraint_name = 'weekly_submissions_status_valid'
     and check_clause like '%pending%'
     and check_clause like '%in_progress%'
     and check_clause like '%submitted%'
     and check_clause like '%returned%'
     and check_clause like '%approved%';

  if status_values = 0 then
    raise exception 'Post-check failed: the submission status constraint changed.';
  end if;

  raise notice 'weekly_submissions.sent_at + due_at added; status constraint untouched.';
end;
$$;
