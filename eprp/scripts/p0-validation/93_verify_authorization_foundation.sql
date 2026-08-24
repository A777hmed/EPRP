-- EPRP Authorization Foundation Wave 1 — structural verifier.
-- 100% READ-ONLY: every database statement in this file is a SELECT.
-- Expected result: every verdict starts with PASS. Any responsibility-
-- membership exception is a deployment blocker, never an informational row.

\set ON_ERROR_STOP on

with
helper_specs(name, args, result) as (values
  ('current_user_role',                     '',                 'text'),
  ('current_contact_id',                    '',                 'uuid'),
  ('is_system_admin',                       '',                 'boolean'),
  ('is_project_control_admin',              '',                 'boolean'),
  ('has_global_operational_authority',      '',                 'boolean'),
  ('is_project_control_planning',           'uuid',             'boolean'),
  ('is_report_coordinator',                 'uuid',             'boolean'),
  ('is_project_consolidator',               'uuid',             'boolean'),
  ('is_department_user',                    'uuid, uuid',       'boolean'),
  ('can_manage_reporting_workflow',         'uuid',             'boolean'),
  ('can_manage_project_operations',         'uuid',             'boolean'),
  ('can_manage_project_responsibilities',   'uuid',             'boolean'),
  ('can_manage_position_assignment_history','uuid, uuid, uuid','boolean'),
  ('can_edit_department_report_comment',    'uuid, uuid',       'boolean'),
  ('can_manage_calendar',                   '',                 'boolean'),
  ('can_manage_project_executive',          'uuid',             'boolean'),
  ('weekly_can_manage_project',             'uuid',             'boolean'),
  ('monthly_can_manage_project',            'uuid',             'boolean'),
  ('weekly_can_access_project',             'uuid',             'boolean'),
  ('weekly_can_access_scope',               'uuid, uuid, uuid', 'boolean'),
  ('can_create_project',                    '',                 'boolean'),
  ('can_manage_project_setup',              'uuid',             'boolean'),
  ('can_bin_project_document',              'uuid',             'boolean'),
  ('can_reconcile_milestone',               'uuid',             'boolean'),
  ('executive_can_manage',                  '',                 'boolean')
),
trigger_specs(name) as (values
  ('guard_fixed_project_responsibility_membership'),
  ('guard_project_position_membership'),
  ('guard_project_contact_membership_removal')
),
master_tables(name) as (values
  ('clients'), ('project_types'), ('project_phases'), ('departments'),
  ('contacts'), ('systems'), ('disciplines'), ('job_titles')
),
policy_text as (
  select schemaname, tablename, policyname, cmd,
         coalesce(qual, '') || ' ' || coalesce(with_check, '') as predicate
    from pg_policies
)
select * from (

  select 1 as seq, 'A. MIGRATION' as area,
         '20260824000001 applied once' as item,
         case when (
           select count(*)
             from supabase_migrations.schema_migrations
            where version = '20260824000001'
         ) = 1 then 'PASS' else 'FAIL' end as verdict

  union all
  select 2, 'B. HELPERS', 'authorization helper signatures are exact',
         case when (
           select count(*)
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             join helper_specs h
               on h.name = p.proname
              and h.args = pg_catalog.oidvectortypes(p.proargtypes)
              and h.result = pg_catalog.pg_get_function_result(p.oid)
            where n.nspname = 'public'
         ) = (select count(*) from helper_specs)
         then 'PASS' else 'FAIL' end

  union all
  select 2, 'B. HELPERS',
         'authorization helpers are SECURITY DEFINER with empty search_path',
         case when (
           select count(*)
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             join helper_specs h
               on h.name = p.proname
              and h.args = pg_catalog.oidvectortypes(p.proargtypes)
            where n.nspname = 'public'
              and p.prosecdef
              and p.proconfig @> array['search_path=""']::text[]
         ) = (select count(*) from helper_specs)
         then 'PASS' else 'FAIL' end

  union all
  select 2, 'B. HELPERS',
         'project roles resolve from project_contacts only',
         case when (
           select count(*)
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in (
                'is_project_control_planning', 'is_report_coordinator'
              )
              and p.prosrc like '%public.project_contacts%'
              and p.prosrc not like '%public.projects%'
              and p.prosrc not like '%project_positions%'
         ) = 2 then 'PASS' else 'FAIL' end

  union all
  select 2, 'B. HELPERS',
         'authorization helper EXECUTE grants are authenticated/service only',
         case when (
           select count(*)
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             join helper_specs h
               on h.name = p.proname
              and h.args = pg_catalog.oidvectortypes(p.proargtypes)
            where n.nspname = 'public'
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and has_function_privilege('service_role', p.oid, 'EXECUTE')
              and not has_function_privilege('anon', p.oid, 'EXECUTE')
              and not exists (
                select 1
                  from aclexplode(coalesce(
                    p.proacl,
                    acldefault('f', p.proowner)
                  )) acl
                  left join pg_roles granted_role
                    on granted_role.oid = acl.grantee
                 where acl.privilege_type = 'EXECUTE'
                   and acl.grantee <> p.proowner
                   and (
                     acl.grantee = 0
                     or granted_role.rolname not in (
                       'authenticated', 'service_role'
                     )
                   )
              )
         ) = (select count(*) from helper_specs)
         then 'PASS' else 'FAIL' end

  union all
  select 2, 'B. HELPERS',
         'integrity trigger functions are hardened and non-callable',
         case when (
           select count(*)
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             join trigger_specs t on t.name = p.proname
            where n.nspname = 'public'
              and pg_catalog.oidvectortypes(p.proargtypes) = ''
              and pg_catalog.pg_get_function_result(p.oid) = 'trigger'
              and p.prosecdef
              and p.proconfig @> array['search_path=""']::text[]
              and not has_function_privilege('anon', p.oid, 'EXECUTE')
              and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and not has_function_privilege('service_role', p.oid, 'EXECUTE')
         ) = (select count(*) from trigger_specs)
         then 'PASS' else 'FAIL' end

  union all
  select 3, 'C. ASSIGNMENTS',
         'project authority rows cannot carry technical scope',
         case when exists (
           select 1
             from pg_constraint
            where conrelid = 'public.project_contacts'::regclass
              and conname = 'project_contacts_project_authority_unscoped'
              and convalidated
         ) then 'PASS' else 'FAIL' end

  union all
  select 3, 'C. ASSIGNMENTS',
         'Project Responsibility membership triggers are complete',
         case when (
           select count(*)
             from pg_trigger
            where tgname in (
              'trg_project_position_membership',
              'trg_fixed_project_responsibility_membership',
              'trg_project_contact_membership_removal'
            )
              and not tgisinternal
         ) = 3 then 'PASS' else 'FAIL' end

  union all
  select 3, 'C. ASSIGNMENTS',
         'fixed-holder validation covers INSERT/UPDATE and is explicitly deferrable',
         case when exists (
           select 1
             from pg_trigger t
            where t.tgrelid = 'public.projects'::regclass
              and t.tgname = 'trg_fixed_project_responsibility_membership'
              and not t.tgisinternal
              and t.tgconstraint <> 0
              and t.tgdeferrable
              and not t.tginitdeferred
              and pg_get_triggerdef(t.oid) like
                '%AFTER INSERT OR UPDATE ON public.projects DEFERRABLE INITIALLY IMMEDIATE%'
         ) then 'PASS' else 'FAIL' end

  union all
  select 3, 'C. ASSIGNMENTS',
         'fixed Project Responsibilities have same-project membership',
         case when count(*) = 0 then 'PASS'
              else 'FAIL - ' || count(*)::text || ' unresolved row(s)' end
    from public.projects p
    cross join lateral (
      values
        (p.project_manager_id),
        (p.project_control_manager_id),
        (p.client_representative_id),
        (p.reporting_coordinator_id),
        (p.project_sponsor_id)
    ) holder(contact_id)
   where holder.contact_id is not null
     and not exists (
       select 1 from public.project_contacts pc
        where pc.project_id = p.id
          and pc.contact_id = holder.contact_id
     )

  union all
  select 3, 'C. ASSIGNMENTS',
         'project_positions have same-project membership',
         case when count(*) = 0 then 'PASS'
              else 'FAIL - ' || count(*)::text || ' unresolved row(s)' end
    from public.project_positions pp
   where not exists (
     select 1 from public.project_contacts pc
      where pc.project_id = pp.project_id
        and pc.contact_id = pp.contact_id
   )

  union all
  select 3, 'C. ASSIGNMENTS',
         'assignment history position/chart/project scope is canonical',
         case when count(*) = 0 then 'PASS'
              else 'FAIL - ' || count(*)::text || ' unresolved row(s)' end
    from public.position_assignment_history pah
   where not exists (
     select 1
       from public.organization_positions op
       join public.organization_charts oc
         on oc.id = op.chart_id
        and oc.project_id = op.project_id
      where op.id = pah.position_id
        and op.chart_id = pah.chart_id
        and op.project_id = pah.project_id
   )

  union all
  select 3, 'C. ASSIGNMENTS',
         'assignment history has a canonical composite foreign key',
         case when exists (
           select 1
             from pg_constraint
            where conrelid = 'public.position_assignment_history'::regclass
              and conname = 'position_assignment_history_position_chart_project_fk'
              and contype = 'f'
              and convalidated
              and pg_get_constraintdef(oid) like
                '%FOREIGN KEY (position_id, chart_id, project_id) REFERENCES organization_positions(id, chart_id, project_id)%'
         ) then 'PASS' else 'FAIL' end

  union all
  select 3, 'C. ASSIGNMENTS',
         'assignment-history RLS derives authority from canonical scope',
         case when exists (
           select 1
             from policy_text p
            where p.schemaname = 'public'
              and p.tablename = 'position_assignment_history'
              and p.policyname = 'position_assignment_history_insert'
              and p.cmd = 'INSERT'
              and p.predicate like
                '%can_manage_position_assignment_history(position_id, chart_id, project_id)%'
         ) then 'PASS' else 'FAIL' end

  union all
  select 3, 'C. ASSIGNMENTS',
         'new projects support membership-first fixed-holder staging',
         case when exists (
           select 1
             from information_schema.columns
            where table_schema = 'public'
              and table_name = 'projects'
              and column_name = 'project_manager_id'
              and is_nullable = 'YES'
         ) then 'PASS' else 'FAIL' end

  union all
  select 4, 'D. PLATFORM DATA',
         'master-data reads remain open',
         case when (
           select count(*)
             from pg_policies p
             join master_tables t on t.name = p.tablename
            where p.schemaname = 'public'
              and p.cmd = 'SELECT'
              and p.qual = 'true'
         ) = 8 then 'PASS' else 'FAIL' end

  union all
  select 4, 'D. PLATFORM DATA',
         'no master-data blanket write survives',
         case when not exists (
           select 1
             from pg_policies p
             join master_tables t on t.name = p.tablename
            where p.schemaname = 'public'
              and p.cmd <> 'SELECT'
              and (p.qual = 'true' or p.with_check = 'true')
         ) then 'PASS' else 'FAIL' end

  union all
  select 5, 'E. REPORTING',
         'Weekly/Monthly write policies use reporting authority',
         case when (
           select count(*)
             from policy_text p
            where p.schemaname = 'public'
              and p.cmd <> 'SELECT'
              and p.tablename in (
                'weekly_reports', 'weekly_submissions', 'weekly_activities',
                'weekly_entries', 'weekly_plan_items', 'monthly_reports',
                'monthly_comments', 'monthly_department_summaries',
                'monthly_plan_items'
              )
              and p.predicate like '%can_manage_reporting_workflow%'
         ) = 27 then 'PASS' else 'FAIL' end

  union all
  select 5, 'E. REPORTING',
         'Department User Weekly writes are comments only',
         case when (
           select count(*)
             from policy_text p
            where p.schemaname = 'public'
              and p.tablename = 'weekly_entries'
              and p.cmd in ('INSERT', 'UPDATE')
              and p.predicate like '%can_edit_department_report_comment%'
              and p.predicate like '%entry_type%comment%'
         ) = 2 then 'PASS' else 'FAIL' end

  union all
  select 5, 'E. REPORTING',
         'Department User Monthly writes are manual comments only',
         case when (
           select count(*)
             from policy_text p
            where p.schemaname = 'public'
              and p.tablename = 'monthly_comments'
              and p.cmd in ('INSERT', 'UPDATE')
              and p.predicate like '%can_edit_department_report_comment%'
              and p.predicate like '%source_kind%monthly_manual%'
         ) = 2 then 'PASS' else 'FAIL' end

  union all
  select 5, 'E. REPORTING',
         'Department User receives no comment delete policy',
         case when not exists (
           select 1
             from policy_text p
            where p.schemaname = 'public'
              and p.tablename in ('weekly_entries', 'monthly_comments')
              and p.cmd = 'DELETE'
              and p.predicate like '%can_edit_department_report_comment%'
         ) then 'PASS' else 'FAIL' end

  union all
  select 6, 'F. EXECUTIVE',
         'portfolio Executive writes remain global',
         case when (
           select count(*)
             from policy_text p
            where p.schemaname = 'public'
              and p.tablename = 'executive_reports'
              and p.cmd <> 'SELECT'
              and p.predicate like '%executive_can_manage%'
         ) = 3 then 'PASS' else 'FAIL' end

  union all
  select 6, 'F. EXECUTIVE',
         'project Executive notes use assigned reporting authority',
         case when (
           select count(*)
             from policy_text p
            where p.schemaname = 'public'
              and p.tablename = 'executive_notes'
              and p.cmd <> 'SELECT'
              and p.predicate like '%can_manage_project_executive%'
         ) = 3 then 'PASS' else 'FAIL' end

  union all
  select 7, 'G. CALENDAR',
         'all Calendar writes use global Calendar authority',
         case when (
           select count(*)
             from policy_text p
            where p.schemaname = 'public'
              and p.tablename in ('project_events', 'project_event_attendees')
              and p.cmd <> 'SELECT'
              and p.predicate like '%can_manage_calendar%'
         ) = 6 then 'PASS' else 'FAIL' end

  union all
  select 8, 'H. PROJECT OPERATIONS',
         'no unrelated write uses the broad consolidator pair',
         case when not exists (
           select 1
             from policy_text p
            where p.cmd <> 'SELECT'
              and p.tablename not in (
                'weekly_reports', 'weekly_submissions', 'weekly_activities',
                'weekly_entries', 'weekly_plan_items', 'monthly_reports',
                'monthly_comments', 'monthly_department_summaries',
                'monthly_plan_items'
              )
              and (
                p.predicate like '%weekly_can_manage_project%'
                or p.predicate like '%is_project_consolidator%'
              )
         ) then 'PASS' else 'FAIL' end

  union all
  select 8, 'H. PROJECT OPERATIONS',
         'Master registers use Project Operations only',
         case when (
           select count(*)
             from policy_text p
            where p.schemaname = 'public'
              and p.tablename in (
                'master_milestones', 'milestone_updates',
                'master_deliverables', 'deliverable_updates'
              )
              and p.cmd <> 'SELECT'
              and p.predicate like '%can_manage_project_operations%'
              and p.predicate not like '%is_report_coordinator%'
         ) = 8 then 'PASS' else 'FAIL' end

  union all
  select 8, 'H. PROJECT OPERATIONS',
         'project positions grant no authority',
         case when not exists (
           select 1
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in (
                'is_project_control_planning', 'is_report_coordinator',
                'can_manage_project_operations',
                'can_manage_reporting_workflow'
              )
              and p.prosrc like '%project_positions%'
         ) then 'PASS' else 'FAIL' end

) checks
order by seq, area, item;
