-- EPRP — POST-WAVE-1 VERIFIER.  100% READ-ONLY.
--
-- WHY THIS IS A SEPARATE FILE
--   80_ and 81_ are PRE-deployment checks. Their expectations are "P0 is not
--   applied": Check 1 reads NO-GO once it is, and the policy baseline expects
--   96/17. Retrofitting them would destroy the record of what the pre-flight
--   actually asserted, and a check that means different things at different
--   times is worse than no check. This file states post-Wave-1 expectations
--   instead, and 80_/81_ keep their historical meaning.
--
-- SCOPE — Wave 1 only: 20260820000001 .. 20260820000004.
--   Wave 2 (…0005 lifecycle, …0006 monthly compilation) is NOT expected here
--   and this verifier asserts it is ABSENT.
--
-- Every statement is a SELECT. Safe to run against production, and repeatable.
--
-- HOW TO RUN
--   Dashboard -> SQL Editor -> New query -> paste -> Run -> export CSV.
--   The `verdict` column is the answer. Any FAIL stops acceptance.

with

/* 1. Exactly which versions are applied ------------------------------------ */
applied as (
  select version from supabase_migrations.schema_migrations
   where version like '2026082000000%'
),

/* 2. Open policies, split by whether they permit writing ------------------- */
open_pol as (
  select tablename, cmd
    from pg_policies
   where schemaname = 'public' and (qual = 'true' or with_check = 'true')
),

/* The 14 tables that were already open before Wave 1 and that Wave 1 never
   touched. Tracked as P1 item S1 — expected, not introduced here. */
known_p1(t) as (values
  ('clients'),('contacts'),('departments'),('disciplines'),('systems'),
  ('project_types'),('project_phases'),('job_titles'),('project_disciplines'),
  ('project_delegations'),('organization_charts'),('organization_positions'),
  ('position_assignment_history'),('weekly_lifecycle_corrections')),

/* Tier A: opened for READ by Wave 1. Every one must be SELECT-only. */
tier_a(t, src) as (values
  ('projects','P0.1'),('project_contacts','P0.1'),
  ('project_departments','P0.2'),('project_sites','P0.2'),
  ('project_positions','P0.2'),('project_documents','P0.2'),
  ('project_events','P0.2'),('project_event_attendees','P0.2'),
  ('master_milestones','P0.2'),('master_deliverables','P0.2')),

totals as (select count(*) as n from pg_policies where schemaname='public')

