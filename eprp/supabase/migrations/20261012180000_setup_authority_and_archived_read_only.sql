-- Phase 2C.3E: authority-bearing assignment rules + archived Project Setup
-- read-only.
--
-- Additive. New guard triggers only; no table, column, policy, authority
-- predicate or existing function is changed, and no row is written.
--
--   1. ARCHIVED PROJECT SETUP IS READ-ONLY AT THE DATA BOUNDARY.
--      guard_archived_project_setup() refuses every INSERT / UPDATE / DELETE
--      of an archived project's setup rows (departments, Programs & Studies
--      links, contacts and department assignments, delegations, positions,
--      sites, parties), and guard_archived_project_update() refuses every
--      UPDATE of an archived project's own row. This covers every write path:
--      save_project_setup_patch / save_project_setup_relation (SECURITY
--      INVOKER), replace_project_responsibility() and
--      correct_project_structure_family() (SECURITY DEFINER), the global
--      master-data cascades that rewrite project rows, and direct table writes
--      the setup RLS policies would otherwise allow. The project team, Other
--      structure and structure responsibilities already refuse on their own
--      (2C.1c / 2C.3C / 2C.3D) and are unchanged. Archiving itself (an active
--      project's status set to archived) stays allowed; there is no un-archive
--      path today, and a future one must be a governed exception to this
--      guard. Deleting a whole project still cascades (its row is gone, so its
--      children are no longer an archived project's setup).
--
--   2. PROJECT CONTROL / REPORTING COORDINATOR AUTHORITY FOLLOWS THE NAMED
--      HOLDER. is_project_control_planning() and is_report_coordinator() read
--      the unscoped fixed-role rows of project_contacts. Nothing tied those
--      rows to projects.project_control_manager_id / reporting_coordinator_id,
--      so a direct write could create authority for someone not named on the
--      project, or change / clear the named holder and leave the old holder's
--      authority behind. guard_project_authority_rows() — a commit-time
--      constraint trigger — refuses any transaction that ends with such a row
--      naming anyone but the project's current holder of that role. The
--      application paths already keep them equal in one transaction
--      (save_project_setup_patch, replace_project_responsibility; project
--      creation now sets holders through the patch as well).
--
-- UNCHANGED, by design: every authorization helper and policy (re-proved by
-- the post-check), Department Manager authority (role = team_member +
-- assignment_role = department_manager, so the six malformed legacy rows
-- still grant nothing), project_members and every Other-project
-- responsibility staying authority-free, and Reporting Coordinator holding no
-- Project Setup authority. Existing rows are not rewritten: the one stale
-- Reporting Coordinator row on the archived ZZ-P0TEST-PRJ fixture is left as
-- it is (its project is archived, so it can no longer change).

/* ---------------- 1. Archived Project Setup is read-only ------------------ */

create function public.guard_archived_project_setup() returns trigger
language plpgsql security definer set search_path = '' as $guard$
declare
  v_archived boolean;
begin
  -- Both ends of an UPDATE count; moving rows between projects is refused by
  -- invalidate_setup_project_version() anyway.
  select true into v_archived
    from public.projects p
   where p.status = 'archived'
     and p.id in (case when tg_op = 'INSERT' then null else old.project_id end,
                  case when tg_op = 'DELETE' then null else new.project_id end)
   limit 1;
  if v_archived then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its setup is read-only.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$guard$;
revoke execute on function public.guard_archived_project_setup() from public, anon, authenticated, service_role;

create function public.guard_archived_project_update() returns trigger
language plpgsql security definer set search_path = '' as $guard$
begin
  if old.status = 'archived' then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its setup is read-only.'
      using errcode = '42501';
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_archived_project_update() from public, anon, authenticated, service_role;

-- BEFORE row triggers fire alphabetically: "block_" answers before every
-- existing setup guard, classification check and version bump.
do $install$
declare
  v_table text;
begin
  foreach v_table in array array['project_departments', 'project_disciplines', 'project_contacts',
                                 'project_delegations', 'project_positions', 'project_sites', 'project_parties']
  loop
    execute format('create trigger block_archived_project_setup before insert or update or delete on public.%I '
                   'for each row execute function public.guard_archived_project_setup()', v_table);
  end loop;
end;
$install$;

create trigger block_archived_project_setup
  before update on public.projects
  for each row execute function public.guard_archived_project_update();

/* ------ 2. Project Control / Reporting Coordinator follow the named holder ---- */

create function public.guard_project_authority_rows() returns trigger
language plpgsql security definer set search_path = '' as $guard$
declare
  v_project uuid;
begin
  if tg_table_name = 'projects' then
    v_project := new.id;
  elsif new.role in ('project_control_manager', 'reporting_coordinator')
        and new.department_id is null and new.system_id is null
        and new.discipline_id is null and new.assignment_role is null then
    v_project := new.project_id;
  else
    return null;
  end if;

  if exists (
    select 1
      from public.project_contacts pc
      join public.projects p on p.id = pc.project_id
     where pc.project_id = v_project
       and pc.role in ('project_control_manager', 'reporting_coordinator')
       and pc.department_id is null and pc.system_id is null
       and pc.discipline_id is null and pc.assignment_role is null
       and pc.contact_id is distinct from case pc.role
             when 'project_control_manager' then p.project_control_manager_id
             else p.reporting_coordinator_id end
  ) then
    raise exception '[AUTHORITY_HOLDER_MISMATCH] Project Control and Reporting Coordinator authority must match the people named on the project. Change them from Project Information.'
      using errcode = '23514';
  end if;
  return null;
end;
$guard$;
revoke execute on function public.guard_project_authority_rows() from public, anon, authenticated, service_role;

-- Checked at commit, so one transaction may move the row and the holder in
-- either order (the patch inserts the new holder's row before the column).
create constraint trigger guard_project_authority_rows
  after insert or update on public.project_contacts
  deferrable initially deferred
  for each row execute function public.guard_project_authority_rows();

create constraint trigger guard_project_authority_rows
  after update of project_control_manager_id, reporting_coordinator_id on public.projects
  deferrable initially deferred
  for each row execute function public.guard_project_authority_rows();

/* ------------------------------ 3. Post-checks ---------------------------- */

do $post$
declare
  v_missing text;
  v_readers text;
  v_policies text;
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array['projects', 'project_departments', 'project_disciplines', 'project_contacts',
                      'project_delegations', 'project_positions', 'project_sites', 'project_parties']) t
   where not exists (select 1 from pg_catalog.pg_trigger g
                      where g.tgname = 'block_archived_project_setup'
                        and g.tgrelid = ('public.' || t)::regclass);
  if v_missing is not null then
    raise exception '2C.3E post-check failed: archived guard missing on %', v_missing;
  end if;
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'guard_project_authority_rows') <> 2 then
    raise exception '2C.3E post-check failed: the authority-holder constraint triggers are missing.';
  end if;

  -- Descriptive assignments grant nothing: no authorization helper reads them.
  select string_agg(p.proname, ', ' order by p.proname) into v_readers
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
          or p.proname ~ '_accepts_department_input$')
     and p.prosrc ~* '(project_members|project_parties|project_positions|project_delegations|project_structure_unit_members|project_structure_report_responsibilities|reports_to|functional_title|project_role)';
  if v_readers is not null then
    raise exception '2C.3E post-check failed: authorization helper(s) read descriptive assignments: %', v_readers;
  end if;
  select string_agg(tablename || ':' || policyname, ', ') into v_policies
    from pg_catalog.pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') || coalesce(with_check, ''))
         ~* '(project_members|project_structure_unit_members|project_structure_report_responsibilities|reports_to|functional_title|project_role)'
     and tablename not in ('project_members', 'project_structure_unit_members', 'project_structure_report_responsibilities');
  if v_policies is not null then
    raise exception '2C.3E post-check failed: policies read descriptive assignments: %', v_policies;
  end if;

  -- The explicit authority sources are unchanged.
  if (select prosrc from pg_catalog.pg_proc where proname = 'is_weekly_department_manager') !~ 'pc\.role = ''team_member''' then
    raise exception '2C.3E post-check failed: Department Manager authority no longer requires role = team_member.';
  end if;
  if (select prosrc from pg_catalog.pg_proc where proname = 'is_project_control_planning') !~ 'pc\.role = ''project_control_manager''' then
    raise exception '2C.3E post-check failed: Project Control / Planning authority source changed.';
  end if;
  if (select prosrc from pg_catalog.pg_proc where proname = 'can_manage_project_setup') ~ 'is_report_coordinator' then
    raise exception '2C.3E post-check failed: Reporting Coordinator must not hold Project Setup authority.';
  end if;
end;
$post$;
