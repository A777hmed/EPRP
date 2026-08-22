-- EPRP P0 — PRE-DEPLOYMENT PRE-FLIGHT.  100% READ-ONLY.
--
-- Every statement is a SELECT. There is no INSERT, UPDATE, DELETE, CREATE,
-- DROP, ALTER or GRANT anywhere in this file. It is safe to run against the
-- hosted project, and safe to run repeatedly.
--
-- WHERE TO RUN IT
--   Supabase Dashboard -> SQL Editor -> paste -> Run.
--   No password or CLI needed; the dashboard is already authenticated.
--
-- WHAT IT ANSWERS
--   Six questions that decide whether P0 should be deployed, and what it will
--   do when it is. Read every answer before deciding.

/* ---------------------------------------------------------------------------
   1. ARE THE SIX P0 MIGRATIONS ACTUALLY ABSENT?
   Expect exactly 0 rows. Anything returned here is already applied, and the
   deployment set is smaller than assumed.
--------------------------------------------------------------------------- */
select '1. ALREADY APPLIED (expect none)' as check, version
  from supabase_migrations.schema_migrations
 where version in ('20260820000001','20260820000002','20260820000003',
                   '20260820000004','20260820000005','20260820000006')
 order by version;

/* ---------------------------------------------------------------------------
   2. IS THERE AN ACTIVE SYSTEM ADMINISTRATOR?
   Four of the six migrations refuse to run without one. Expect >= 1.
   If this returns 0, deployment aborts safely -- but fix it first rather than
   discovering it mid-run.
--------------------------------------------------------------------------- */
select '2. ACTIVE SYSTEM ADMINS' as check,
       count(*) as active_admins,
       case when count(*) = 0 then 'BLOCKER - migrations will abort'
            else 'ok' end as verdict
  from public.profiles where role = 'system_admin' and active;

/* ---------------------------------------------------------------------------
   3. DOES THE HOSTED PROJECT HAVE TABLE GRANTS?  (KNOWN_LIMITATIONS 3.10)
   The migration set contains no GRANT statements; the platform supplies them.
   This confirms that is true HERE, which is the assumption P0 rests on.
   Expect every row to say 'ok'. Any 'MISSING DML' row means the schema is not
   in the state the application needs, independent of P0.
--------------------------------------------------------------------------- */
select '3. TABLE GRANTS' as check,
       c.relname as table_name,
       case when has_table_privilege('authenticated', c.oid, 'SELECT')
             and has_table_privilege('authenticated', c.oid, 'INSERT')
             and has_table_privilege('authenticated', c.oid, 'UPDATE')
            then 'ok' else 'MISSING DML' end as verdict
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and c.relname in ('projects','project_contacts','weekly_reports',
                     'monthly_reports','master_milestones')
 order by c.relname;

/* ---------------------------------------------------------------------------
   4. P0.6 IMPACT — WHO GAINS MANAGE RIGHTS?
   P0.6 is the only P0 step that WIDENS authority. These are the assignments
   that gain it: a consolidation role held through project_contacts that is not
   mirrored by the project's own column.
   Expect 0 rows if the application wrote every assignment. Review any row.
--------------------------------------------------------------------------- */
select '4. GAINS MANAGE RIGHTS' as check,
       pr.code as project, c.name as person, pc.role as assigned_role
  from public.project_contacts pc
  join public.projects pr on pr.id = pc.project_id
  join public.contacts  c  on c.id  = pc.contact_id
 where pc.role in ('project_control_manager','reporting_coordinator')
   and pc.contact_id is distinct from pr.project_control_manager_id
   and pc.contact_id is distinct from pr.reporting_coordinator_id
 order by pr.code, c.name;

/* ---------------------------------------------------------------------------
   5. P0.4 IMPACT — MONTHLY CONTENT FROM NON-APPROVED WEEKLIES.
   These rows are PRESERVED, never deleted. This is the census the architecture
   requires so the number is known rather than discovered later.
--------------------------------------------------------------------------- */
select '5. PRESERVED MONTHLY ROWS' as check,
       w.status as source_weekly_status,
       count(*) as rows_preserved
  from public.monthly_comments mc
  join public.weekly_reports w on w.id = mc.source_weekly_report_id
 where w.status not in ('approved','finalized','locked')
 group by w.status
 order by count(*) desc;

/* ---------------------------------------------------------------------------
   6. P0.2 IMPACT — WHAT BECOMES VISIBLE PLATFORM-WIDE.
   Approved reports become readable by every authenticated account. Unapproved
   ones stay scoped. This is how much content changes visibility.
--------------------------------------------------------------------------- */
select '6a. WEEKLY VISIBILITY' as check,
       case when status in ('approved','finalized','locked')
            then 'becomes platform-wide readable'
            else 'stays scoped to assignees' end as effect,
       count(*) as reports
  from public.weekly_reports group by 2 order by 3 desc;

select '6b. MONTHLY VISIBILITY' as check,
       case when status in ('approved','finalized','locked')
            then 'becomes platform-wide readable'
            else 'stays scoped to assignees' end as effect,
       count(*) as reports
  from public.monthly_reports group by 2 order by 3 desc;

select '6c. EXECUTIVE NOTES NARROWING' as check,
       case when project_id is null
            then 'portfolio note - LOSES general visibility, Executive roles only'
            else 'project note - unchanged' end as effect,
       count(*) as notes
  from public.executive_notes group by 2 order by 3 desc;

/* ---------------------------------------------------------------------------
   7. BASELINE FOR COMPARISON.
   Capture this BEFORE and AFTER. The counts should change only on the tables
   P0 touches, and no write policy should become unconditionally open.
--------------------------------------------------------------------------- */
select '7. POLICY BASELINE' as check,
       tablename, cmd, count(*) as policies,
       count(*) filter (where qual = 'true' or with_check = 'true') as unconditionally_open
  from pg_policies
 where schemaname = 'public'
 group by tablename, cmd
 order by tablename, cmd;
