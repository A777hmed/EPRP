-- =============================================================================
-- Stamp WHEN a department submitted, and WHO submitted it.
--
-- WHAT WAS WRONG
--
-- `weekly_submissions.submitted_at` and `.submitted_by_contact_id` exist, are
-- read by the Weekly UI (Distribution & Follow-up's "Last Activity" column,
-- `SubmissionStatusList`'s "Submitted <date> · <person>") — and nothing ever
-- wrote them. The only writers in the tree were the mock fixtures. A department
-- that had genuinely submitted therefore read as
--
--     Status: Submitted     Submitted at: —     By: (nobody)
--
-- and Distribution fell back to showing the time the request was SENT as the
-- department's last activity, which is the one timestamp that is certainly not
-- a response.
--
-- WHY A TRIGGER
--
-- Submission time is a fact about the row, not about the form that saved it.
-- Putting it in `saveDepartmentUpdate()` would leave every other write path —
-- import, a direct PostgREST call, a future bulk action — recording a status
-- with no author, which is exactly the split that produced the empty columns.
-- Here there is one writer and it cannot be skipped.
--
-- WHAT IT DOES, EXACTLY
--
--   entering  'submitted' ... stamp now() and the caller's contact, but only
--                             if the row was not already submitted, so a later
--                             edit to a submitted row does not silently
--                             re-date the submission.
--   leaving   'submitted' ... clear both, because a row returned to Pending or
--                             In Progress has not been submitted and must not
--                             keep saying it was. `returned` and `approved`
--                             are verdicts ON a submission and KEEP the stamp.
--
-- An explicit value supplied by the caller is respected — an import carrying
-- the real submission date is not overwritten by the moment of import.
--
-- No policy, grant, column or other table is touched.
-- =============================================================================

create or replace function public.stamp_weekly_submission_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_was_submitted boolean := (tg_op = 'UPDATE' and old.status = 'submitted');
begin
  if new.status = 'submitted' and not v_was_submitted then
    -- Only fill what the caller left empty.
    if new.submitted_at is null
       or (tg_op = 'UPDATE' and new.submitted_at is not distinct from old.submitted_at)
    then
      new.submitted_at := now();
    end if;
    if new.submitted_by_contact_id is null
       or (tg_op = 'UPDATE'
           and new.submitted_by_contact_id is not distinct from old.submitted_by_contact_id)
    then
      new.submitted_by_contact_id := public.current_contact_id();
    end if;
  elsif tg_op = 'UPDATE'
        and v_was_submitted
        and new.status in ('pending', 'in_progress')
  then
    new.submitted_at := null;
    new.submitted_by_contact_id := null;
  end if;

  return new;
end;
$fn$;

comment on function public.stamp_weekly_submission_submitted() is
  'Records when a weekly submission entered the submitted state and which contact did it, and clears both when the row is put back to pending or in_progress. An explicitly supplied value is left alone.';

revoke execute on function public.stamp_weekly_submission_submitted()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_stamp_weekly_submission_submitted
  on public.weekly_submissions;
create trigger trg_stamp_weekly_submission_submitted
  before insert or update of status on public.weekly_submissions
  for each row
  execute function public.stamp_weekly_submission_submitted();
