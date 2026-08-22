-- EPRP — POST-P1-A VERIFIER.  100% READ-ONLY.
--
-- 85_verify_p0_closeout.sql encodes the PRE-P1-A baseline (101 policies, 14
-- write-open) and correctly starts failing those two rows once P1-A lands. It
-- keeps its historical meaning; this file states the post-P1-A expectations.
--
-- Every statement is a SELECT. Safe to run against production, and repeatable.
--
--
-- AUTHORITY SCOPE — owner-confirmed 2026-08-22 (architecture 24.3.1)
--   system_admin          = platform-wide, all projects.
--   project_control_admin = PORTFOLIO-WIDE Project Control authority across ALL
--                           projects. Writing another project's setup data is
--                           INTENTIONAL AND CORRECT, not a finding. The 26/26
--                           P1-A matrix result for this role is the expected
--                           result and can_manage_project_setup() must NOT be
--                           narrowed on those grounds.
--   project_control / reporting_coordinator = project-scoped assignments. Their
--                           authority is NOT implemented by P1-A and is out of
--                           this wave's scope.
-- HOW TO RUN
--   Dashboard -> SQL Editor -> New query -> paste -> Run -> export CSV.

with
setup_tbl(t) as (values ('project_departments'),('project_disciplines'),('project_delegations')),
known_p1(t) as (values
  ('clients'),('contacts'),('departments'),('disciplines'),('systems'),
  ('project_types'),('project_phases'),('job_titles'),
  ('organization_charts'),('organization_positions'),('position_assignment_history')),
open_pol as (
  select tablename, cmd from pg_policies
   where schemaname='public' and (qual='true' or with_check='true')),
totals as (select count(*) as n from pg_policies where schemaname='public')

select * from (

  /* A — the P1-A migration applied exactly once ---------------------------- */
  select 1 as seq, 'A. MIGRATION' as check_name, '20260822000002' as item,
         coalesce((select count(*)::text from supabase_migrations.schema_migrations
                    where version='20260822000002'),'0') as value,
         case when (select count(*) from supabase_migrations.schema_migrations
                     where version='20260822000002') = 1
              then 'PASS - applied once' else 'FAIL' end as verdict

  /* B — all three setup tables on ONE predicate (asymmetry resolved) ------- */
  union all
  select 2, 'B. SETUP AUTHORITY', s.t || ' ' || p.cmd,
         coalesce(p.qual, p.with_check, '(none)'),
         case when coalesce(p.qual, p.with_check) like '%can_manage_project_setup%'
              then 'PASS - unified predicate' else 'FAIL - wrong predicate' end
    from setup_tbl s join pg_policies p
      on p.schemaname='public' and p.tablename=s.t and p.cmd <> 'SELECT'

  union all
  select 2, 'B. SETUP AUTHORITY', 'write policies across the three', count(*)::text,
         case when count(*) = 9 then 'PASS - 3 tables x INSERT/UPDATE/DELETE'
              else 'FAIL - expected 9' end
    from pg_policies p join setup_tbl s on s.t = p.tablename
   where p.schemaname='public' and p.cmd <> 'SELECT'

  /* C — replace flows keep INSERT and DELETE together ---------------------- */
  union all
  select 3, 'C. REPLACE FLOWS', s.t,
         (select string_agg(p.cmd, '+' order by p.cmd) from pg_policies p
           where p.schemaname='public' and p.tablename=s.t and p.cmd in ('INSERT','DELETE')),
         case when (select count(*) from pg_policies p
                     where p.schemaname='public' and p.tablename=s.t
                       and p.cmd in ('INSERT','DELETE')) = 2
              then 'PASS - atomic replace possible'
              else 'FAIL - replace would destroy and not restore' end
    from setup_tbl s where s.t in ('project_disciplines','project_delegations')

  /* D — weekly_lifecycle_corrections is read-only -------------------------- */
  union all
  select 4, 'D. LIFECYCLE CORRECTIONS', 'write policies',
         (select count(*)::text from pg_policies
           where schemaname='public' and tablename='weekly_lifecycle_corrections'
             and cmd <> 'SELECT'),
         case when (select count(*) from pg_policies
                     where schemaname='public' and tablename='weekly_lifecycle_corrections'
                       and cmd <> 'SELECT') = 0
              then 'PASS - no write policy, history immutable' else 'FAIL' end
  union all
  select 4, 'D. LIFECYCLE CORRECTIONS', 'select policy',
         (select count(*)::text from pg_policies
           where schemaname='public' and tablename='weekly_lifecycle_corrections'
             and cmd = 'SELECT'),
         case when (select count(*) from pg_policies
                     where schemaname='public' and tablename='weekly_lifecycle_corrections'
                       and cmd='SELECT') = 1
              then 'PASS - still inspectable' else 'FAIL - read lost' end

  /* E — SELECT visibility preserved on all four ---------------------------- */
  union all
  select 5, 'E. SELECT PRESERVED', tablename,
         coalesce(qual,'(none)'),
         case when qual = 'true' then 'PASS - unchanged' else 'FAIL - read narrowed' end
    from pg_policies
   where schemaname='public' and cmd='SELECT'
     and tablename in ('project_departments','project_disciplines',
                       'project_delegations','weekly_lifecycle_corrections')

  /* F — security baseline moved in the RIGHT direction --------------------- */
  union all
  select 6, 'F. BASELINE', 'total policies', n::text,
         case when n = 107 then 'PASS - 101 + 6 from splitting 2 blanket ALL into 4 each'
              else 'REVIEW - expected 107' end
    from totals
  union all
  select 6, 'F. BASELINE', 'write-open policies',
         (select count(*)::text from open_pol where cmd <> 'SELECT'),
         case when (select count(*) from open_pol where cmd <> 'SELECT') = 11
              then 'PASS - was 14, three closed by P1-A'
              else 'FAIL - expected 11' end
  union all
  select 6, 'F. BASELINE', 'open SELECT policies',
         (select count(*)::text from open_pol where cmd = 'SELECT'),
         case when (select count(*) from open_pol where cmd = 'SELECT') = 13
              then 'PASS - 10 + 3 newly explicit reads' else 'REVIEW' end

  /* G — remaining P1 residue, explicitly out of scope ---------------------- */
  union all
  select 7, 'G. P1 RESIDUE (NOT P1-A)', o.tablename, o.cmd,
         case when exists (select 1 from known_p1 k where k.t = o.tablename)
              then 'PASS - deferred to P1-B / P1-C'
              else 'FAIL - unexpected write-open table' end
    from open_pol o where o.cmd <> 'SELECT'

  /* H — Master Milestones / Deliverables untouched ------------------------- */
  union all
  select 8, 'H. REGISTERS UNTOUCHED', tablename || ' ' || cmd,
         coalesce(qual, with_check, '(none)'),
         case when coalesce(qual, with_check) like '%weekly_can_manage_project%'
                or cmd = 'SELECT'
              then 'PASS - unchanged by P1-A' else 'FAIL - register authority moved' end
    from pg_policies
   where schemaname='public'
     and tablename in ('master_milestones','master_deliverables')

) t order by seq, check_name, item;
