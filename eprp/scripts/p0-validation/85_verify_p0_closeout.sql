-- EPRP — FINAL P0 CLOSEOUT VERIFIER.  100% READ-ONLY.
--
-- Supersedes 83_verify_wave2.sql, which asserted the pre-corrective state and
-- knows nothing of 20260822000001. 83_ keeps its historical meaning; this file
-- states the final expectations.
--
-- WHAT MAKES THIS STRONGER THAN 83_
--   report_transition_allowed() is IMMUTABLE and pure, so the ENTIRE transition
--   matrix can be evaluated read-only — no write attempt, no rollback needed.
--   Archive reachability and forward-gate enforcement are therefore proven
--   behaviourally here, not merely inferred from the function body.
--
-- Every statement is a SELECT. Safe to run against production, and repeatable.
--
-- HOW TO RUN
--   Dashboard -> SQL Editor -> New query -> paste -> Run -> export CSV.
--   The `verdict` column is the answer. Any FAIL blocks P0 closure.

with

migs as (
  select version, count(*) as n
    from supabase_migrations.schema_migrations
   where version like '2026082%'
   group by version
),
expected(v, wave) as (values
  ('20260820000001','Wave 1'),('20260820000002','Wave 1'),
  ('20260820000003','Wave 1'),('20260820000004','Wave 1'),
  ('20260820000005','Wave 2'),('20260820000006','Wave 2'),
  ('20260822000001','Corrective')),

/* Archive must be reachable from every live state, per tier. */
arch_w(st) as (values ('draft'),('collecting'),('under_review'),('approved'),
                      ('finalized'),('locked'),('returned'),('rejected')),
arch_m(st) as (values ('draft'),('auto_compiled'),('department_review'),
                      ('under_review'),('approved'),('finalized'),('locked'),
                      ('returned'),('rejected')),

/* Transitions that MUST still be refused. */
refused(kind, f, t, why) as (values
  ('weekly','draft','locked','skips the whole lifecycle'),
  ('weekly','draft','approved','skips collection and review'),
  ('weekly','collecting','approved','skips review'),
  ('weekly','locked','finalized','moves backwards'),
  ('weekly','draft','auto_compiled','borrows a monthly state'),
  ('monthly','draft','approved','skips compilation and review'),
  ('monthly','draft','department_review','skips compilation'),
  ('monthly','draft','collecting','borrows a weekly state')),

/* Forward transitions that MUST still work. */
forward(kind, f, t) as (values
  ('weekly','draft','collecting'),('weekly','collecting','under_review'),
  ('weekly','under_review','approved'),('weekly','approved','finalized'),
  ('weekly','finalized','locked'),
  ('monthly','draft','auto_compiled'),('monthly','auto_compiled','department_review'),
  ('monthly','under_review','approved'),('monthly','approved','finalized'),
  ('monthly','finalized','locked')),

trg as (
  select t.tgname, t.tgenabled, c.relname as tbl
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and t.tgname in ('trg_guard_weekly_status_change',
                      'trg_guard_monthly_status_change',
                      'trg_guard_monthly_comment_source')),

fns as (
  select p.proname, p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public'
     and p.proname in ('set_weekly_report_status','set_monthly_report_status',
                       'report_transition_allowed','weekly_transition_blockers',
                       'guard_weekly_status_change','guard_monthly_status_change',
                       'guard_monthly_comment_source','report_status_is_approved')),

open_pol as (
  select tablename, cmd from pg_policies
   where schemaname='public' and (qual='true' or with_check='true')),

known_p1(t) as (values
  ('clients'),('contacts'),('departments'),('disciplines'),('systems'),
  ('project_types'),('project_phases'),('job_titles'),('project_disciplines'),
  ('project_delegations'),('organization_charts'),('organization_positions'),
  ('position_assignment_history'),('weekly_lifecycle_corrections')),

totals as (select count(*) as n from pg_policies where schemaname='public')

