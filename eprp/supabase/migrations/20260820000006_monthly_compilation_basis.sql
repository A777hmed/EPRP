-- EPRP P0.4 — Monthly compiles APPROVED Weekly data only.
--
-- THE DEFECT
--   compileFromWeeklies() selected Weekly reports by project and month alone,
--   then took every entry flagged includeInMonthly. It never looked at the
--   Weekly's status, so a draft or in-collection Weekly was compiled into the
--   Monthly -- and from there fed the Executive tier, which totals approved rows
--   only and therefore believed everything it received had been approved. An
--   unapproved position could reach leadership through a tier built to prevent
--   exactly that.
--
--   Breaks 03_REPORTING_ARCHITECTURE Law 1, 02_PLATFORM_ARCHITECTURE 12.3
--   rule 1 ("Only approved input is eligible for compilation. Draft data never
--   rises") and 24.4.
--
-- WHAT THIS ADDS
--   One trigger. The application fix lands in the same change, but the
--   application is not the boundary: compileFromWeeklies() runs in the browser,
--   so a direct PostgREST insert into monthly_comments could carry any source it
--   liked. This refuses such a row in the database.
--
--   No table, column, policy or row is changed. Existing rows are NOT rewritten
--   or removed -- see the census below.
--
-- ONE DEFINITION OF APPROVED
--   Uses public.report_status_is_approved() from 20260820000003, the same
--   predicate Tier B visibility uses, whose TypeScript mirror is
--   APPROVED_REPORT_STATUSES in src/config/workflows.ts. Compilation,
--   visibility and aggregation now share one definition; a second list here
--   would be exactly the drift this phase exists to remove.
--
-- WHY IT GUARDS PROVENANCE, NOT EDITING
--   The check fires on INSERT, and on UPDATE only when the source reference
--   actually changes. Editing an already-compiled row -- writing its
--   presentation_text, resolving it, excluding it from the final -- is untouched.
--   Governing which Weekly a row may come FROM is the rule; freezing rows that
--   were compiled legitimately is not, and would make previously compiled
--   content uneditable the moment its Weekly was returned for correction.
--
-- MANUAL MONTHLY CONTENT IS UNAFFECTED
--   A row with no Weekly source is Monthly-owned (source_kind
--   'monthly_manual'), which 12.2 explicitly permits alongside compiled
--   content. The guard ignores those rows entirely.

/* ------------------------------- The guard -------------------------------- */

create or replace function public.guard_monthly_comment_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_weekly uuid;
  v_status text;
begin
  -- Resolve the Weekly this row claims to come from. Prefer the explicit
  -- report reference; fall back to the entry's own parent so a row cannot
  -- evade the check by naming only the entry.
  v_weekly := new.source_weekly_report_id;
  if v_weekly is null and new.source_weekly_entry_id is not null then
    select weekly_report_id into v_weekly
      from public.weekly_entries where id = new.source_weekly_entry_id;
  end if;

  -- Monthly-owned content: nothing to check.
  if v_weekly is null then
    return new;
  end if;

  -- On UPDATE, only a CHANGE of provenance is governed.
  if tg_op = 'UPDATE'
     and new.source_weekly_report_id is not distinct from old.source_weekly_report_id
     and new.source_weekly_entry_id is not distinct from old.source_weekly_entry_id then
    return new;
  end if;

  select status into v_status from public.weekly_reports where id = v_weekly;

  if v_status is null then
    raise exception
      'Cannot compile from weekly report %: it does not exist.', v_weekly
      using errcode = 'foreign_key_violation';
  end if;

  if not public.report_status_is_approved(v_status) then
    raise exception
      'Cannot compile Monthly content from a weekly report at status "%". Monthly compiles approved, finalized or locked Weekly data only.',
      v_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_guard_monthly_comment_source on public.monthly_comments;
create trigger trg_guard_monthly_comment_source
  before insert or update on public.monthly_comments
  for each row execute function public.guard_monthly_comment_source();

/* ------------------- Census of already-compiled content ------------------- */
--
-- REPORTING ONLY. Nothing is deleted, hidden or rewritten.
--
-- Rows compiled before this rule existed may point at a Weekly that is not
-- currently approved -- either because it never was, or because it has since
-- been returned, rejected or archived. Both are real history: the Monthly said
-- what it said at the time, and 24.1 rule 5 plus principle 6 mean history is
-- preserved, never overwritten. Deleting them would destroy issued Monthly
-- content to satisfy a rule introduced afterwards.
--
-- They are surfaced here so the number is known rather than discovered later.
-- Deciding what to do about any such row -- leave it, annotate it, or issue a
-- Monthly revision -- is an owner decision, and revisions are not built yet.

do $census$
declare
  total    integer;
  affected integer;
  r        record;
begin
  select count(*) into total
    from public.monthly_comments
   where source_weekly_report_id is not null;

  select count(*) into affected
    from public.monthly_comments mc
    join public.weekly_reports w on w.id = mc.source_weekly_report_id
   where not public.report_status_is_approved(w.status);

  raise notice 'P0.4 census: % Monthly row(s) carry a Weekly source; % come from a Weekly that is not currently approved.', total, affected;

  if affected > 0 then
    raise notice '  These rows are PRESERVED. Breakdown by the source Weekly status:';
    for r in
      select w.status as weekly_status, count(*) as rows
        from public.monthly_comments mc
        join public.weekly_reports w on w.id = mc.source_weekly_report_id
       where not public.report_status_is_approved(w.status)
       group by w.status
       order by count(*) desc
    loop
      raise notice '    %  ->  % row(s)', rpad(r.weekly_status, 14), r.rows;
    end loop;
    raise notice '  No row was modified. Review them before the next Monthly issue.';
  end if;
end;
$census$;

/* -------------------------- Post-condition checks ------------------------- */

do $post$
declare
  trg integer;
  fn  integer;
begin
  select count(*) into trg
    from pg_trigger
   where tgname = 'trg_guard_monthly_comment_source' and not tgisinternal;

  if trg <> 1 then
    raise exception 'Post-check failed: expected the monthly source guard trigger, found %.', trg;
  end if;

  -- The shared approved definition must exist; without it the guard would
  -- fail open or fail closed for the wrong reason.
  select count(*) into fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'report_status_is_approved';

  if fn <> 1 then
    raise exception 'Post-check failed: report_status_is_approved() is missing; 20260820000003 must be applied first.';
  end if;

  -- The guard must agree with the shared definition at its boundaries.
  if public.report_status_is_approved('collecting')
     or public.report_status_is_approved('under_review')
     or public.report_status_is_approved('archived')
     or not public.report_status_is_approved('approved')
     or not public.report_status_is_approved('finalized')
     or not public.report_status_is_approved('locked') then
    raise exception 'Post-check failed: the approved status set does not behave as specified.';
  end if;

  raise notice 'P0.4 applied: Monthly compilation guarded at the data boundary; existing rows untouched.';
end;
$post$;
