-- Phase 13.9B — Project Setup Governance — PREFLIGHT. LOCAL DATABASE ONLY.
--
-- READ-ONLY. Runs inside a READ ONLY transaction that is rolled back: it
-- cannot write, and it changes nothing. Run it BEFORE the 13.9B Step 1
-- migration (20261016090000_project_setup_governance_core.sql) to see how the
-- existing data meets the new rules, and again afterwards if useful (the
-- "13.9B objects absent" checks then report the migration as applied).
--
-- Verdicts:
--   PASS — the condition the migration relies on holds
--   FAIL — a blocker: the migration must not be applied until it is resolved
--   WARN — not a blocker, but a data condition the owner should know about
--   INFO — a count or list for the step report
--
-- HOW TO RUN (from eprp/; the APP database container, never the restore one):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/122_preflight_13_9b_setup_governance.sql

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception 'REFUSING TO RUN: this connection is not local (server address %).',
      host(inet_server_addr());
  end if;
end;
$guard$;

-- Session-local scratch objects (pg_temp only; they vanish with the session).
-- PostgreSQL refuses CREATE inside a READ ONLY transaction, so they are made
-- first; every check below then runs READ ONLY (writing a temp table is the
-- one write a read-only transaction allows).
create temp table f(seq int, area text, item text, verdict text, detail text);

create or replace function pg_temp.out(
  p_seq int, p_area text, p_item text, p_verdict text, p_detail text default ''
) returns void language sql as $$
  insert into f values (p_seq, p_area, p_item, p_verdict, coalesce(p_detail, ''));
$$;

-- Snapshot-anchored projects: Controlled from the moment Step 1 ships.
create temp view controlled as
  select p.*, (select min(s.published_at) from public.planning_snapshots s where s.project_id = p.id) as controlled_since
    from public.projects p
   where exists (select 1 from public.planning_snapshots s where s.project_id = p.id);

begin transaction read only;

do $checks$
declare
  v_n bigint;
  v_list text;
  -- Every projects column must be classified by the 13.9B registry or be a
  -- system column. An unclassified column would be unguarded after Controlled.
  v_classified constant text[] := array[
    -- free / logged
    'status', 'current_phase_id', 'portfolio_group_id', 'description',
    'project_manager_id', 'project_control_manager_id', 'client_representative_id',
    'reporting_coordinator_id', 'project_sponsor_id', 'site', 'country', 'city',
    'client_contact_name', 'client_contact_email', 'client_contact_phone',
    'project_logo_ref', 'client_logo_ref', 'report_header_title', 'report_footer_text',
    'report_reference_prefix', 'default_language', 'include_qr_code', 'include_signature_section',
    -- lightweight
    'name', 'short_name', 'contract_number', 'purchase_order_number',
    'actual_start_date', 'actual_finish_date',
    -- governed
    'code', 'client_id', 'project_type_id', 'project_category_detail',
    'weekly_enabled', 'monthly_enabled', 'executive_enabled', 'weekly_reporting_day',
    'monthly_cutoff_day', 'working_week', 'time_zone', 'currency', 'milestone_update_approval',
    'contract_start_date', 'forecast_finish_date', 'planned_start_date', 'planned_finish_date',
    -- system administrator correction
    'structure_family',
    -- retired
    'priority', 'overall_status', 'planned_progress', 'actual_progress'];
  v_system constant text[] := array['id', 'active', 'archived_at', 'created_at', 'updated_at'];
