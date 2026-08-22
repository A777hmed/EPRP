-- EPRP P0 — PRE-DEPLOYMENT PRE-FLIGHT, SINGLE RESULT SET.  100% READ-ONLY.
--
-- Same seven checks as 80_preflight_readonly.sql, returned as ONE table.
--
-- WHY THIS EXISTS
--   The Supabase SQL Editor returns only the LAST statement's result, so a file
--   of seven separate SELECTs exports only Check 7. This folds all of them into
--   a single UNION so one run and one export captures everything.
--
-- Every statement is a SELECT. No INSERT, UPDATE, DELETE, CREATE, DROP, ALTER,
-- GRANT or REVOKE. Safe to run against production, and safe to repeat.
--
-- HOW TO RUN
--   Dashboard -> SQL Editor -> New query -> paste -> Run -> export CSV.
--
-- HOW TO READ
--   The `verdict` column is the answer. Any row reading NO-GO stops deployment.
--   Rows reading INFO are for the record, not a gate.

with

/* 1. Are the six P0 migrations absent? -------------------------------------- */
c1 as (
  select count(*) as n
    from supabase_migrations.schema_migrations
   where version in ('20260820000001','20260820000002','20260820000003',
                     '20260820000004','20260820000005','20260820000006')
),

/* 2. Is there an active system administrator? ------------------------------- */
c2 as (
  select count(*) as n from public.profiles
   where role = 'system_admin' and active
),

/* 3. Does authenticated hold DML on the tables P0 touches? ------------------ */
c3 as (
  select c.relname as tbl,
         has_table_privilege('authenticated', c.oid, 'SELECT')
         and has_table_privilege('authenticated', c.oid, 'INSERT')
         and has_table_privilege('authenticated', c.oid, 'UPDATE')
         and has_table_privilege('authenticated', c.oid, 'DELETE') as ok
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('projects','project_contacts','weekly_reports',
                       'monthly_reports','master_milestones','weekly_submissions',
                       'monthly_comments','master_deliverables')
),

/* 4. Who gains manage rights from P0.6? ------------------------------------- */
c4 as (
  select pr.code as project, ct.name as person, pc.role as assigned_role
    from public.project_contacts pc
    join public.projects pr on pr.id = pc.project_id
    join public.contacts  ct on ct.id = pc.contact_id
   where pc.role in ('project_control_manager','reporting_coordinator')
     and pc.contact_id is distinct from pr.project_control_manager_id
     and pc.contact_id is distinct from pr.reporting_coordinator_id
),

/* 5. Monthly content sourced from non-approved Weeklies (preserved) --------- */
c5 as (
  select w.status as st, count(*) as n
    from public.monthly_comments mc
    join public.weekly_reports w on w.id = mc.source_weekly_report_id
   where w.status not in ('approved','finalized','locked')
   group by w.status
),

/* 6. What changes visibility ------------------------------------------------ */
c6w as (
  select case when status in ('approved','finalized','locked')
              then 'becomes platform-wide readable'
              else 'stays scoped to assignees' end as eff,
         count(*) as n
    from public.weekly_reports group by 1
),
c6m as (
  select case when status in ('approved','finalized','locked')
              then 'becomes platform-wide readable'
              else 'stays scoped to assignees' end as eff,
         count(*) as n
    from public.monthly_reports group by 1
),
c6n as (
  select case when project_id is null
              then 'portfolio note - loses general visibility'
              else 'project note - unchanged' end as eff,
         count(*) as n
    from public.executive_notes group by 1
),

/* 7. Policy baseline -------------------------------------------------------- */
c7 as (
  select count(*) as total,
         count(*) filter (where qual = 'true' or with_check = 'true') as open_n
    from pg_policies where schemaname = 'public'
),
c7open as (
  select tablename, cmd
    from pg_policies
   where schemaname = 'public' and (qual = 'true' or with_check = 'true')
)

select * from (
  select 1 as seq, '1. ALREADY APPLIED' as check_name, 'P0 migrations found' as item,
         n::text as value,
         case when n = 0 then 'PASS' else 'NO-GO - already deployed' end as verdict
    from c1

  union all
  select 2, '2. ACTIVE SYSTEM ADMINS', 'active system_admin profiles',
         n::text,
         case when n >= 1 then 'PASS' else 'NO-GO - migrations will abort' end
    from c2

  union all
  select 3, '3. TABLE GRANTS', tbl,
         case when ok then 'SELECT/INSERT/UPDATE/DELETE' else 'incomplete' end,
         case when ok then 'PASS' else 'NO-GO - MISSING DML' end
    from c3

  union all
  select 4, '4. GAINS MANAGE RIGHTS (P0.6)', 'count',
         (select count(*)::text from c4),
         case when (select count(*) from c4) = 0 then 'PASS - no-op on your data'
              else 'REVIEW - confirm you recognise every name below' end

  union all
  select 4, '4. GAINS MANAGE RIGHTS (P0.6)', project || ' / ' || person,
         assigned_role, 'REVIEW'
    from c4

  union all
  select 5, '5. PRESERVED MONTHLY ROWS', 'source weekly status: ' || st,
         n::text, 'INFO - never deleted'
    from c5

  union all
  select 5, '5. PRESERVED MONTHLY ROWS', 'total',
         coalesce((select sum(n)::text from c5), '0'), 'INFO - never deleted'

  union all
  select 6, '6a. WEEKLY VISIBILITY', eff, n::text, 'INFO' from c6w
  union all
  select 6, '6b. MONTHLY VISIBILITY', eff, n::text, 'INFO' from c6m
  union all
  select 6, '6c. EXECUTIVE NOTES', eff, n::text, 'INFO - locked decision 24.2.3' from c6n

  union all
  select 7, '7. POLICY BASELINE', 'total policies', total::text,
         case when total = 96 then 'PASS - matches backup' else 'REVIEW - drifted from backup' end
    from c7
  union all
  select 7, '7. POLICY BASELINE', 'unconditionally open', open_n::text,
         case when open_n = 17 then 'PASS - 14 known P1 + 2 closed by P0.1 + 1 by P0.2'
              else 'REVIEW - differs from the reconciled 17' end
    from c7
  union all
  select 7, '7. POLICY BASELINE', 'open: ' || tablename, cmd, 'INFO'
    from c7open
) t
order by seq, check_name, item;
