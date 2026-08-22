-- EPRP P0.3 — enforce Weekly / Monthly status transitions at the data boundary.
--
-- THE DEFECT
--   supabase-weekly-report-service.ts writes through the BROWSER client, and
--   weekly_reports_update is gated by weekly_can_access_project() -- any account
--   with any assignment on the project. The canTransition() and
--   checkWeeklyTransition() guards therefore live entirely in code the caller
--   controls. A direct PostgREST call:
--
--     PATCH /rest/v1/weekly_reports?id=eq.<id>   {"status":"finalized"}
--
--   moves a report to Finalized from a department account, with no reviewer, no
--   approver and no submissions -- exactly the impossible state
--   lifecycle-guards.ts was written to prevent. Approve and Finalize are not
--   boundaries today. Monthly's authority half is already correct
--   (monthly_can_manage_project), but its transition SHAPE is equally unguarded.
--
--   Architecture 9.3 / 24.5: a guard that exists only in client-side code is
--   pre-flight guidance, not enforcement.
--
-- HOW THIS ENFORCES — trigger + controlled function, not column grants
--   `revoke update (status)` does NOT work here: a table-level UPDATE grant
--   implies every column, and Supabase grants table-level UPDATE to
--   `authenticated`. Revoking one column would mean revoking the table grant and
--   re-granting every other column by name -- which silently breaks the moment
--   anyone adds a column.
--
--   Instead a BEFORE UPDATE trigger refuses any status change that did not come
--   through the controlled function. The function proves authority, validates
--   the transition, checks the stage conditions, then sets a transaction-local
--   token the trigger recognises. Robust to new columns, and it binds every
--   caller -- UI, script, or direct REST.
--
-- WHAT IS DELIBERATELY NOT CARRIED OVER
--   The TypeScript guard accepts an explicit AdminOverride (reason + actor +
--   timestamp) that bypasses the stage conditions. That is NOT implemented here.
--   There is no audit table yet, and an unaudited override is precisely the hole
--   that produced the historical Locked / no reviewer / no approver / 1-of-2
--   record. No UI path passes an override today, so nothing loses a capability.
--   When the audit trail lands, an override may be added -- with somewhere to
--   record it.
--
-- SCOPE
--   Two triggers, two controlled functions, three helpers. No table, column,
--   policy or row is changed. Existing rows keep their status untouched.

/* --------------------------- Lockout pre-check ---------------------------- */

do $pre$
declare admins integer;
begin
  select count(*) into admins from public.profiles
   where role = 'system_admin' and active;
  -- P1.0: the lockout risk this guard exists for requires accounts to lock
  -- out. On an empty profiles table there are none, so the check is skipped
  -- rather than failing a fresh environment. Protection is unchanged whenever
  -- any profile exists.
  if admins = 0 and exists (select 1 from public.profiles) then
    raise exception
      'Refusing to lock report lifecycle: no active system_admin profile exists.';
  end if;
  if not exists (select 1 from public.profiles) then
    raise notice 'Fresh environment: no profiles exist yet, so no account can be locked out. Lockout check not applicable.';
  end if;
  raise notice 'Lockout pre-check passed: % active system_admin profile(s).', admins;
end;
$pre$;

/* ---------------------------- Transition shape ---------------------------- */

-- Mirrors reportWorkflows in src/config/workflows.ts EXACTLY. These two are a
-- matched pair: change one and you must change the other, or the UI will offer
-- a transition the database refuses.
create or replace function public.report_transition_allowed(
  p_type text, p_from text, p_to text
)
returns boolean
language sql
immutable
as $fn$
  select exists (
    select 1
      from (values
        -- weekly
        ('weekly','draft','collecting'),
        ('weekly','draft','archived'),
        ('weekly','collecting','under_review'),
        ('weekly','under_review','approved'),
        ('weekly','under_review','returned'),
        ('weekly','under_review','rejected'),
        ('weekly','returned','collecting'),
        ('weekly','approved','finalized'),
        ('weekly','approved','returned'),
        ('weekly','finalized','locked'),
        ('weekly','locked','archived'),
        ('weekly','rejected','archived'),
        -- monthly
        ('monthly','draft','auto_compiled'),
        ('monthly','draft','archived'),
        ('monthly','auto_compiled','department_review'),
        ('monthly','department_review','under_review'),
        ('monthly','department_review','returned'),
        ('monthly','under_review','approved'),
        ('monthly','under_review','returned'),
        ('monthly','under_review','rejected'),
        ('monthly','returned','department_review'),
        ('monthly','approved','finalized'),
        ('monthly','approved','returned'),
        ('monthly','finalized','locked'),
        ('monthly','locked','archived'),
        ('monthly','rejected','archived')
      ) as t(kind, from_status, to_status)
     where t.kind = p_type and t.from_status = p_from and t.to_status = p_to
  );