begin
  /* ------------------------------ 0 identity ------------------------------ */
  perform pg_temp.out(0, '00 IDENTITY', 'database / server',
    'INFO', current_database() || ' · ' || split_part(version(), ' on ', 1)
            || ' · server address ' || coalesce(host(inet_server_addr()), 'local socket'));
  select max(version) into v_list from supabase_migrations.schema_migrations;
  perform pg_temp.out(0, '00 IDENTITY', 'latest applied migration', 'INFO', coalesce(v_list, 'none'));
  perform pg_temp.out(0, '00 IDENTITY', 'Phase 13.9 archived guard migration is applied',
    case when exists (select 1 from supabase_migrations.schema_migrations where version = '20261014090000')
         then 'PASS' else 'FAIL' end, '20261014090000');

  /* ------------------------- 1 prerequisites ------------------------------ */
  perform pg_temp.out(1, '01 PREREQUISITES', 'guard_archived_project_setup() exists (2C.3E)',
    case when to_regprocedure('public.guard_archived_project_setup()') is not null then 'PASS' else 'FAIL' end);
  perform pg_temp.out(1, '01 PREREQUISITES', 'guard_archived_project_update() is installed on projects',
    case when exists (select 1 from pg_trigger where tgname = 'block_archived_project_setup'
                       and tgrelid = 'public.projects'::regclass) then 'PASS' else 'FAIL' end);
  perform pg_temp.out(1, '01 PREREQUISITES', 'guard_archived_project_planning() is installed on project_planning_settings and planning_snapshots',
    case when (select count(*) from pg_trigger where tgname = 'block_archived_project_planning'
                and tgrelid in ('public.project_planning_settings'::regclass, 'public.planning_snapshots'::regclass)) = 2
         then 'PASS' else 'FAIL' end);
  perform pg_temp.out(1, '01 PREREQUISITES', 'the Project Setup advisory lock trigger exists',
    case when exists (select 1 from pg_trigger where tgname = 'lock_project_setup_statement'
                       and tgrelid = 'public.projects'::regclass) then 'PASS' else 'FAIL' end);
  perform pg_temp.out(1, '01 PREREQUISITES', 'the Project Type correction path and its audit table exist (2C.1)',
    case when to_regprocedure('public.correct_project_structure_family(uuid,timestamp with time zone,text,uuid,text,text)') is not null
          and to_regclass('public.project_classification_corrections') is not null then 'PASS' else 'FAIL' end);
  select count(*) into v_n from pg_proc where proname = 'publish_planning_snapshot'
     and pronamespace = 'public'::regnamespace;
  select string_agg(oid::regprocedure::text, ', ') into v_list from pg_proc
   where proname = 'publish_planning_snapshot' and pronamespace = 'public'::regnamespace;
  perform pg_temp.out(1, '01 PREREQUISITES', 'publish_planning_snapshot() has one overload (pre-13.9B 7-argument or post-13.9B 8-argument)',
    case when v_n = 1 and (v_list = 'publish_planning_snapshot(uuid,uuid,uuid,boolean,text,uuid,date)'
                           or v_list = 'publish_planning_snapshot(uuid,uuid,uuid,boolean,text,uuid,date,boolean)')
         then 'PASS' else 'FAIL' end, v_list);
  perform pg_temp.out(1, '01 PREREQUISITES', 'authority predicates exist (setup, operations, global, access)',
    case when to_regprocedure('public.can_manage_project_setup(uuid)') is not null
          and to_regprocedure('public.can_manage_project_operations(uuid)') is not null
          and to_regprocedure('public.has_global_operational_authority()') is not null
          and to_regprocedure('public.can_access_project(uuid)') is not null then 'PASS' else 'FAIL' end);

  /* ------------------ 2 13.9B object names (collision check) -------------- */
  select string_agg(n, ', ') into v_list from (
    select c.relname::text n from pg_class c where c.relnamespace = 'public'::regnamespace
       and c.relname in ('project_setup_amendments', 'project_setup_field_changes',
                         'project_setup_finalisations', 'project_reported_progress')
    union all
    select p.proname::text from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('project_setup_field_registry', 'project_setup_controlled_since',
                         'project_setup_controlled', 'request_project_setup_amendment',
                         'decide_project_setup_amendment', 'withdraw_project_setup_amendment',
                         'guard_project_setup_controlled', 'guard_planning_settings_setup_controlled',
                         'project_onboarding_transition_rule', 'guard_project_setup_amendment_history',
                         'finalise_project_setup', 'record_reported_progress', 'correct_reported_progress',
                         'withdraw_reported_progress')
  ) x;
  perform pg_temp.out(2, '02 13.9B OBJECTS', '13.9B tables / functions are absent before the migrations',
    case when v_list is null then 'PASS' else 'INFO' end,
    coalesce('present (migration already applied?): ' || v_list, 'none present'));

  /* ------------------------ 3 column classification ----------------------- */
  select string_agg(column_name, ', ' order by ordinal_position) into v_list
    from information_schema.columns
   where table_schema = 'public' and table_name = 'projects'
     and not (column_name = any (v_classified) or column_name = any (v_system));
  perform pg_temp.out(3, '03 REGISTRY COVERAGE', 'every projects column is classified by the registry or is a system column',
    case when v_list is null then 'PASS' else 'FAIL' end, coalesce('unclassified: ' || v_list, 'all classified'));
  select string_agg(c, ', ') into v_list from unnest(v_classified) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'projects' and column_name = c);
  perform pg_temp.out(3, '03 REGISTRY COVERAGE', 'every registry column exists on projects',
    case when v_list is null then 'PASS' else 'FAIL' end, coalesce('missing: ' || v_list, 'all exist'));
  perform pg_temp.out(3, '03 REGISTRY COVERAGE', 'project_planning_settings.onboarding_mode exists with the three values',
    case when exists (select 1 from information_schema.columns where table_schema = 'public'
                       and table_name = 'project_planning_settings' and column_name = 'onboarding_mode')
          and exists (select 1 from pg_constraint where conname = 'project_planning_settings_onboarding_mode_valid')
         then 'PASS' else 'FAIL' end);

  /* -------------------------- 4 Controlled at rollout --------------------- */
  select count(*), string_agg(code || ' (since ' || to_char(controlled_since, 'YYYY-MM-DD') || ')', ', ' order by code)
    into v_n, v_list from controlled;
  perform pg_temp.out(4, '04 CONTROLLED AT ROLLOUT', 'projects Controlled by an existing Published Planning Snapshot',
    'INFO', v_n || coalesce(': ' || v_list, ''));
  select count(*) into v_n from public.projects;
  perform pg_temp.out(4, '04 CONTROLLED AT ROLLOUT', 'projects not Controlled (setup edits behave exactly as today)',
    'INFO', (v_n - (select count(*) from controlled))::text || ' of ' || v_n);
  select count(*), string_agg(code, ', ' order by code) into v_n, v_list from controlled where status = 'archived';
  perform pg_temp.out(4, '04 CONTROLLED AT ROLLOUT', 'Controlled projects that are archived (read-only either way)',
    'INFO', v_n || coalesce(': ' || v_list, ''));
  select count(*), string_agg(code, ', ' order by code) into v_n, v_list from controlled where structure_family is null;
  perform pg_temp.out(4, '04 CONTROLLED AT ROLLOUT', 'Controlled projects with no Project Type (structure_family) yet',
    case when v_n = 0 then 'PASS' else 'WARN' end,
    v_n || coalesce(': ' || v_list || ' — the family can still be set once; a Project Category change then needs a governed amendment', ''));

  /* ------------------------ 5 onboarding / settings ----------------------- */
  select count(*), string_agg(code, ', ' order by code) into v_n, v_list
    from public.projects p where not exists (select 1 from public.project_planning_settings s where s.project_id = p.id);
  perform pg_temp.out(5, '05 ONBOARDING', 'projects with no project_planning_settings row (they read the column default new_project)',
    'INFO', v_n || coalesce(': ' || v_list, ''));
  select count(*), string_agg(code, ', ' order by code) into v_n, v_list
    from controlled c where not exists (select 1 from public.project_planning_settings s where s.project_id = c.id);
  perform pg_temp.out(5, '05 ONBOARDING', 'Controlled projects with no settings row (a first INSERT that changes the mode will be governed)',
    'INFO', v_n || coalesce(': ' || v_list, ''));
  select string_agg(onboarding_mode || ' ' || n, ' · ' order by onboarding_mode) into v_list
    from (select onboarding_mode, count(*) n from public.project_planning_settings group by 1) x;
  perform pg_temp.out(5, '05 ONBOARDING', 'onboarding modes in use', 'INFO', coalesce(v_list, 'no settings rows'));
  select count(*), string_agg(p.code, ', ' order by p.code) into v_n, v_list
    from public.project_planning_settings s join public.projects p on p.id = s.project_id
   where s.onboarding_mode = 'no_formal_schedule';
  perform pg_temp.out(5, '05 ONBOARDING', 'no_formal_schedule projects (publish / promote refused from Step 1)',
    'INFO', v_n || coalesce(': ' || v_list, ''));
  select count(*), string_agg(c.code, ', ' order by c.code) into v_n, v_list
    from controlled c join public.project_planning_settings s on s.project_id = c.id
   where s.onboarding_mode = 'no_formal_schedule';
  perform pg_temp.out(5, '05 ONBOARDING', 'no_formal_schedule projects that ALREADY have a Published Snapshot (legacy inconsistency)',
    case when v_n = 0 then 'PASS' else 'WARN' end,
    v_n || coalesce(': ' || v_list || ' — Controlled; only no_formal → planned (governed) is open to them; nothing is migrated', ''));
  select count(*), string_agg(p.code, ', ' order by p.code) into v_n, v_list
    from public.planning_opening_positions o join public.projects p on p.id = o.project_id
    left join public.project_planning_settings s on s.project_id = o.project_id
   where o.status <> 'promoted' and coalesce(s.onboarding_mode, 'new_project') <> 'existing_active_project';
  perform pg_temp.out(5, '05 ONBOARDING', 'unpromoted Opening Positions on a project not in existing_active_project mode',
    case when v_n = 0 then 'PASS' else 'WARN' end, v_n || coalesce(': ' || v_list, ''));

  /* ------------------ 6 values that become governed / retired ------------- */
  select count(*) into v_n from controlled;
  perform pg_temp.out(6, '06 FIELD VALUES', 'Controlled projects: retired values that differ from their defaults (kept; only a change is refused)',
    'INFO',
    'priority≠medium ' || (select count(*) from controlled where priority <> 'medium')
    || ' · overall_status≠on_track ' || (select count(*) from controlled where overall_status <> 'on_track')
    || ' · planned_progress≠0 ' || (select count(*) from controlled where planned_progress <> 0)
    || ' · actual_progress≠0 ' || (select count(*) from controlled where actual_progress <> 0)
    || ' (of ' || v_n || ')');
  perform pg_temp.out(6, '06 FIELD VALUES', 'Controlled projects: governed date fields that are blank (setting one later needs a governed amendment)',
    'INFO',
    'contract_start_date ' || (select count(*) from controlled where contract_start_date is null)
    || ' · forecast_finish_date ' || (select count(*) from controlled where forecast_finish_date is null)
    || ' (of ' || v_n || ')');
  perform pg_temp.out(6, '06 FIELD VALUES', 'Controlled projects: lightweight fields that are blank (setting one later needs a reason)',
    'INFO',
    'short_name ' || (select count(*) from controlled where short_name is null)
    || ' · contract_number ' || (select count(*) from controlled where contract_number is null)
    || ' · purchase_order_number ' || (select count(*) from controlled where purchase_order_number is null)
    || ' · actual_start_date ' || (select count(*) from controlled where actual_start_date is null)
    || ' · actual_finish_date ' || (select count(*) from controlled where actual_finish_date is null)
    || ' (of ' || v_n || ')');
  select count(*), string_agg(code, ', ' order by code) into v_n, v_list from controlled
   where structure_family = 'other' and project_type_id is null;
  perform pg_temp.out(6, '06 FIELD VALUES', 'Controlled Other projects without a Project Category',
    case when v_n = 0 then 'PASS' else 'WARN' end, v_n || coalesce(': ' || v_list, ''));

  /* ----------------------------- 7 archived ------------------------------- */
  select count(*), string_agg(code, ', ' order by code) into v_n, v_list from public.projects where status = 'archived';
  perform pg_temp.out(7, '07 ARCHIVED', 'archived projects (every new 13.9B write refused)', 'INFO', v_n || coalesce(': ' || v_list, ''));
  select count(*), string_agg(code, ', ' order by code) into v_n, v_list from public.projects
   where (status = 'archived') is distinct from (active = false and archived_at is not null);
  perform pg_temp.out(7, '07 ARCHIVED', 'status / active / archived_at agree on every project',
    case when v_n = 0 then 'PASS' else 'WARN' end,
    v_n || coalesce(': ' || v_list || ' — the 13.9B guards key on status = archived, like 2C.3E and 13.9', ''));

  /* ------------------------ 8 structure / scope rows ---------------------- */
  perform pg_temp.out(8, '08 STRUCTURE SCOPE', 'structure rows on Controlled projects (governed from Step 4, not Step 1)',
    'INFO',
    'project_departments ' || (select count(*) from public.project_departments d join controlled c on c.id = d.project_id)
    || ' · project_disciplines ' || (select count(*) from public.project_disciplines d join controlled c on c.id = d.project_id)
    || ' · project_structure_levels ' || (select count(*) from public.project_structure_levels d join controlled c on c.id = d.project_id)
    || ' · project_structure_nodes ' || (select count(*) from public.project_structure_nodes d join controlled c on c.id = d.project_id)
    || ' (archived nodes ' || (select count(*) from public.project_structure_nodes d join controlled c on c.id = d.project_id where d.archived_at is not null) || ')');

  /* ----------------- 9 states that would block the constraints ------------ */
  select count(*) into v_n from (
    select project_id, version from public.planning_snapshots group by 1, 2 having count(*) > 1) x;
  perform pg_temp.out(9, '09 CONSISTENCY', 'no duplicate snapshot versions per project',
    case when v_n = 0 then 'PASS' else 'FAIL' end, v_n || ' duplicates');
  select count(*) into v_n from public.planning_snapshots s
   where not exists (select 1 from public.projects p where p.id = s.project_id);
  perform pg_temp.out(9, '09 CONSISTENCY', 'every snapshot belongs to an existing project',
    case when v_n = 0 then 'PASS' else 'FAIL' end, v_n || ' orphans');
  select count(*) into v_n from public.planning_snapshots where published_at > now();
  perform pg_temp.out(9, '09 CONSISTENCY', 'no snapshot is published in the future (Controlled-since must be a real time)',
    case when v_n = 0 then 'PASS' else 'WARN' end, v_n || ' rows');
  select count(*) into v_n from public.project_classification_corrections c
   where not exists (select 1 from public.projects p where p.id = c.project_id);
  perform pg_temp.out(9, '09 CONSISTENCY', 'every Project Type correction row belongs to an existing project',
    case when v_n = 0 then 'PASS' else 'WARN' end, v_n || ' orphans');
  select count(*), string_agg(code, ', ' order by code) into v_n, v_list from public.projects p
   where p.structure_family = 'other' and p.project_type_id is not null
     and not exists (select 1 from public.project_types t where t.id = p.project_type_id and t.active);
  perform pg_temp.out(9, '09 CONSISTENCY', 'Other projects whose Project Category is inactive (a governed category change re-validates it)',
    case when v_n = 0 then 'PASS' else 'WARN' end, v_n || coalesce(': ' || v_list, ''));
end;
$checks$;

/* ================================ report ================================ */

select seq, area, item, verdict, detail from f order by seq, area, item;
select count(*) filter (where verdict = 'PASS') as passed,
       count(*) filter (where verdict = 'FAIL') as failed,
       count(*) filter (where verdict = 'WARN') as warnings,
       count(*) filter (where verdict = 'INFO') as info,
       case when count(*) filter (where verdict = 'FAIL') = 0 then 'NO BLOCKER' else 'BLOCKED' end as outcome
  from f;

rollback;
