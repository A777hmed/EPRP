-- ============================================================================
-- Weekly/Monthly report DETAIL — narratives only once published
-- ============================================================================
--
-- Forward-only. Replaces the bodies of two existing read-only functions from
-- 20260922000002_global_report_register_visibility.sql. Signatures, result
-- columns, SECURITY DEFINER, search_path and grants are unchanged; only the
-- platform-wide branch of their WHERE clause is narrowed.
--
-- PROBLEM
--   global_weekly_report_detail(uuid) / global_monthly_report_detail(uuid)
--   return a report's header row INCLUDING its narrative — `summary` (Weekly)
--   and `executive_summary` (Monthly) — to any signed-in caller when
--
--       weekly_can_access_project(project)          -- legitimate access
--    OR report_status_is_approved(status)           -- approved|finalized|locked
--
--   The second branch reaches users with NO project access and NO portfolio
--   grant, and it admits 'approved'. That contradicts the portfolio-read design
--   (20260912000003): even the Published Portfolio Read tier sees a
--   Weekly/Monthly report only once it is 'finalized' or 'locked', because
--   after Approve the workflow still has Finalize and Lock ahead of it —
--   "approved" is not yet the published document. A user with no grant could
--   therefore read more than the Published tier is meant to.
--
-- APPROVED RULE (this migration)
--   * Legitimate project access — assignments, Project Control, global
--     operational authority, and the FULL portfolio-read tier (all folded into
--     can_access_project()) — keeps every status, exactly as before.
--   * Everyone else (platform-wide register readers, including the PUBLISHED
--     tier and users with no grant) reads the narrative only when the report is
--     'finalized' or 'locked' — weekly_report_completed(), the same predicate
--     weekly_reports_select / monthly_reports_select already use for the
--     Published tier.
--   * Anonymous callers: still refused (auth.uid() guard + no EXECUTE).
--
-- WHAT DOES NOT CHANGE
--   * Register METADATA (global_*_report_register()) — every report, every
--     status, no narrative — stays platform-wide.
--   * Every table RLS policy. The department-level children already require
--     project access, department scope, or the Published tier's
--     finalized/locked rule; none has an approved-only branch.
--   * Callers need no change: a NULL detail row is the existing, handled
--     "not reachable" state (same as a Draft today); the Executive portfolio
--     falls back to register metadata for such rows.
-- ============================================================================