$fn$;

comment on function public.report_transition_allowed(text, text, text) is
  'Whether from -> to is a legal transition. Mirrors reportWorkflows in src/config/workflows.ts; the two must be changed together.';

/* --------------------------- Stage conditions ----------------------------- */

-- Mirrors unmetConditions() in src/features/weekly-reports/lifecycle-guards.ts.
--
-- NOTE ON 'approved': the TypeScript counted submissions whose status is
-- 'accepted'. No such value exists -- weekly_submissions_status_valid admits
-- pending | in_progress | submitted | returned | approved, and SubmissionStatus
-- says the same. That comparison could never match, so the condition could never
-- be satisfied and NO Weekly could ever reach under_review, approved, finalized
-- or locked through the application. Encoding that here would have made an
-- unsatisfiable rule authoritative. This uses 'approved', the value that
-- actually exists, and the TypeScript is corrected in the same change.
create or replace function public.weekly_transition_blockers(
  p_report uuid, p_to text
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  -- NOTE (P1.0 runtime validation): these appends use array_append rather than
  -- the `||` operator. With an untyped string literal Postgres resolves
  -- `text[] || unknown` as array concatenation and fails with "malformed array
  -- literal" at runtime. Only the format() branch was typed enough to work, so
  -- the reviewer and no-submissions blockers crashed instead of reporting.
  -- Found by 05_validate_p03.sql against a real database.
  v_total    integer;
  v_approved integer;
  v_reviewer uuid;
  v_approver uuid;
  v_out      text[] := '{}';
begin
  select reviewed_by_contact_id, approved_by_contact_id
    into v_reviewer, v_approver
    from public.weekly_reports where id = p_report;

  select count(*), count(*) filter (where status = 'approved')
    into v_total, v_approved
    from public.weekly_submissions where weekly_report_id = p_report;

  if p_to in ('under_review', 'approved', 'finalized', 'locked') then
    if v_total = 0 then
      v_out := array_append(v_out, 'No department submissions exist for this report.');
    elsif v_approved < v_total then
      v_out := array_append(v_out, format(
        '%s of %s department submissions approved - all are required.',
        v_approved, v_total));
    end if;
  end if;

  if p_to in ('approved', 'finalized', 'locked') and v_reviewer is null then
    v_out := array_append(v_out, 'No reviewer recorded.');
  end if;

  if p_to in ('finalized', 'locked') and v_approver is null then
    v_out := array_append(v_out, 'No approver recorded.');
  end if;

  return v_out;
end;
$fn$;

/* ------------------------- The controlled writers -------------------------- */

create or replace function public.set_weekly_report_status(
  p_report uuid, p_to text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_project  uuid;
  v_from     text;
  v_blockers text[];
begin
  select project_id, status into v_project, v_from
    from public.weekly_reports where id = p_report;

  if v_project is null then
    raise exception 'Weekly report % not found.', p_report using errcode = 'no_data_found';
  end if;

  -- Authority FIRST, so a caller with no rights learns nothing about the report.
  if not public.weekly_can_manage_project(v_project) then
    raise exception 'Only Project Control may change the status of this weekly report.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_from = p_to then
    return v_from;
  end if;

  if not public.report_transition_allowed('weekly', v_from, p_to) then
    raise exception 'Cannot move a weekly report from % to %.', v_from, p_to
      using errcode = 'check_violation';
  end if;

  -- Archiving withdraws a report; it asserts nothing about its content, so it
  -- carries no stage conditions -- matching changeStatus() in the service.
  if p_to <> 'archived' then
    v_blockers := public.weekly_transition_blockers(p_report, p_to);
    if coalesce(array_length(v_blockers, 1), 0) > 0 then
      raise exception 'Cannot move this weekly report to %: %',
        p_to, array_to_string(v_blockers, ' | ')
        using errcode = 'check_violation';
    end if;
  end if;

  perform set_config('eprp.status_change', 'weekly:' || p_report::text, true);
  if p_to = 'archived' then
    update public.weekly_reports
       set status = p_to, active = false, archived_at = now()
     where id = p_report;
  else
    update public.weekly_reports set status = p_to where id = p_report;
  end if;
  perform set_config('eprp.status_change', '', true);

  return p_to;
end;
$fn$;

create or replace function public.set_monthly_report_status(
  p_report uuid, p_to text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_project uuid;
  v_from    text;
begin
  select project_id, status into v_project, v_from
    from public.monthly_reports where id = p_report;

  if v_project is null then
    raise exception 'Monthly report % not found.', p_report using errcode = 'no_data_found';
  end if;

  if not public.monthly_can_manage_project(v_project) then
    raise exception 'Only Project Control may change the status of this monthly report.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_from = p_to then
    return v_from;
  end if;

  if not public.report_transition_allowed('monthly', v_from, p_to) then
    raise exception 'Cannot move a monthly report from % to %.', v_from, p_to
      using errcode = 'check_violation';
  end if;

  perform set_config('eprp.status_change', 'monthly:' || p_report::text, true);
  if p_to = 'archived' then
    update public.monthly_reports
       set status = p_to, active = false, archived_at = now()
     where id = p_report;
  else
    update public.monthly_reports set status = p_to where id = p_report;
  end if;
  perform set_config('eprp.status_change', '', true);

  return p_to;
end;
$fn$;

-- EXECUTE is granted to authenticated only. BOTH revokes are required, and the
-- reason is the exact mirror of the defect 20260729000002 fixed:
--
--   * a new function is granted to PUBLIC by default, so PUBLIC must be revoked;
--   * AND this project carries `alter default privileges ... grant execute on
--     functions to anon`, so a new function ALSO receives a DIRECT grant to
--     anon. Revoking PUBLIC does not remove a direct grant.
--
-- 20260729000002 recorded that revoking `anon` alone leaves the PUBLIC grant.
-- This is the same trap from the other side: revoking PUBLIC alone leaves the
-- anon grant. Both are needed, and the post-check below proves it.
--
-- Found by the P1.0 dress rehearsal against the restored production schema.
-- A database WITHOUT that default privilege (a plain local stack) passes with
-- the PUBLIC revoke alone, which is why this was invisible until the migration
-- was applied to production's actual privilege configuration.
revoke execute on function public.set_weekly_report_status(uuid, text) from public;
revoke execute on function public.set_monthly_report_status(uuid, text) from public;
revoke execute on function public.set_weekly_report_status(uuid, text) from anon;
revoke execute on function public.set_monthly_report_status(uuid, text) from anon;
grant execute on function public.set_weekly_report_status(uuid, text) to authenticated;
grant execute on function public.set_monthly_report_status(uuid, text) to authenticated;

/* -------------------------------- The guards ------------------------------ */

create or replace function public.guard_weekly_status_change()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('eprp.status_change', true), '')
         <> 'weekly:' || old.id::text then
    raise exception
      'A weekly report status may only be changed through set_weekly_report_status(). Direct writes are refused so the lifecycle cannot be bypassed.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_guard_weekly_status_change on public.weekly_reports;
create trigger trg_guard_weekly_status_change
  before update on public.weekly_reports
  for each row execute function public.guard_weekly_status_change();

create or replace function public.guard_monthly_status_change()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('eprp.status_change', true), '')
         <> 'monthly:' || old.id::text then
    raise exception
      'A monthly report status may only be changed through set_monthly_report_status(). Direct writes are refused so the lifecycle cannot be bypassed.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_guard_monthly_status_change on public.monthly_reports;
create trigger trg_guard_monthly_status_change
  before update on public.monthly_reports
  for each row execute function public.guard_monthly_status_change();

/* -------------------------- Post-condition checks ------------------------- */

do $post$
declare
  trg integer;
  fn  integer;
  pub integer;
begin
  select count(*) into trg
    from pg_trigger
   where tgname in ('trg_guard_weekly_status_change', 'trg_guard_monthly_status_change')
     and not tgisinternal;

  if trg <> 2 then
    raise exception 'Post-check failed: expected 2 status guard triggers, found %.', trg;
  end if;

  select count(*) into fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('set_weekly_report_status', 'set_monthly_report_status',
                       'report_transition_allowed', 'weekly_transition_blockers');

  if fn <> 4 then
    raise exception 'Post-check failed: expected 4 lifecycle functions, found %.', fn;
  end if;

  -- The controlled writers must not be callable anonymously.
  select count(*) into pub
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('set_weekly_report_status', 'set_monthly_report_status')
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if pub > 0 then
    raise exception 'Post-check failed: % lifecycle function(s) are executable by anon.', pub;
  end if;

  -- Sanity on the transition table itself, so a typo cannot pass silently.
  if not public.report_transition_allowed('weekly', 'draft', 'collecting')
     or public.report_transition_allowed('weekly', 'draft', 'locked')
     or not public.report_transition_allowed('monthly', 'approved', 'finalized')
     or public.report_transition_allowed('monthly', 'draft', 'approved') then
    raise exception 'Post-check failed: the transition table does not behave as specified.';
  end if;

  raise notice 'P0.3 applied: 2 guard triggers, 4 lifecycle functions, anon has no execute.';
end;
$post$;
