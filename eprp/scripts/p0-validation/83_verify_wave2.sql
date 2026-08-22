-- EPRP — POST-WAVE-2 VERIFIER.  100% READ-ONLY.
--
-- WHY A THIRD FILE
--   80_/81_ are pre-deployment. 82_ asserts Wave 1 applied and Wave 2 ABSENT.
--   Once Wave 2 lands, 82_ correctly starts failing. Rather than rewrite it and
--   destroy the record of what it asserted, this file states the post-Wave-2
--   expectations. Each verifier means one thing, permanently.
--
-- WHAT A READ-ONLY VERIFIER CAN AND CANNOT PROVE
--   It proves the guards are INSTALLED, ENABLED, and hold the right privileges,
--   and that nothing else drifted. It cannot prove a guard FIRES, because that
--   needs a write attempt. That proof is the manual smoke test.
--
--   This distinction is deliberate: "the trigger row exists" and "the trigger
--   refuses a write" are different claims, and only the first is provable here.
--
-- Every statement is a SELECT. Safe to run against production, and repeatable.
--
-- HOW TO RUN
--   Dashboard -> SQL Editor -> New query -> paste -> Run -> export CSV.
--   The `verdict` column is the answer. Any FAIL stops acceptance.

with

migs as (
  select version, count(*) as n
    from supabase_migrations.schema_migrations
   where version like '2026082000000%'
   group by version
),

expected(v, wave) as (values
  ('20260820000001','Wave 1'),('20260820000002','Wave 1'),
  ('20260820000003','Wave 1'),('20260820000004','Wave 1'),
  ('20260820000005','Wave 2'),('20260820000006','Wave 2')),

trg as (
  select t.tgname, t.tgenabled, c.relname as tbl
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and t.tgname in ('trg_guard_weekly_status_change',
                      'trg_guard_monthly_status_change',
                      'trg_guard_monthly_comment_source')
),

fns as (
  select p.proname, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('set_weekly_report_status','set_monthly_report_status',
                       'report_transition_allowed','weekly_transition_blockers',
                       'guard_weekly_status_change','guard_monthly_status_change',
                       'guard_monthly_comment_source')
),

open_pol as (
  select tablename, cmd from pg_policies
   where schemaname = 'public' and (qual = 'true' or with_check = 'true')
),

known_p1(t) as (values
  ('clients'),('contacts'),('departments'),('disciplines'),('systems'),
  ('project_types'),('project_phases'),('job_titles'),('project_disciplines'),
  ('project_delegations'),('organization_charts'),('organization_positions'),
  ('position_assignment_history'),('weekly_lifecycle_corrections')),

totals as (select count(*) as n from pg_policies where schemaname='public')

