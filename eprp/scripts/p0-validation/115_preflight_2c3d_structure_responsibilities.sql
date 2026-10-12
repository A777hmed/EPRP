-- EPRP Phase 2C.3D Wave 1 — Other Project Structure Responsibilities: preflight.
--
-- 100% READ-ONLY. Every statement is a SELECT inside a READ ONLY transaction
-- that ends in ROLLBACK. There is no INSERT, UPDATE, DELETE, CREATE, DROP,
-- ALTER or GRANT anywhere in this file. Safe to run repeatedly, before or
-- after 20261012100000_structure_responsibilities.sql.
--
-- Purpose (approved 2026-10-12): show the data the Wave 1 migration lands on.
--   P1  Other projects and whether Weekly / Monthly reporting is enabled
--   P2  their structure units with the Weekly / Monthly flags
--   P3  the active project members available per Other project
--   P4  per active unit: can it be staffed, and will it block completion
--   P5  current PSM / legacy scoped assignments and their membership coverage
--   P6  the malformed fixed-role rows carrying department scope (reported only;
--       Wave 1 and Wave 2 leave them untouched — a data-quality issue)
--   P7  anomaly sweep (every count should be 0)
--   P8  which Wave 1 objects exist (none before the migration, all after)
--   P9  the triggers on the two existing tables Wave 1 adds guards to
--
-- No backfill follows from this: Wave 1 creates no assignment rows.
--
-- HOW TO RUN (local development stack only, from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -v confirm=PREFLIGHT \
--     -f - < scripts/p0-validation/115_preflight_2c3d_structure_responsibilities.sql

\set ON_ERROR_STOP on
\pset pager off
\pset footer off

\if :{?confirm}
\else
  \echo ABORTED - pass -v confirm=PREFLIGHT to run this read-only preflight. Nothing was run.
  \quit
\endif
select (:'confirm' = 'PREFLIGHT') as proceed \gset
\if :proceed
\else
  \echo ABORTED - confirm must be PREFLIGHT. Nothing was run.
  \quit
\endif

begin transaction read only;

\echo
\echo ==================== 0. Target ====================
select current_database() as database,
       inet_server_addr() as server_addr,
       now() as run_at,
       (select max(version) from supabase_migrations.schema_migrations) as migration_head;

\echo
\echo ==================== P1. Other projects ====================
select p.code, p.name, p.status, p.weekly_enabled as weekly_on, p.monthly_enabled as monthly_on
  from public.projects p
 where p.structure_family = 'other'
 order by p.code;

\echo
\echo ==================== P2. Structure units and Weekly / Monthly flags ====================
select p.code, n.level_number as lvl, l.singular_label as level, n.name as unit,
       coalesce(n.code, '-') as unit_code,
       n.weekly_reporting_required as weekly, n.monthly_reporting_required as monthly,
       case when n.archived_at is null then 'active' else 'archived' end as state,
       coalesce(par.name, '-') as parent
  from public.project_structure_nodes n
  join public.projects p on p.id = n.project_id
  join public.project_structure_levels l on l.project_id = n.project_id and l.level_number = n.level_number
  left join public.project_structure_nodes par on par.id = n.parent_id
 order by p.code, (n.archived_at is not null), n.level_number, n.sort_order, n.name;

\echo
\echo ==================== P3. Active project members on Other projects ====================
select p.code, c.name as person,
       coalesce(pp.kind, '(needs party)') as party_kind,
       coalesce(m.project_role, '(needs project role)') as project_role,
       (m.party_id is not null and m.project_role is not null) as eligible_for_accountable_roles,
       coalesce(rt_c.name, '-') as reports_to,
       c.active as person_active
  from public.project_members m
  join public.projects p on p.id = m.project_id and p.structure_family = 'other'
  join public.contacts c on c.id = m.contact_id
  left join public.project_parties pp on pp.id = m.party_id
  left join public.project_members rt on rt.id = m.reports_to_member_id
  left join public.contacts rt_c on rt_c.id = rt.contact_id
 where m.ended_at is null
 order by p.code, c.name;

\echo
\echo ==================== P4. Per active unit: staffing and Wave 1 completion effect ====================
-- A missing Responsible blocks Project Team & Responsibilities only when the
-- project has that report enabled AND the unit is flagged for it.
select p.code, n.name as unit,
       n.weekly_reporting_required as weekly, n.monthly_reporting_required as monthly,
       (select count(*) from public.project_members m
         where m.project_id = n.project_id and m.ended_at is null) as active_project_members,
       (select count(*) from public.project_members m
         where m.project_id = n.project_id and m.ended_at is null
           and m.party_id is not null and m.project_role is not null) as eligible_for_accountable_roles,
       case when (p.weekly_enabled and n.weekly_reporting_required)
              or (p.monthly_enabled and n.monthly_reporting_required)
            then 'BLOCKER until a unit member is assigned as Responsible'
            else 'no reporting responsibility required (missing Lead = warning only)' end as wave1_completion_effect
  from public.project_structure_nodes n
  join public.projects p on p.id = n.project_id
 where n.archived_at is null
 order by p.code, n.level_number, n.name;

\echo
\echo ==================== P5. Current PSM / legacy scoped assignments ====================
select p.code, coalesce(p.structure_family, 'legacy') as family, c.name as person, pc.role as row_kind,
       coalesce(pc.assignment_role, '-') as assignment_role, coalesce(d.name, '-') as department,
       coalesce(s.name, '-') as system, coalesce(dis.name, '-') as scope_item,
       coalesce(rt.name, '-') as reports_to,
       exists (select 1 from public.project_members m
                where m.project_id = pc.project_id and m.contact_id = pc.contact_id
                  and m.ended_at is null) as has_active_membership,
       c.active as person_active
  from public.project_contacts pc
  join public.projects p on p.id = pc.project_id
  join public.contacts c on c.id = pc.contact_id
  left join public.departments d on d.id = pc.department_id
  left join public.systems s on s.id = pc.system_id
  left join public.disciplines dis on dis.id = pc.discipline_id
  left join public.contacts rt on rt.id = pc.reports_to_contact_id
 where pc.department_id is not null or pc.system_id is not null or pc.discipline_id is not null
    or pc.assignment_role is not null or pc.role = 'team_member'
 order by p.code, pc.role, c.name;

\echo
\echo ==================== P6. Malformed rows: fixed-role row kind carrying department scope ====================
-- A fixed-responsibility mirror row (role = project_manager, ...) must carry no
-- scope. These rows carry a department and assignment_role = department_manager:
-- the app groups them as the department's Department Manager, while every
-- database authority predicate requires role = team_member and ignores them.
select p.code, c.name as person, pc.role as row_kind, pc.assignment_role, d.name as department,
       (p.project_manager_id = pc.contact_id) as is_the_project_manager,
       exists (select 1 from public.project_contacts u
                where u.project_id = pc.project_id and u.contact_id = pc.contact_id and u.role = pc.role
                  and u.department_id is null and u.system_id is null and u.discipline_id is null
                  and u.assignment_role is null) as has_unscoped_mirror_row,
       exists (select 1 from public.project_contacts t
                where t.project_id = pc.project_id and t.department_id = pc.department_id
                  and t.role = 'team_member' and t.assignment_role = 'department_manager') as dept_has_real_manager_row,
       pc.created_at::date as created
  from public.project_contacts pc
  join public.projects p on p.id = pc.project_id
  join public.contacts c on c.id = pc.contact_id
  left join public.departments d on d.id = pc.department_id
 where pc.role <> 'team_member'
   and (pc.department_id is not null or pc.system_id is not null
        or pc.discipline_id is not null or pc.assignment_role is not null)
 order by p.code;

\echo
\echo ==================== P7. Anomaly sweep (each count should be 0) ====================
select 'members: active membership of an inactive/archived person' as check_name, count(*) as n
  from public.project_members m join public.contacts c on c.id = m.contact_id
 where m.ended_at is null and (not c.active or c.archived_at is not null)
union all select 'members: party from another project', count(*)
  from public.project_members m join public.project_parties pp on pp.id = m.party_id
 where pp.project_id <> m.project_id
union all select 'members: reports_to in another project', count(*)
  from public.project_members m join public.project_members r on r.id = m.reports_to_member_id
 where r.project_id <> m.project_id
union all select 'members: active member reports to an ended member', count(*)
  from public.project_members m join public.project_members r on r.id = m.reports_to_member_id
 where m.ended_at is null and r.ended_at is not null
union all select 'members: >1 active membership per person per project', count(*)
  from (select 1 from public.project_members where ended_at is null
         group by project_id, contact_id having count(*) > 1) x
union all select 'nodes: parent in another project', count(*)
  from public.project_structure_nodes n join public.project_structure_nodes par on par.id = n.parent_id
 where par.project_id <> n.project_id
union all select 'nodes: active unit under archived parent', count(*)
  from public.project_structure_nodes n join public.project_structure_nodes par on par.id = n.parent_id
 where n.archived_at is null and par.archived_at is not null
union all select 'nodes: archived unit still flagged for input', count(*)
  from public.project_structure_nodes n
 where n.archived_at is not null and (n.weekly_reporting_required or n.monthly_reporting_required)
union all select 'nodes: unit on a non-Other project', count(*)
  from public.project_structure_nodes n join public.projects p on p.id = n.project_id
 where p.structure_family is distinct from 'other'
union all select 'scope rows: department not part of the project', count(*)
  from public.project_contacts pc
 where pc.department_id is not null
   and not exists (select 1 from public.project_departments pd
                    where pd.project_id = pc.project_id and pd.department_id = pc.department_id)
union all select 'scope rows: person inactive/archived', count(*)
  from public.project_contacts pc join public.contacts c on c.id = pc.contact_id
 where pc.department_id is not null and (not c.active or c.archived_at is not null)
union all select 'scope rows: reports_to not on the same project+department', count(*)
  from public.project_contacts pc
 where pc.reports_to_contact_id is not null
   and not exists (select 1 from public.project_contacts o
                    where o.project_id = pc.project_id and o.department_id = pc.department_id
                      and o.contact_id = pc.reports_to_contact_id)
union all select 'scope rows: person without an active project membership', count(*)
  from public.project_contacts pc
 where pc.department_id is not null
   and not exists (select 1 from public.project_members m
                    where m.project_id = pc.project_id and m.contact_id = pc.contact_id and m.ended_at is null)
union all select 'fixed-role / position holders without an active membership', count(*)
  from (select p.id as project_id, h.c as contact_id
          from public.projects p
         cross join lateral (values (p.project_manager_id), (p.project_control_manager_id),
                                    (p.client_representative_id), (p.reporting_coordinator_id),
                                    (p.project_sponsor_id)) h(c)
         where h.c is not null
        union select pp.project_id, pp.contact_id from public.project_positions pp) x
 where not exists (select 1 from public.project_members m
                    where m.project_id = x.project_id and m.contact_id = x.contact_id and m.ended_at is null)
union all select 'fixed-role holders inactive/archived', count(*)
  from public.projects p
 cross join lateral (values (p.project_manager_id), (p.project_control_manager_id),
                            (p.client_representative_id), (p.reporting_coordinator_id),
                            (p.project_sponsor_id)) h(c)
  join public.contacts c on c.id = h.c
 where not c.active or c.archived_at is not null
union all select 'project_delegations rows (any)', count(*) from public.project_delegations
union all select 'project_positions rows (any)', count(*) from public.project_positions;

\echo
\echo ==================== P8. Wave 1 objects present (none before the migration, all after) ====================
select 'table' as kind, c.relname as name
  from pg_catalog.pg_class c join pg_catalog.pg_namespace s on s.oid = c.relnamespace
 where s.nspname = 'public'
   and c.relname in ('project_structure_unit_members', 'project_structure_report_responsibilities')
union all
select 'function', p.proname
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public'
   and p.proname in ('save_structure_unit_responsibilities', 'guard_structure_unit_member_write',
                     'guard_structure_report_responsibility_write', 'check_structure_report_backup',
                     'guard_structure_node_people', 'guard_project_member_unit_assignments')
 order by 1, 2;

\echo
\echo ==================== P9. Triggers on the tables Wave 1 adds guards to ====================
select c.relname as tbl, t.tgname as trigger_name
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and c.relname in ('project_structure_nodes', 'project_members')
 order by 1, 2;

rollback;
