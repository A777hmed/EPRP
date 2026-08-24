-- EPRP Reporting Integration Wave 1 — structural verifier.
-- 100% READ-ONLY: every database statement in this file is a SELECT.
-- Expected result: 16 PASS, 0 FAIL.

\set ON_ERROR_STOP on

with checks(seq, area, item, ok) as (
  values
    (1, 'MIGRATION', 'Wave 1 migration applied exactly once',
      (select count(*) = 1
         from supabase_migrations.schema_migrations
        where version = '20260824121615')),

    (2, 'SOURCE CONTRACT', 'Weekly report link and cut-off are required',
      exists (
        select 1
          from pg_constraint
         where conrelid = 'public.milestone_updates'::regclass
           and conname = 'milestone_updates_source_report'
           and convalidated
           and pg_get_constraintdef(oid) like '%weekly_report_id IS NOT NULL%'
           and pg_get_constraintdef(oid) like '%monthly_report_id IS NULL%'
           and pg_get_constraintdef(oid) like '%as_of_date IS NOT NULL%'
      )),

    (3, 'IDEMPOTENCY', 'Weekly key is unique and no Monthly key was introduced',
      exists (
        select 1
          from pg_indexes
         where schemaname = 'public'
           and indexname = 'milestone_updates_weekly_idempotency'
           and indexdef like '%UNIQUE INDEX%'
      )
      and to_regclass('public.milestone_updates_monthly_idempotency') is null),

    (4, 'INTEGRITY', 'Weekly observation guard locks and validates report provenance',
      exists (
        select 1
          from pg_trigger t
          join pg_proc p on p.oid = t.tgfoid
         where t.tgrelid = 'public.milestone_updates'::regclass
           and t.tgname = 'milestone_updates_report_integrity'
           and not t.tgisinternal
           and p.proname = 'guard_milestone_report_observation'
           and p.prosrc like '%for share%'
           and p.prosrc like '%new.as_of_date is distinct from v_period_end%'
      )),

    (5, 'PROVENANCE', 'Weekly parent project and period drift guard is installed',
      exists (
        select 1
          from pg_trigger t
          join pg_proc p on p.oid = t.tgfoid
         where t.tgrelid = 'public.weekly_reports'::regclass
           and t.tgname = 'weekly_report_milestone_provenance_guard'
           and not t.tgisinternal
           and p.proname = 'guard_weekly_report_milestone_provenance'
           and p.prosrc like '%new.project_id is distinct from old.project_id%'
           and p.prosrc like '%new.period_end is distinct from old.period_end%'
           and p.prosrc like '%u.weekly_report_id = old.id%'
      )),

    (6, 'DRAFT', 'Weekly draft identity is milestone-linked with no title column',
      to_regclass('public.weekly_milestone_drafts') is not null
      and exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'weekly_milestone_drafts'
           and column_name = 'milestone_id'
           and is_nullable = 'NO'
      )
      and not exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'weekly_milestone_drafts'
           and column_name = 'title'
      )),

    (7, 'DRAFT', 'draft table has RLS and four operation-specific policies',
      (select relrowsecurity
         from pg_class
        where oid = 'public.weekly_milestone_drafts'::regclass)
      and (select count(*) = 4
             from pg_policies
            where schemaname = 'public'
              and tablename = 'weekly_milestone_drafts'
              and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))),

    (8, 'AUTHORIZATION', 'draft writes use Project Operations authority',
      (select count(*) = 3
         from pg_policies
        where schemaname = 'public'
          and tablename = 'weekly_milestone_drafts'
          and cmd in ('INSERT', 'UPDATE', 'DELETE')
          and (coalesce(qual, '') || coalesce(with_check, ''))
              like '%can_manage_project_operations%')),

    (9, 'CONCURRENCY', 'draft report identity is immutable and mutations lock the original parent',
      exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'guard_weekly_milestone_draft'
           and p.prosrc like '%for update%'
           and p.prosrc like '%new.weekly_report_id is distinct from old.weekly_report_id%'
           and p.prosrc like '%then new.weekly_report_id else old.weekly_report_id%'
      )),

    (10, 'FINALIZATION', 'Weekly finalization has one governed submission trigger',
      (select count(*) = 1
         from pg_trigger t
         join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = 'public.weekly_reports'::regclass
          and not t.tgisinternal
          and p.proname = 'submit_finalized_weekly_milestones')),

    (11, 'GOVERNANCE', 'finalization submits pending and does not auto-approve',
      exists (
        select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'submit_finalized_weekly_milestones'
          and p.prosrc like '%''pending''%'
          and p.prosrc not like '%milestone_update_approval%'
      )),

    (12, 'IDEMPOTENCY', 'retry compares draft content and excludes governed state',
      exists (
        select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'submit_finalized_weekly_milestones'
           and p.prosrc like '%on conflict%do nothing%'
           and p.prosrc like '%v_existing.progress_percent is distinct from v_candidate.progress_percent%'
           and p.prosrc not like '%v_existing.is_regression%'
           and p.prosrc not like '%v_existing.regression_reason%'
           and p.prosrc not like '%v_existing.approval_status%'
           and p.prosrc not like '%v_existing.approved_by_contact_id%'
           and p.prosrc not like '%v_existing.payment_status%'
           and p.prosrc not like '%v_existing.reconciliation_reason%'
           and p.prosrc like '%same report, milestone and cut-off key%'
      )),

    (13, 'HARDENING', 'all four Wave 1 trigger functions are hardened and not callable',
      (select count(*) = 4
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'guard_milestone_report_observation',
            'guard_weekly_report_milestone_provenance',
            'guard_weekly_milestone_draft',
            'submit_finalized_weekly_milestones'
          )
          and pg_get_function_identity_arguments(p.oid) = ''
          and pg_get_function_result(p.oid) = 'trigger'
          and p.prosecdef
          and p.proconfig @> array['search_path=""']::text[]
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and not has_function_privilege('service_role', p.oid, 'EXECUTE'))),

    (14, 'DATA', 'all Weekly observations have same-project cut-off provenance',
      not exists (
        select 1
          from public.milestone_updates u
          join public.master_milestones m on m.id = u.milestone_id
          left join public.weekly_reports w on w.id = u.weekly_report_id
         where u.source = 'weekly'
           and (w.id is null or w.project_id <> m.project_id
                or u.as_of_date <> w.period_end)
      )),

    (15, 'REGRESSION', 'Master Milestone policies still use Operations authority',
      (select count(*) = 4
         from pg_policies
        where schemaname = 'public'
          and (
            (tablename = 'master_milestones' and cmd in ('INSERT', 'UPDATE'))
            or (tablename = 'milestone_updates' and cmd in ('INSERT', 'UPDATE'))
          )
          and (coalesce(qual, '') || coalesce(with_check, ''))
              like '%can_manage_project_operations%')),

    (16, 'MONTHLY WAVE 2', 'no Monthly constraint helper, index or finalization trigger was added',
      to_regclass('public.milestone_updates_monthly_idempotency') is null
      and not exists (
        select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'guard_milestone_report_observation'
          and (p.prosrc like '%monthly_reports%'
               or p.prosrc like '%new.source = ''monthly''%')
      )
      and not exists (
        select 1
          from pg_trigger t
          join pg_proc p on p.oid = t.tgfoid
         where t.tgrelid = 'public.monthly_reports'::regclass
           and not tgisinternal
           and p.proname like '%milestone%'
      ))
)
select seq, area, item, case when ok then 'PASS' else 'FAIL' end as verdict,
       count(*) filter (where ok) over () as pass,
       count(*) filter (where not ok) over () as fail
  from checks
 order by seq;