select * from (

  /* ---- A. All six applied, exactly once each ----------------------------- */
  select 1 as seq, 'A. MIGRATIONS' as check_name, 'distinct versions' as item,
         (select count(*)::text from migs) as value,
         case when (select count(*) from migs) = 6 then 'PASS'
              else 'FAIL - expected 6' end as verdict
  union all
  select 1, 'A. MIGRATIONS', e.v || ' (' || e.wave || ')',
         coalesce((select n::text from migs m where m.version = e.v), 'MISSING'),
         case when (select n from migs m where m.version = e.v) = 1 then 'PASS - applied once'
              when (select n from migs m where m.version = e.v) is null then 'FAIL - not applied'
              else 'FAIL - applied more than once' end
    from expected e

  /* ---- B. Wave 2 triggers present AND enabled ---------------------------- */
  union all
  select 2, 'B. TRIGGERS', 'count', (select count(*)::text from trg),
         case when (select count(*) from trg) = 3 then 'PASS'
              else 'FAIL - expected 3 guard triggers' end
  union all
  select 2, 'B. TRIGGERS', tgname || ' on ' || tbl,
         case tgenabled when 'O' then 'enabled (origin)'
                        when 'D' then 'DISABLED'
                        when 'A' then 'enabled (always)'
                        when 'R' then 'enabled (replica)' else tgenabled::text end,
         case when tgenabled in ('O','A') then 'PASS - active'
              else 'FAIL - trigger not active' end
    from trg

  /* ---- C. Lifecycle functions present ------------------------------------ */
  union all
  select 3, 'C. FUNCTIONS', 'count', (select count(*)::text from fns),
         case when (select count(*) from fns) = 7 then 'PASS'
              else 'FAIL - expected 7' end
  union all
  select 3, 'C. FUNCTIONS', proname, 'present', 'PASS' from fns

  /* ---- D. RPC executable by the right roles ONLY -------------------------- */
  union all
  select 4, 'D. RPC PRIVILEGES', f.proname || ' / authenticated',
         has_function_privilege('authenticated', f.oid, 'EXECUTE')::text,
         case when has_function_privilege('authenticated', f.oid, 'EXECUTE')
              then 'PASS - callable by signed-in users'
              else 'FAIL - app cannot call it' end
    from fns f where f.proname in ('set_weekly_report_status','set_monthly_report_status')
  union all
  select 4, 'D. RPC PRIVILEGES', f.proname || ' / anon',
         has_function_privilege('anon', f.oid, 'EXECUTE')::text,
         case when has_function_privilege('anon', f.oid, 'EXECUTE')
              then 'FAIL - anonymous callers can invoke it'
              else 'PASS - anon has no execute' end
    from fns f where f.proname in ('set_weekly_report_status','set_monthly_report_status')

  /* ---- E. Guard bodies actually contain the rule -------------------------- */
  union all
  select 5, 'E. GUARD LOGIC', 'weekly guard checks the token',
         case when pg_get_functiondef(f.oid) like '%eprp.status_change%'
              then 'yes' else 'no' end,
         case when pg_get_functiondef(f.oid) like '%eprp.status_change%'
               and pg_get_functiondef(f.oid) like '%is distinct from old.status%'
              then 'PASS' else 'FAIL - guard body unexpected' end
    from fns f where f.proname = 'guard_weekly_status_change'
  union all
  select 5, 'E. GUARD LOGIC', 'monthly source guard uses shared approved rule',
         case when pg_get_functiondef(f.oid) like '%report_status_is_approved%'
              then 'yes' else 'no' end,
         case when pg_get_functiondef(f.oid) like '%report_status_is_approved%'
              then 'PASS' else 'FAIL - not using the shared definition' end
    from fns f where f.proname = 'guard_monthly_comment_source'

  /* ---- F. Previously compiled Monthly content preserved ------------------- */
  union all
  select 6, 'F. PRESERVED CONTENT', 'Monthly rows from non-approved Weekly',
         (select count(*)::text from public.monthly_comments mc
            join public.weekly_reports w on w.id = mc.source_weekly_report_id
           where w.status not in ('approved','finalized','locked')),
         case when (select count(*) from public.monthly_comments mc
                      join public.weekly_reports w on w.id = mc.source_weekly_report_id
                     where w.status not in ('approved','finalized','locked')) = 4
              then 'PASS - 4 preserved, matches pre-deployment census'
              else 'REVIEW - differs from the census of 4' end
  union all
  select 6, 'F. PRESERVED CONTENT', 'total monthly_comments',
         (select count(*)::text from public.monthly_comments), 'INFO'

  /* ---- G. No policy drift from the Wave-1 baseline ----------------------- */
  union all
  select 7, 'G. POLICY DRIFT', 'total policies', n::text,
         case when n = 101 then 'PASS - unchanged; Wave 2 adds no policies'
              else 'FAIL - policy count moved' end
    from totals
  union all
  select 7, 'G. POLICY DRIFT', 'open policies', (select count(*)::text from open_pol),
         case when (select count(*) from open_pol) = 24 then 'PASS - unchanged'
              else 'FAIL - open policy count moved' end
  union all
  select 7, 'G. POLICY DRIFT', 'write-open policies',
         (select count(*)::text from open_pol where cmd <> 'SELECT'),
         case when (select count(*) from open_pol where cmd <> 'SELECT') = 14
              then 'PASS - no write authority widened' else 'FAIL' end

  /* ---- H. P1 residue still separate and unchanged ------------------------- */
  union all
  select 8, 'H. P1 RESIDUE', o.tablename, o.cmd,
         case when exists (select 1 from known_p1 k where k.t = o.tablename)
              then 'PASS - known P1 (item S1), untouched by P0'
              else 'FAIL - NEW write-open table' end
    from open_pol o where o.cmd <> 'SELECT'

  /* ---- I. Consolidator rule still unified -------------------------------- */
  union all
  select 9, 'I. CONSOLIDATOR RULE', 'weekly_can_manage_project',
         case when pg_get_functiondef(p.oid) like '%is_project_consolidator%'
              then 'delegates' else 'does not delegate' end,
         case when pg_get_functiondef(p.oid) like '%is_project_consolidator%'
               and pg_get_functiondef(p.oid) not like '%project_control_manager_id%'
              then 'PASS - one canonical rule' else 'FAIL' end
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='weekly_can_manage_project'

) t order by seq, check_name, item;