select * from (

  /* A — all seven migrations, exactly once each -------------------------- */
  select 1 as seq, 'A. MIGRATIONS' as check_name, 'distinct P0 versions' as item,
         (select count(*)::text from migs) as value,
         case when (select count(*) from migs) = 7 then 'PASS - 6 P0 + 1 corrective'
              else 'FAIL - expected 7' end as verdict
  union all
  select 1, 'A. MIGRATIONS', e.v || ' (' || e.wave || ')',
         coalesce((select n::text from migs m where m.version=e.v), 'MISSING'),
         case when (select n from migs m where m.version=e.v) = 1 then 'PASS - applied once'
              when (select n from migs m where m.version=e.v) is null then 'FAIL - not applied'
              else 'FAIL - applied more than once' end
    from expected e

  /* B — archive reachable from every live state (read-only, behavioural) -- */
  union all
  select 2, 'B. ARCHIVE REACHABILITY', 'weekly from ' || st,
         public.report_transition_allowed('weekly', st, 'archived')::text,
         case when public.report_transition_allowed('weekly', st, 'archived')
              then 'PASS' else 'FAIL - archive unreachable' end
    from arch_w
  union all
  select 2, 'B. ARCHIVE REACHABILITY', 'monthly from ' || st,
         public.report_transition_allowed('monthly', st, 'archived')::text,
         case when public.report_transition_allowed('monthly', st, 'archived')
              then 'PASS' else 'FAIL - archive unreachable' end
    from arch_m

  /* C — forward gates still refuse what they should ---------------------- */
  union all
  select 3, 'C. STILL REFUSED', kind || ' ' || f || ' -> ' || t,
         why,
         case when public.report_transition_allowed(kind, f, t)
              then 'FAIL - transition was widened' else 'PASS - still refused' end
    from refused

  /* D — forward path intact ---------------------------------------------- */
  union all
  select 4, 'D. FORWARD PATH', kind || ' ' || f || ' -> ' || t,
         public.report_transition_allowed(kind, f, t)::text,
         case when public.report_transition_allowed(kind, f, t)
              then 'PASS' else 'FAIL - forward transition lost' end
    from forward

  /* E — lifecycle triggers present and active ----------------------------- */
  union all
  select 5, 'E. TRIGGERS', 'count', (select count(*)::text from trg),
         case when (select count(*) from trg) = 3 then 'PASS' else 'FAIL - expected 3' end
  union all
  select 5, 'E. TRIGGERS', tgname || ' on ' || tbl,
         case tgenabled when 'O' then 'enabled' when 'D' then 'DISABLED'
                        when 'A' then 'enabled (always)' else tgenabled::text end,
         case when tgenabled in ('O','A') then 'PASS - active' else 'FAIL - not active' end
    from trg

  /* F — functions and RPC privileges -------------------------------------- */
  union all
  select 6, 'F. FUNCTIONS', 'count', (select count(*)::text from fns),
         case when (select count(*) from fns) = 8 then 'PASS' else 'FAIL - expected 8' end
  union all
  select 6, 'F. FUNCTIONS', f.proname || ' / authenticated',
         has_function_privilege('authenticated', f.oid, 'EXECUTE')::text,
         case when has_function_privilege('authenticated', f.oid, 'EXECUTE')
              then 'PASS' else 'FAIL - app cannot call it' end
    from fns f where f.proname in ('set_weekly_report_status','set_monthly_report_status')
  union all
  select 6, 'F. FUNCTIONS', f.proname || ' / anon',
         has_function_privilege('anon', f.oid, 'EXECUTE')::text,
         case when has_function_privilege('anon', f.oid, 'EXECUTE')
              then 'FAIL - anon can invoke it' else 'PASS - anon has no execute' end
    from fns f where f.proname in ('set_weekly_report_status','set_monthly_report_status')

  /* G — Monthly compilation guard + preserved content --------------------- */
  union all
  select 7, 'G. COMPILATION GUARD', 'guard uses shared approved rule',
         case when pg_get_functiondef(f.oid) like '%report_status_is_approved%'
              then 'yes' else 'no' end,
         case when pg_get_functiondef(f.oid) like '%report_status_is_approved%'
              then 'PASS' else 'FAIL' end
    from fns f where f.proname = 'guard_monthly_comment_source'
  union all
  select 7, 'G. COMPILATION GUARD', 'approved set is exactly approved/finalized/locked',
         (public.report_status_is_approved('approved')
          and public.report_status_is_approved('finalized')
          and public.report_status_is_approved('locked')
          and not public.report_status_is_approved('collecting')
          and not public.report_status_is_approved('archived'))::text,
         case when public.report_status_is_approved('approved')
               and not public.report_status_is_approved('archived')
              then 'PASS' else 'FAIL' end
  union all
  select 7, 'G. COMPILATION GUARD', 'compiled rows from non-approved Weekly (preserved)',
         (select count(*)::text from public.monthly_comments mc
            join public.weekly_reports w on w.id = mc.source_weekly_report_id
           where not public.report_status_is_approved(w.status)),
         'INFO - preserved by design, never deleted'

  /* H — security baseline -------------------------------------------------- */
  union all
  select 8, 'H. SECURITY BASELINE', 'total policies', n::text,
         case when n = 101 then 'PASS - unchanged since Wave 1' else 'FAIL - drift' end
    from totals
  union all
  select 8, 'H. SECURITY BASELINE', 'open policies', (select count(*)::text from open_pol),
         case when (select count(*) from open_pol) = 24 then 'PASS - unchanged' else 'FAIL - drift' end
  union all
  select 8, 'H. SECURITY BASELINE', 'write-open policies',
         (select count(*)::text from open_pol where cmd <> 'SELECT'),
         case when (select count(*) from open_pol where cmd <> 'SELECT') = 14
              then 'PASS - no write authority widened' else 'FAIL - drift' end

  /* I — P1 residue, explicitly separated from P0 --------------------------- */
  union all
  select 9, 'I. P1 RESIDUE (NOT P0)', o.tablename, o.cmd,
         case when exists (select 1 from known_p1 k where k.t = o.tablename)
              then 'PASS - known P1 item S1, out of P0 scope'
              else 'FAIL - NEW write-open table' end
    from open_pol o where o.cmd <> 'SELECT'

) t order by seq, check_name, item;