select * from (

  /* ---- A. Applied versions ---------------------------------------------- */
  select 1 as seq, 'A. APPLIED VERSIONS' as check_name, 'count' as item,
         (select count(*)::text from applied) as value,
         case when (select count(*) from applied) = 4 then 'PASS'
              else 'FAIL - expected exactly 4' end as verdict
  union all
  select 1, 'A. APPLIED VERSIONS', version, 'applied',
         case when version in ('20260820000001','20260820000002',
                               '20260820000003','20260820000004')
              then 'PASS - Wave 1'
              else 'FAIL - not a Wave 1 migration' end
    from applied
  union all
  select 1, 'A. APPLIED VERSIONS', 'Wave 2 absent',
         (select count(*)::text from applied
           where version in ('20260820000005','20260820000006')),
         case when (select count(*) from applied
                     where version in ('20260820000005','20260820000006')) = 0
              then 'PASS - Wave 2 not deployed'
              else 'FAIL - Wave 2 is deployed' end

  /* ---- B. Policy total --------------------------------------------------- */
  union all
  select 2, 'B. POLICY TOTAL', 'policies in public', n::text,
         case when n = 101 then 'PASS - 96 baseline +5 from P0.1'
              else 'REVIEW - expected 101' end
    from totals

  /* ---- C. Write-open policies ------------------------------------------- */
  union all
  select 3, 'C. WRITE-OPEN', 'count', count(*)::text,
         case when count(*) = 14 then 'PASS - unchanged P1 residue'
              else 'FAIL - expected 14' end
    from open_pol where cmd <> 'SELECT'
  union all
  select 3, 'C. WRITE-OPEN', o.tablename, o.cmd,
         case when exists (select 1 from known_p1 k where k.t = o.tablename)
              then 'PASS - known P1 residue (item S1)'
              else 'FAIL - NEW write-open table' end
    from open_pol o where o.cmd <> 'SELECT'

  /* ---- D. Tier A read-open ---------------------------------------------- */
  union all
  select 4, 'D. TIER A READ-OPEN', 'count', count(*)::text,
         case when count(*) = 10 then 'PASS' else 'FAIL - expected 10' end
    from open_pol where cmd = 'SELECT'
  union all
  select 4, 'D. TIER A READ-OPEN', a.t || ' (' || a.src || ')',
         coalesce((select o.cmd from open_pol o where o.tablename = a.t), 'NOT OPEN'),
         case when exists (select 1 from open_pol o
                            where o.tablename = a.t and o.cmd = 'SELECT')
              then 'PASS - read-only, as intended'
              when exists (select 1 from open_pol o
                            where o.tablename = a.t and o.cmd <> 'SELECT')
              then 'FAIL - Tier A table is WRITE-open'
              else 'FAIL - Tier A table not readable' end
    from tier_a a

  /* ---- E. Things Wave 1 must have CLOSED --------------------------------- */
  union all
  select 5, 'E. CLOSED BY WAVE 1', 'projects blanket ALL',
         (select count(*)::text from pg_policies
           where tablename='projects' and cmd='ALL'),
         case when (select count(*) from pg_policies
                     where tablename='projects' and cmd='ALL') = 0
              then 'PASS - escalation closed' else 'FAIL - still open' end
  union all
  select 5, 'E. CLOSED BY WAVE 1', 'project_contacts blanket ALL',
         (select count(*)::text from pg_policies
           where tablename='project_contacts' and cmd='ALL'),
         case when (select count(*) from pg_policies
                     where tablename='project_contacts' and cmd='ALL') = 0
              then 'PASS - escalation closed' else 'FAIL - still open' end
  union all
  select 5, 'E. CLOSED BY WAVE 1', 'projects DELETE policy',
         (select count(*)::text from pg_policies
           where tablename='projects' and cmd='DELETE'),
         case when (select count(*) from pg_policies
                     where tablename='projects' and cmd='DELETE') = 0
              then 'PASS - none, by design' else 'FAIL - unexpected' end
  union all
  select 5, 'E. CLOSED BY WAVE 1', 'executive_reports open SELECT',
         (select count(*)::text from pg_policies
           where tablename='executive_reports' and cmd='SELECT' and qual='true'),
         case when (select count(*) from pg_policies
                     where tablename='executive_reports' and cmd='SELECT'
                       and qual='true') = 0
              then 'PASS - draft narrative no longer public' else 'FAIL' end

  /* ---- F. Wave 1 functions present, Wave 2 functions absent ------------- */
  union all
  select 6, 'F. FUNCTIONS', p.proname, 'present',
         case when p.proname in ('can_create_project','can_manage_project_setup',
                                 'report_status_is_approved',
                                 'weekly_report_is_approved',
                                 'monthly_report_is_approved')
              then 'PASS - Wave 1'
              else 'FAIL - Wave 2 function should not exist yet' end
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('can_create_project','can_manage_project_setup',
                       'report_status_is_approved','weekly_report_is_approved',
                       'monthly_report_is_approved','set_weekly_report_status',
                       'set_monthly_report_status','report_transition_allowed')
  union all
  select 6, 'F. FUNCTIONS', 'Wave 2 status guards',
         (select count(*)::text from pg_trigger
           where tgname in ('trg_guard_weekly_status_change',
                            'trg_guard_monthly_status_change')
             and not tgisinternal),
         case when (select count(*) from pg_trigger
                     where tgname in ('trg_guard_weekly_status_change',
                                      'trg_guard_monthly_status_change')
                       and not tgisinternal) = 0
              then 'PASS - Wave 2 not deployed' else 'FAIL - Wave 2 present' end

  /* ---- G. Consolidator rule is the unified one -------------------------- */
  union all
  select 7, 'G. CONSOLIDATOR RULE', 'weekly_can_manage_project delegates',
         case when pg_get_functiondef(p.oid) like '%is_project_consolidator%'
              then 'yes' else 'no' end,
         case when pg_get_functiondef(p.oid) like '%is_project_consolidator%'
               and pg_get_functiondef(p.oid) not like '%project_control_manager_id%'
              then 'PASS - one canonical rule (P0.6)'
              else 'FAIL - rule not unified' end
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='weekly_can_manage_project'

) t order by seq, check_name, item;