create or replace function public.global_weekly_report_detail(p_report_id uuid)
returns table (
  id                       uuid,
  project_id               uuid,
  report_number            text,
  status                   text,
  week_number              integer,
  period_start             date,
  period_end               date,
  planned_progress         integer,
  actual_progress          integer,
  man_hours_to_date        integer,
  hse_status               text,
  quality_status           text,
  overall_progress_status  text,
  summary                  text,
  signatories              jsonb,
  discipline_ids           uuid[],
  prepared_by_contact_id   uuid,
  reviewed_by_contact_id   uuid,
  approved_by_contact_id   uuid,
  planning_snapshot_id     uuid,
  created_at               timestamptz,
  updated_at               timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select wr.id, wr.project_id, wr.report_number, wr.status, wr.week_number,
         wr.period_start, wr.period_end, wr.planned_progress, wr.actual_progress,
         wr.man_hours_to_date, wr.hse_status, wr.quality_status,
         wr.overall_progress_status, wr.summary, wr.signatories,
         wr.discipline_ids, wr.prepared_by_contact_id, wr.reviewed_by_contact_id,
         wr.approved_by_contact_id, wr.planning_snapshot_id, wr.created_at,
         wr.updated_at
    from public.weekly_reports wr
   where wr.id = p_report_id
     and (select auth.uid()) is not null
     and (
       public.weekly_can_access_project(wr.project_id)
       or public.weekly_report_completed(wr.status)
     );
$fn$;

comment on function public.global_weekly_report_detail(uuid) is
  'One Weekly report header row, including its narrative (summary). Returned to a signed-in caller with project access (assignments, Project Control, global authority or the Full portfolio-read tier) at any status; to everyone else only once finalized or locked (weekly_report_completed()). NULL otherwise. weekly_reports_select is unchanged.';

create or replace function public.global_monthly_report_detail(p_report_id uuid)
returns table (
  id                       uuid,
  project_id               uuid,
  report_number            text,
  status                   text,
  reporting_month          date,
  planned_progress         numeric,
  actual_progress          numeric,
  hse_status               text,
  quality_status           text,
  overall_progress_status  text,
  executive_summary        text,
  prepared_by_contact_id   uuid,
  reviewed_by_contact_id   uuid,
  approved_by_contact_id   uuid,
  planning_snapshot_id     uuid,
  created_at               timestamptz,
  updated_at               timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select mr.id, mr.project_id, mr.report_number, mr.status, mr.reporting_month,
         mr.planned_progress, mr.actual_progress, mr.hse_status, mr.quality_status,
         mr.overall_progress_status, mr.executive_summary, mr.prepared_by_contact_id,
         mr.reviewed_by_contact_id, mr.approved_by_contact_id, mr.planning_snapshot_id,
         mr.created_at, mr.updated_at
    from public.monthly_reports mr
   where mr.id = p_report_id
     and (select auth.uid()) is not null
     and (
       public.weekly_can_access_project(mr.project_id)
       or public.weekly_report_completed(mr.status)
     );
$fn$;

comment on function public.global_monthly_report_detail(uuid) is
  'One Monthly report header row, including its narrative (executive_summary). Returned to a signed-in caller with project access (assignments, Project Control, global authority or the Full portfolio-read tier) at any status; to everyone else only once finalized or locked (weekly_report_completed()). NULL otherwise. monthly_reports_select is unchanged.';

-- CREATE OR REPLACE keeps existing privileges; restated so this file alone is
-- the complete statement of who may call these functions.
revoke execute on function public.global_weekly_report_detail(uuid) from public, anon;
revoke execute on function public.global_monthly_report_detail(uuid) from public, anon;
grant execute on function public.global_weekly_report_detail(uuid) to authenticated, service_role;
grant execute on function public.global_monthly_report_detail(uuid) to authenticated, service_role;

/* ------------------------------- Post-check ------------------------------- */

do $$
declare
  v_def text;
  v_fn  text;
begin
  -- The published predicate means exactly finalized|locked.
  if public.weekly_report_completed('approved')
     or public.weekly_report_completed('draft')
     or public.weekly_report_completed('archived')
     or not public.weekly_report_completed('finalized')
     or not public.weekly_report_completed('locked') then
    raise exception 'Post-check failed: weekly_report_completed() no longer means finalized|locked.';
  end if;

  foreach v_fn in array array['global_weekly_report_detail', 'global_monthly_report_detail'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;

    if v_def is null then
      raise exception 'Post-check failed: %(uuid) is missing.', v_fn;
    end if;
    if v_def like '%report_status_is_approved%' then
      raise exception 'Post-check failed: % still admits approved-only reports.', v_fn;
    end if;
    if v_def not like '%weekly_report_completed%'
       or v_def not like '%weekly_can_access_project%'
       or v_def not like '%auth.uid()%' then
      raise exception 'Post-check failed: % does not have the expected access predicate.', v_fn;
    end if;
    if v_def not like '%SECURITY DEFINER%' then
      raise exception 'Post-check failed: % is no longer SECURITY DEFINER.', v_fn;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.global_weekly_report_detail(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.global_monthly_report_detail(uuid)', 'EXECUTE') then
    raise exception 'Post-check failed: anon can execute a report detail function.';
  end if;
  if not has_function_privilege('authenticated', 'public.global_weekly_report_detail(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.global_monthly_report_detail(uuid)', 'EXECUTE') then
    raise exception 'Post-check failed: authenticated lost EXECUTE on a report detail function.';
  end if;

  raise notice 'Report detail narratives: project access at any status; otherwise finalized/locked only; anon denied.';
end;
$$;
