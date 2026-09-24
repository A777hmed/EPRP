-- Access & Visibility Reconciliation hotfix — global Weekly/Monthly report
-- REGISTER visibility (§B of the original ticket, completed).
--
-- CONFIRMED REPRODUCTION
--   Admin runtime confirms 10 Monthly reports and two Executive periods
--   (Aug/Sep) exist. Nour Adel — Viewer, Reporting Coordinator on
--   PSAIM-001 only — sees ZERO in the Weekly register, ZERO in the Monthly
--   register, despite the Dashboard (fixed by the two prior migrations)
--   correctly showing all six active projects.
--
-- ROOT CAUSE
--   `/weekly-reports` and `/monthly-reports` (features/weekly-reports/
--   components/weekly-reports-view.tsx, features/monthly-reports/
--   monthly-list-view.tsx) call `projectService.getProjects()` /
--   `weeklyReportService.list()` / `monthlyReportService.list()` directly —
--   the same assignment/portfolio-grant-gated reads the Dashboard used to
--   call before its own hotfix. Those registers are ALREADY documented,
--   in their own source comments, as "READ-ONLY consolidated register
--   across every project the viewer can see" — the intent was always
--   platform-wide, read-only; the read path underneath it was never
--   widened to match.
--
-- THIS MIGRATION'S SCOPE, AND WHAT IT DELIBERATELY DOES NOT COVER
--   1. REGISTER METADATA — every project, every Weekly/Monthly report,
--      every status, platform-wide, read-only. A Draft's row appears with
--      its status; per "keep unapproved draft content restricted... its
--      register metadata may remain visible", this is exactly metadata
--      (id/report_number/status/dates/planned/actual/prepared_by), never
--      narrative.
--   2. REPORT-LEVEL DETAIL CONTENT for a SPECIFIC report already reached
--      by id — `global_weekly_report_detail(uuid)` / `global_monthly_
--      report_detail(uuid)` — but ONLY when that report's own status is
--      `approved`/`finalized`/`locked` (`report_status_is_approved()`,
--      the existing predicate, reused unchanged) OR the caller already has
--      ordinary project access. This is the report's own header/KPI/
--      narrative row (including `summary`/`executive_summary` and
--      `signatories` — the actual document content, which is the whole
--      point of "viewing" it) for ONE identified report, not a general
--      export.
--   3. NOT COVERED — DEPARTMENT-LEVEL CONTENT. `weekly_submissions`,
--      `weekly_entries`, `weekly_activities`, `weekly_plan_items`,
--      `monthly_comments`, `monthly_department_summaries`, `monthly_
--      plan_items` remain exactly as assignment-gated as they already
--      are. A cross-project viewer reaching an approved+ report through
--      this migration's new read path sees its header, KPIs and Executive
--      Summary; its Departments/Critical Issues/Lookahead sections render
--      empty (the application's own existing "nothing to show" state, not
--      an error) until a follow-up migration extends the same approved+
--      pattern to those seven tables — each needs its own column-by-column
--      review (comment threads, attachments, who-said-what) before being
--      widened, which this pass did not have room to do safely. Flagged as
--      the primary remaining blocker in the session's completion report.
--   4. Executive's live-derived `/executive-reports` portfolio view reads
--      Weekly/Monthly through the exact same assignment-gated service
--      calls this migration's TypeScript side replaces for the two
--      registers — wiring `use-executive-portfolio.ts` to the same new
--      functions is the natural next step and is NOT done in this
--      migration; `executive_reports` (the persisted table, distinct from
--      the live view) already has its own working platform-wide-for-
--      approved+ policy today (`executive_reports_select`, unchanged,
--      verified) and needed no fix here.
--
-- WHY NEW FUNCTIONS AND NOT projects_select / weekly_reports_select /
-- monthly_reports_select CHANGES
--   Same reasoning as the Dashboard migrations: those policies remain the
--   boundary for every other caller (Project Setup, the workspaces,
--   Executive's own persisted-report gate). `global_report_register_
--   projects()` / `global_weekly_report_register()` / `global_monthly_
--   report_register()` / `global_weekly_report_detail()` / `global_
--   monthly_report_detail()` are separate, additive, READ-ONLY, explicit-
--   column paths used only by the two global registers and (for the two
--   `_detail` functions) the report detail/preview pages' own read
--   fallback.
--
-- WHY THE PROJECT DIRECTORY FUNCTION IS WIDER THAN dashboard_projects(),
-- AND WHY IT IS A SEPARATE FUNCTION RATHER THAN A CHANGE TO IT
--   The registers' Client/Portfolio Group filter columns need
--   `client_id`/`portfolio_group_id`, and Executive's project display
--   needs `project_manager_id` — none of which `dashboard_projects()`
--   returns, and "keep the existing Dashboard read model... unchanged"
--   is explicit. `global_report_register_projects()` also does NOT filter
--   archived — the registers are documented historical surfaces
--   ("Preserve historical visibility where already allowed"), unlike the
--   Dashboard's current-management scope.
--
-- SCHEMA / POLICY VERIFICATION
--   `report_status_is_approved()` (`approved`/`finalized`/`locked`),
--   `weekly_report_is_approved()`, `monthly_report_is_approved()`,
--   `weekly_can_access_project()` and `executive_reports_select`'s own
--   `report_status_is_approved(status)` branch (already platform-wide,
--   unconditional, for the persisted Executive table) were all read
--   directly from the same local Postgres instance the prior migration's
--   header records verifying, this session. Reused, not re-derived.
--
-- SCOPE
--   Five new functions. Zero policy changes anywhere. Zero new tables.
--   Zero write surface. Forward-only.

/* ============================ Project directory ============================= */

create function public.global_report_register_projects()
returns table (
  id                    uuid,
  code                  text,
  name                  text,
  short_name            text,
  status                text,
  client_id             uuid,
  portfolio_group_id    uuid,
  project_manager_id    uuid,
  project_type_id       uuid,
  current_phase_id      uuid,
  forecast_finish_date  date,
  updated_at            timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, p.code, p.name, p.short_name, p.status, p.client_id,
         p.portfolio_group_id, p.project_manager_id, p.project_type_id,
         p.current_phase_id, p.forecast_finish_date, p.updated_at
    from public.projects p
   where (select auth.uid()) is not null;
$fn$;

comment on function public.global_report_register_projects() is
  'Access & Visibility hotfix, section B. Global-register-only, READ-ONLY, platform-wide project directory -- every project, EVERY status including archived (registers are historical surfaces, unlike the Dashboard''s current-management scope). Explicit column list, wider than dashboard_projects() (adds client_id/portfolio_group_id/project_manager_id/project_type_id for the registers'' own filters and Executive''s display) -- kept a SEPARATE function rather than a change to dashboard_projects() so the Dashboard read model stays exactly as its own migration left it.';

/* ============================ Weekly register =============================== */

create function public.global_weekly_report_register()
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
  prepared_by_contact_id   uuid,
  planning_snapshot_id     uuid,
  updated_at               timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select wr.id, wr.project_id, wr.report_number, wr.status, wr.week_number,
         wr.period_start, wr.period_end, wr.planned_progress, wr.actual_progress,
         wr.prepared_by_contact_id, wr.planning_snapshot_id, wr.updated_at
    from public.weekly_reports wr
   where (select auth.uid()) is not null;
$fn$;

comment on function public.global_weekly_report_register() is
  'Access & Visibility hotfix, section B. Global Weekly register, READ-ONLY, platform-wide -- every project, EVERY report, EVERY status (register metadata for a Draft stays visible; its content does not -- see global_weekly_report_detail()). Explicit column list -- excludes summary (narrative), signatories and every contact id except prepared_by_contact_id, same basis as the Dashboard''s weekly summary function. weekly_reports_select is unchanged.';

/* ============================ Monthly register ================================ */

create function public.global_monthly_report_register()
returns table (
  id                       uuid,
  project_id               uuid,
  report_number            text,
  status                   text,
  reporting_month          date,
  planned_progress         numeric,
  actual_progress          numeric,
  prepared_by_contact_id   uuid,
  planning_snapshot_id     uuid,
  updated_at               timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select mr.id, mr.project_id, mr.report_number, mr.status, mr.reporting_month,
         mr.planned_progress, mr.actual_progress, mr.prepared_by_contact_id,
         mr.planning_snapshot_id, mr.updated_at
    from public.monthly_reports mr
   where (select auth.uid()) is not null;
$fn$;

comment on function public.global_monthly_report_register() is
  'Access & Visibility hotfix, section B. Monthly mirror of global_weekly_report_register(). monthly_reports_select is unchanged.';

/* ======================= Report-level approved+ detail ======================= */

create function public.global_weekly_report_detail(p_report_id uuid)
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
       or public.report_status_is_approved(wr.status)
     );
$fn$;

comment on function public.global_weekly_report_detail(uuid) is
  'Access & Visibility hotfix, section B. ONE Weekly report''s full header/KPI/narrative row -- report_number, KPIs, summary (Executive Summary), signatories -- readable when the caller already has ordinary project access (weekly_can_access_project(), unchanged) OR the report itself is approved/finalized/locked (report_status_is_approved(), the existing predicate, reused unchanged). A Draft report is NOT returned to an unassigned caller by this function -- content stays restricted; only the register (global_weekly_report_register()) shows its metadata. Department-level content (submissions/entries/activities/plan items) is deliberately NOT covered -- see migration header. weekly_reports_select is unchanged; this is an additional, narrower, read-only path alongside it.';

create function public.global_monthly_report_detail(p_report_id uuid)
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
       or public.report_status_is_approved(mr.status)
     );
$fn$;

comment on function public.global_monthly_report_detail(uuid) is
  'Monthly mirror of global_weekly_report_detail(uuid). monthly_reports_select is unchanged.';

/* ------------------------------- grants ------------------------------------- */

revoke execute on function public.global_report_register_projects() from public, anon;
revoke execute on function public.global_weekly_report_register() from public, anon;
revoke execute on function public.global_monthly_report_register() from public, anon;
revoke execute on function public.global_weekly_report_detail(uuid) from public, anon;
revoke execute on function public.global_monthly_report_detail(uuid) from public, anon;

grant execute on function public.global_report_register_projects() to authenticated, service_role;
grant execute on function public.global_weekly_report_register() to authenticated, service_role;
grant execute on function public.global_monthly_report_register() to authenticated, service_role;
grant execute on function public.global_weekly_report_detail(uuid) to authenticated, service_role;
grant execute on function public.global_monthly_report_detail(uuid) to authenticated, service_role;

/* ----------------------------- postconditions ----------------------------- */

do $post$
declare
  v_fn_count      integer;
  v_projects_qual text;
  v_weekly_qual   text;
  v_monthly_qual  text;
  v_anon_leak     integer;
  v_fn_name       text;
begin
  select count(*) into v_fn_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'global_report_register_projects',
       'global_weekly_report_register',
       'global_monthly_report_register',
       'global_weekly_report_detail',
       'global_monthly_report_detail'
     );
  if v_fn_count <> 5 then
    raise exception 'Post-check failed: expected 5 global report register functions, found %.', v_fn_count;
  end if;

  for v_fn_name in
    select unnest(array[
      'global_report_register_projects',
      'global_weekly_report_register',
      'global_monthly_report_register',
      'global_weekly_report_detail',
      'global_monthly_report_detail'
    ])
  loop
    if (
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_fn_name
         and pg_get_function_result(p.oid) ilike 'setof %'
    ) > 0 then
      raise exception 'Post-check failed: % returns a SETOF passthrough -- it must return an explicit column list.', v_fn_name;
    end if;
  end loop;

  -- The two _detail functions must literally gate on report_status_is_approved
  -- (or ordinary project access) -- present in the SQL text, not merely a claim.
  if (
    select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'global_weekly_report_detail'
  ) not ilike '%report_status_is_approved%' then
    raise exception 'Post-check failed: global_weekly_report_detail() does not reference report_status_is_approved().';
  end if;
  if (
    select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'global_monthly_report_detail'
  ) not ilike '%report_status_is_approved%' then
    raise exception 'Post-check failed: global_monthly_report_detail() does not reference report_status_is_approved().';
  end if;

  -- Underlying policies this migration reads from remain exactly as verified.
  select qual into v_projects_qual from pg_policies
   where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_select';
  if v_projects_qual is null or v_projects_qual not like '%can_access_project%' then
    raise exception 'Post-check failed: projects_select was modified -- it must remain unchanged.';
  end if;

  select qual into v_weekly_qual from pg_policies
   where schemaname = 'public' and tablename = 'weekly_reports' and policyname = 'weekly_reports_select';
  if v_weekly_qual is null or v_weekly_qual not like '%can_access_project%' then
    raise exception 'Post-check failed: weekly_reports_select was modified -- it must remain unchanged.';
  end if;

  select qual into v_monthly_qual from pg_policies
   where schemaname = 'public' and tablename = 'monthly_reports' and policyname = 'monthly_reports_select';
  if v_monthly_qual is null or v_monthly_qual not like '%can_access_project%' then
    raise exception 'Post-check failed: monthly_reports_select was modified -- it must remain unchanged.';
  end if;

  select count(*) into v_anon_leak
    from information_schema.routine_privileges
   where routine_schema = 'public'
     and routine_name in (
       'global_report_register_projects',
       'global_weekly_report_register',
       'global_monthly_report_register',
       'global_weekly_report_detail',
       'global_monthly_report_detail'
     )
     and grantee in ('anon', 'public');
  if v_anon_leak > 0 then
    raise exception 'Post-check failed: % global register function grant(s) reach anon/public.', v_anon_leak;
  end if;

  raise notice 'Global report register visibility applied: 5 functions created -- explicit column lists, authenticated-only, SELECT-only, approved+/finalized/locked gate on the two _detail functions. weekly_reports_select/monthly_reports_select/projects_select unchanged. Department-level content tables NOT widened -- see migration header.';
end;
$post$;
