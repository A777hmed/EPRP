-- Stale optimistic-concurrency refusals: SQLSTATE 40001 -> PT409.
--
-- Prepared for review; it has not been applied to any database.
--
-- Why: PostgREST retries a transaction that fails with SQLSTATE 40001
-- (serialization_failure). These functions raise 40001 deliberately when the
-- caller's expected project version is out of date — a condition that never
-- clears on retry — so a stale request was retried in a tight loop (proved
-- on the main local stack, PostgREST 14.5, by rehearsal script 111: S5 and
-- S6) and never answered. Each attempt also took the Project Setup advisory
-- lock and the project row lock.
--
-- PT409 is a PostgREST custom SQLSTATE: it is not retried and is returned as
-- HTTP 409 Conflict with code "PT409".
--
-- Each function below is re-created from its CURRENT definition, verbatim.
-- The ONLY change in every body is that one business-stale raise:
--     errcode = '40001'  ->  errcode = 'PT409'
-- Messages and [STALE] tags, signatures, return types, each function's
-- SECURITY INVOKER / DEFINER mode (correct_project_structure_family stays
-- SECURITY DEFINER; the other three stay INVOKER), search_path, advisory and
-- row locking, authority / archive / Other-PSM checks and version
-- comparisons are unchanged. CREATE OR REPLACE keeps each
-- function's owner and ACL; the existing revoke / grant statements are
-- repeated unchanged.
--
-- Not changed: the genuine concurrency retry in
-- 20260824121615_reporting_integration_wave1.sql (errcode
-- 'serialization_failure' when a concurrent Weekly milestone insert is not
-- yet visible) — retrying that one is correct.

/* ---- save_project_setup_relation — from 20260926000002_project_setup_atomic_save.sql ---- */

create or replace function public.save_project_setup_relation(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_relation text,
  p_rows jsonb
) returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_saved_at timestamptz;
  v_item jsonb;
  v_id uuid;
  v_keep uuid[] := array[]::uuid[];
  v_contact uuid;
  v_department uuid;
  v_system uuid;
  v_discipline uuid;
  v_assignment text;
  v_actual_count integer;
begin
  if auth.uid() is null or public.current_user_role() is null then
    raise exception 'An active authenticated account is required.' using errcode = '42501';
  end if;
  if public.can_manage_project_setup(p_project) is distinct from true then
    raise exception 'Project Setup access is required.' using errcode = '42501';
  end if;
  if p_project is null or p_expected_updated_at is null then
    raise exception 'Project and expected version are required.' using errcode = '22023';
  end if;
  if p_relation is null or p_relation not in ('departments', 'disciplines', 'team', 'positions', 'sites', 'delegations')
     or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid Project Setup save payload.' using errcode = '22023';
  end if;

  -- The projects UPDATE is the compare-and-swap lock shared by every wizard
  -- step. A stale tab cannot replace rows from a newer wizard save.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_setup(p_project) is distinct from true then
    raise exception 'Project Setup access is required.' using errcode = '42501';
  end if;
  update public.projects
     set updated_at = clock_timestamp()
   where id = p_project and updated_at = p_expected_updated_at
   returning updated_at into v_saved_at;
  if not found then
    raise exception 'Project Setup changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;

  if p_relation = 'departments' then
    -- Preserve IDs for existing assignments. A later insert/constraint error
    -- rolls back this upsert, the delete, and the project version together.
    insert into public.project_departments (
      project_id, department_id, project_description, lead_name,
      reporting_required, systems
    )
    select p_project, x."departmentId", nullif(x."projectDescription", ''),
           nullif(x."leadName", ''), x."reportingRequired",
           coalesce(x.systems, '[]'::jsonb)
      from jsonb_to_recordset(p_rows) as x(
        "departmentId" uuid, "projectDescription" text, "leadName" text,
        "reportingRequired" boolean, systems jsonb
      )
    on conflict (project_id, department_id) do update
      set project_description = excluded.project_description,
          lead_name = excluded.lead_name,
          reporting_required = excluded.reporting_required,
          systems = excluded.systems;

    delete from public.project_departments pd
     where pd.project_id = p_project
       and not exists (
         select 1 from jsonb_to_recordset(p_rows) as x("departmentId" uuid)
          where x."departmentId" = pd.department_id
       );
    select count(*) into v_actual_count from public.project_departments
     where project_id = p_project;

  elsif p_relation = 'disciplines' then
    -- No other table refers to project_disciplines.id. Replace both sides
    -- inside this transaction so a rejected insert leaves every old link.
    delete from public.project_disciplines where project_id = p_project;
    insert into public.project_disciplines (
      project_id, discipline_id, department_id, system_id
    )
    select p_project, x."disciplineId", x."departmentId", x."systemId"
      from jsonb_to_recordset(p_rows) as x(
        "disciplineId" uuid, "departmentId" uuid, "systemId" uuid
      );
    select count(*) into v_actual_count from public.project_disciplines
     where project_id = p_project;

  elsif p_relation = 'team' then
    -- An empty team is not a reliable instruction to remove all members.
    -- Keep the service's existing guard against an unhydrated editor.
    if jsonb_array_length(p_rows) = 0 and exists (
      select 1 from public.project_contacts
       where project_id = p_project and role = 'team_member'
    ) then
      raise exception 'Refusing to clear an existing project team. Reload before saving.'
        using errcode = '22023';
    end if;

    for v_item in select value from jsonb_array_elements(p_rows) loop
      v_contact := nullif(v_item->>'contactId', '')::uuid;
      v_department := nullif(v_item->>'departmentId', '')::uuid;
      v_system := nullif(v_item->>'systemId', '')::uuid;
      v_discipline := nullif(v_item->>'disciplineId', '')::uuid;
      v_assignment := coalesce(nullif(v_item->>'assignmentRole', ''), 'team_member');
      if v_contact is null then
        raise exception 'Every project team row needs a person.' using errcode = '22023';
      end if;

      select id into v_id from public.project_contacts
       where project_id = p_project and role = 'team_member'
         and contact_id = v_contact
         and department_id is not distinct from v_department
         and system_id is not distinct from v_system
         and discipline_id is not distinct from v_discipline
         and assignment_role is not distinct from v_assignment;
      if v_id is null then
        insert into public.project_contacts (
          project_id, contact_id, role, department_id, system_id,
          discipline_id, assignment_role, functional_title,
          reports_to_contact_id
        ) values (
          p_project, v_contact, 'team_member', v_department, v_system,
          v_discipline, v_assignment,
          nullif(v_item->>'functionalTitle', ''),
          nullif(v_item->>'reportsToContactId', '')::uuid
        ) returning id into v_id;
      else
        update public.project_contacts
           set functional_title = nullif(v_item->>'functionalTitle', ''),
               reports_to_contact_id = nullif(v_item->>'reportsToContactId', '')::uuid
         where id = v_id;
      end if;
      v_keep := array_append(v_keep, v_id);
      v_id := null;
    end loop;

    delete from public.project_contacts
     where project_id = p_project and role = 'team_member'
       and not (id = any(v_keep));
    select count(*) into v_actual_count from public.project_contacts
     where project_id = p_project and role = 'team_member';
  elsif p_relation = 'positions' then
    for v_item in select value from jsonb_array_elements(p_rows) loop
      select id into v_id from public.project_positions
       where project_id = p_project and id = nullif(v_item->>'id', '')::uuid;
      v_keep := array_append(v_keep, coalesce(v_id, gen_random_uuid()));
    end loop;
    delete from public.project_positions where project_id = p_project and not (id = any(v_keep));
    insert into public.project_positions(id, project_id, job_title_id, contact_id, notes, sort_order)
    select v_keep[x.ordinality::integer], p_project, (x.value->>'jobTitleId')::uuid,
           (x.value->>'contactId')::uuid, nullif(x.value->>'notes', ''), (x.ordinality - 1)::integer
      from jsonb_array_elements(p_rows) with ordinality x(value, ordinality)
    on conflict (id) do update set job_title_id = excluded.job_title_id,
      contact_id = excluded.contact_id, notes = excluded.notes, sort_order = excluded.sort_order;
    select count(*) into v_actual_count from public.project_positions where project_id = p_project;
  elsif p_relation = 'sites' then
    for v_item in select value from jsonb_array_elements(p_rows) loop
      select id into v_id from public.project_sites
       where project_id = p_project and id = nullif(v_item->>'id', '')::uuid;
      v_keep := array_append(v_keep, coalesce(v_id, gen_random_uuid()));
    end loop;
    update public.project_sites set is_primary = false where project_id = p_project;
    delete from public.project_sites where project_id = p_project and not (id = any(v_keep));
    insert into public.project_sites(id, project_id, name, country, city, is_primary, sort_order)
    select v_keep[x.ordinality::integer], p_project, btrim(x.value->>'name'),
           nullif(x.value->>'country', ''), nullif(x.value->>'city', ''), false, (x.ordinality - 1)::integer
      from jsonb_array_elements(p_rows) with ordinality x(value, ordinality)
    on conflict (id) do update set name = excluded.name, country = excluded.country,
      city = excluded.city, is_primary = false, sort_order = excluded.sort_order;
    if cardinality(v_keep) > 0 then
      select v_keep[x.ordinality::integer] into v_id
        from jsonb_array_elements(p_rows) with ordinality x(value, ordinality)
       where x.value->>'isPrimary' = 'true' order by x.ordinality limit 1;
      update public.project_sites set is_primary = true where id = coalesce(v_id, v_keep[1]);
    end if;
    select count(*) into v_actual_count from public.project_sites where project_id = p_project;
  elsif p_relation = 'delegations' then
    delete from public.project_delegations where project_id = p_project;
    insert into public.project_delegations(project_id, department_id, delegate_contact_id,
      responsibilities, start_date, end_date, note, active)
    select p_project, x."departmentId", x."delegateContactId", x.responsibilities,
      x."startDate", x."endDate", nullif(x.note, ''), x.active
      from jsonb_to_recordset(p_rows) x("departmentId" uuid, "delegateContactId" uuid,
        responsibilities jsonb, "startDate" date, "endDate" date, note text, active boolean);
    select count(*) into v_actual_count from public.project_delegations where project_id = p_project;
  end if;

  if v_actual_count <> jsonb_array_length(p_rows) then
    raise exception 'Project Setup save did not replace every requested row.'
      using errcode = 'P0001';
  end if;

  -- Child invalidation triggers advance the version again; return the FINAL one.
  select updated_at into strict v_saved_at from public.projects where id = p_project;
  return v_saved_at;
end;
$fn$;

revoke execute on function public.save_project_setup_relation(uuid, timestamptz, text, jsonb)
  from public, anon;
grant execute on function public.save_project_setup_relation(uuid, timestamptz, text, jsonb)
  to authenticated, service_role;

/* ---- save_project_setup_patch — from 20261001000001_project_setup_classification.sql ---- */

create or replace function public.save_project_setup_patch(
  p_project uuid, p_expected_updated_at timestamptz, p_columns jsonb, p_relations jsonb
) returns timestamptz language plpgsql security invoker set search_path = '' as $patch$
declare
  v_version timestamptz;
  v_key text;
  v_rows jsonb;
  v_assignments text;
  v_role text;
  v_contact uuid;
  v_count integer;
  v_columns constant text[] := array[
    'code', 'name', 'short_name', 'description', 'project_type_id', 'client_id',
    'contract_number', 'purchase_order_number', 'contract_start_date', 'planned_start_date',
    'actual_start_date', 'planned_finish_date', 'forecast_finish_date', 'actual_finish_date',
    'project_manager_id', 'project_control_manager_id', 'client_representative_id',
    'reporting_coordinator_id', 'project_sponsor_id', 'status', 'overall_status',
    'planned_progress', 'actual_progress', 'current_phase_id', 'priority', 'weekly_enabled',
    'monthly_enabled', 'executive_enabled', 'weekly_reporting_day', 'monthly_cutoff_day',
    'milestone_update_approval', 'currency', 'working_week', 'time_zone', 'site', 'country',
    'city', 'client_contact_name', 'client_contact_email', 'client_contact_phone',
    'project_logo_ref', 'client_logo_ref', 'report_header_title', 'report_footer_text',
    'report_reference_prefix', 'default_language', 'include_qr_code', 'include_signature_section',
    'structure_family', 'project_category_detail', 'portfolio_group_id'];
begin
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_setup(p_project) is distinct from true then
    raise exception 'Project Setup access is required.' using errcode = '42501';
  end if;
  if p_project is null or p_expected_updated_at is null or p_columns is null or p_relations is null
     or jsonb_typeof(p_columns) <> 'object' or jsonb_typeof(p_relations) <> 'object' then
    raise exception 'Invalid Project Setup patch.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_columns) loop
    if not (v_key = any(v_columns)) then
      raise exception 'Project column is not editable: %', v_key using errcode = '22023';
    end if;
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_setup(p_project) is distinct from true then
    raise exception 'Project Setup access is required.' using errcode = '42501';
  end if;
  select updated_at into v_version from public.projects where id = p_project for update;
  if not found or v_version is distinct from p_expected_updated_at then
    raise exception 'Project Setup changed since this page loaded. Reload before saving.' using errcode = 'PT409';
  end if;

  -- Backing memberships must exist before fixed responsibility columns change.
  for v_key, v_role in select * from (values
    ('project_manager_id', 'project_manager'), ('project_control_manager_id', 'project_control_manager'),
    ('client_representative_id', 'client_representative'), ('reporting_coordinator_id', 'reporting_coordinator'),
    ('project_sponsor_id', 'project_sponsor')) roles(column_name, role_name) loop
    if p_columns ? v_key then
      v_contact := (p_columns->>v_key)::uuid;
      if v_contact is not null and not exists (select 1 from public.project_contacts
         where project_id = p_project and role = v_role and contact_id = v_contact) then
        insert into public.project_contacts(project_id, contact_id, role) values (p_project, v_contact, v_role);
      end if;
    end if;
  end loop;
  if p_columns <> '{}'::jsonb then
    select string_agg(format('%I = incoming.%I', key, key), ', ' order by key)
      into v_assignments from jsonb_object_keys(p_columns) as keys(key);
    execute format('update public.projects p set %s from jsonb_populate_record(null::public.projects, $1) incoming where p.id = $2', v_assignments)
      using p_columns, p_project;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'Project update was refused.' using errcode = '42501';
    end if;
  end if;
  for v_key, v_role in select * from (values
    ('project_manager_id', 'project_manager'), ('project_control_manager_id', 'project_control_manager'),
    ('client_representative_id', 'client_representative'), ('reporting_coordinator_id', 'reporting_coordinator'),
    ('project_sponsor_id', 'project_sponsor')) roles(column_name, role_name) loop
    if p_columns ? v_key then
      delete from public.project_contacts where project_id = p_project and role = v_role
        and contact_id is distinct from (p_columns->>v_key)::uuid;
    end if;
  end loop;
  -- Deterministic dependency order: department scope before discipline/team.
  for v_key, v_rows in select key, value from jsonb_each(p_relations)
    order by case key when 'departments' then 1 when 'disciplines' then 2
      when 'team' then 3 when 'positions' then 4 when 'sites' then 5 else 6 end loop
    select updated_at into strict v_version from public.projects where id = p_project;
    perform public.save_project_setup_relation(p_project, v_version, v_key, v_rows);
  end loop;
  select updated_at into strict v_version from public.projects where id = p_project;
  return v_version;
end;
$patch$;
revoke execute on function public.save_project_setup_patch(uuid, timestamptz, jsonb, jsonb) from public, anon;
grant execute on function public.save_project_setup_patch(uuid, timestamptz, jsonb, jsonb) to authenticated;

/* ---- configure_project_structure_levels — from 20261003000001_project_structure_foundation.sql ---- */

create or replace function public.configure_project_structure_levels(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_levels jsonb
) returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $configure$
declare
  v_count    integer;
  v_family   text;
  v_status   text;
  v_version  timestamptz;
  v_existing integer;
  v_units    integer;
  v_bad      integer;
  v_saved_at timestamptz;
begin
  -- 1. Authority first.
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_setup(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] You cannot configure this project''s structure.'
      using errcode = '42501';
  end if;

  -- 2. Payload shape.
  if p_project is null or p_expected_updated_at is null
     or p_levels is null or jsonb_typeof(p_levels) <> 'array' then
    raise exception '[INVALID_LEVELS] The structure levels are not valid.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_levels);
  if v_count < 1 then
    raise exception '[INVALID_LEVELS] Define at least one structure level.' using errcode = '22023';
  end if;
  if v_count > 4 then
    raise exception '[LEVEL_LIMIT] A project structure has at most four levels.' using errcode = '22023';
  end if;

  -- Strict JSON types: a number for level_number, strings for the labels (a
  -- number or boolean is not silently coerced into a label).
  select count(*) into v_bad
    from jsonb_array_elements(p_levels) e
   where jsonb_typeof(e) <> 'object'
      or jsonb_typeof(e -> 'level_number') is distinct from 'number'
      or jsonb_typeof(e -> 'singular_label') is distinct from 'string'
      or jsonb_typeof(e -> 'plural_label') is distinct from 'string'
      or coalesce(e ->> 'level_number', '') !~ '^[0-9]{1,2}$'
      or nullif(btrim(coalesce(e ->> 'singular_label', '')), '') is null
      or nullif(btrim(coalesce(e ->> 'plural_label', '')), '') is null
      or length(btrim(e ->> 'singular_label')) > 60
      or length(btrim(e ->> 'plural_label')) > 60
      or (e ? 'id' and jsonb_typeof(e -> 'id') <> 'null'
          and coalesce(e ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  if v_bad > 0 then
    raise exception '[INVALID_LEVELS] Every level needs a number, a singular label and a plural label (60 characters at most).'
      using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_array_elements(p_levels) e where (e ->> 'level_number')::integer > 4) then
    raise exception '[LEVEL_LIMIT] A project structure has at most four levels.' using errcode = '22023';
  end if;
  if (select count(distinct (e ->> 'level_number')::integer) from jsonb_array_elements(p_levels) e) <> v_count
     or (select min((e ->> 'level_number')::integer) from jsonb_array_elements(p_levels) e) <> 1
     or (select max((e ->> 'level_number')::integer) from jsonb_array_elements(p_levels) e) <> v_count then
    raise exception '[LEVEL_GAP] Structure levels must run from 1 without gaps.' using errcode = '22023';
  end if;
  if (select count(distinct lower(btrim(e ->> 'singular_label'))) from jsonb_array_elements(p_levels) e) <> v_count
     or (select count(distinct lower(btrim(e ->> 'plural_label'))) from jsonb_array_elements(p_levels) e) <> v_count then
    raise exception '[DUPLICATE_LABEL] Each level needs its own name.' using errcode = '23505';
  end if;

  -- 3. Same lock order as every other setup writer: advisory lock, then rows.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_setup(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] You cannot configure this project''s structure.'
      using errcode = '42501';
  end if;

  select p.structure_family, p.status, p.updated_at
    into v_family, v_status, v_version
    from public.projects p
   where p.id = p_project
   for update;
  if not found then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'P0002';
  end if;
  if v_version is distinct from p_expected_updated_at then
    raise exception '[STALE] The project changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;
  if v_status = 'archived' then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its structure is read-only.'
      using errcode = '42501';
  end if;
  if v_family is distinct from 'other' then
    raise exception '[NOT_OTHER] Only an Other project has a configurable Project Structure.'
      using errcode = '23514';
  end if;

  select count(*) into v_existing from public.project_structure_levels l where l.project_id = p_project;
  select count(*) into v_units from public.project_structure_nodes n where n.project_id = p_project;

  -- 4. Once units exist, level numbers are fixed in meaning.
  if v_units > 0 then
    -- Every retained level is sent with its own id at its own number.
    if exists (
      select 1
        from public.project_structure_levels l
        left join jsonb_array_elements(p_levels) e
          on (e ->> 'level_number')::integer = l.level_number
       where l.project_id = p_project
         and l.level_number <= v_count
         and lower(e ->> 'id') is distinct from l.id::text
    ) then
      raise exception '[LEVEL_IN_USE] Levels already used by structure units can only be renamed. Add new levels below the deepest one.'
        using errcode = '23514';
    end if;
    -- New levels are appended only, and carry no id.
    if exists (
      select 1 from jsonb_array_elements(p_levels) e
       where (e ->> 'level_number')::integer > v_existing
         and e ? 'id' and jsonb_typeof(e -> 'id') <> 'null'
    ) then
      raise exception '[INVALID_LEVELS] A new level cannot carry an existing id.' using errcode = '22023';
    end if;
    -- Removed (deeper) levels must have no units at all, archived included.
    if exists (
      select 1 from public.project_structure_nodes n
       where n.project_id = p_project and n.level_number > v_count
    ) then
      raise exception '[LEVEL_IN_USE] A level that has structure units cannot be removed.'
        using errcode = '23514';
    end if;
  end if;

  -- 5. Apply. Labels may swap between levels in one save, so their uniqueness
  -- is checked once all rows are written.
  set constraints public.project_structure_levels_singular_key_unique,
                  public.project_structure_levels_plural_key_unique deferred;

  update public.project_structure_levels l
     set singular_label = btrim(e ->> 'singular_label'),
         plural_label = btrim(e ->> 'plural_label')
    from jsonb_array_elements(p_levels) e
   where l.project_id = p_project
     and l.level_number = (e ->> 'level_number')::integer
     and (l.singular_label is distinct from btrim(e ->> 'singular_label')
          or l.plural_label is distinct from btrim(e ->> 'plural_label'));

  delete from public.project_structure_levels l
   where l.project_id = p_project and l.level_number > v_count;

  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  select p_project, (e ->> 'level_number')::integer,
         btrim(e ->> 'singular_label'), btrim(e ->> 'plural_label')
    from jsonb_array_elements(p_levels) e
   where (e ->> 'level_number')::integer > v_existing
   order by (e ->> 'level_number')::integer;

  set constraints public.project_structure_levels_singular_key_unique,
                  public.project_structure_levels_plural_key_unique immediate;

  select p.updated_at into v_saved_at from public.projects p where p.id = p_project;
  return v_saved_at;
end;
$configure$;

revoke execute on function public.configure_project_structure_levels(uuid, timestamptz, jsonb)
  from public, anon;
grant execute on function public.configure_project_structure_levels(uuid, timestamptz, jsonb)
  to authenticated;

/* ---- correct_project_structure_family — from 20261003000001_project_structure_foundation.sql ---- */

create or replace function public.correct_project_structure_family(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_new_family text,
  p_project_type_id uuid,
  p_project_category_detail text,
  p_reason text
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $correct$
declare
  v_reason        text;
  v_detail_in     text;
  v_allows_custom boolean;
  v_new_type_name text;
  v_type_active   boolean;
  v_type_psm      boolean;
  v_old           text;
  v_old_type      uuid;
  v_old_detail    text;
  v_old_type_name text;
  v_version       timestamptz;
  v_actor_name    text;
  v_saved_at      timestamptz;
begin
  -- 1. Authority first: an unauthorized caller learns nothing about the project.
  if auth.uid() is null or public.current_user_role() is null
     or public.is_system_admin() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a System Admin can correct a Project Type.'
      using errcode = '42501';
  end if;

  -- 2. Mandatory, non-blank reason.
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception '[REASON_REQUIRED] A reason is required to correct a Project Type.'
      using errcode = '22023';
  end if;

  -- 3. The target must be a complete, valid classification.
  if p_project is null or p_expected_updated_at is null
     or p_new_family is null or p_new_family not in ('psm', 'other') then
    raise exception '[INVALID_TARGET] Invalid Project Type correction.' using errcode = '22023';
  end if;
  v_detail_in := nullif(btrim(coalesce(p_project_category_detail, '')), '');

  if p_new_family = 'psm' then
    -- A PSM project has no Project Category.
    if p_project_type_id is not null or v_detail_in is not null then
      raise exception '[INVALID_TARGET] A PSM project has no Project Category.'
        using errcode = '22023';
    end if;
  else
    if p_project_type_id is null then
      raise exception '[CATEGORY_REQUIRED] An Other project needs a Project Category.'
        using errcode = '23514';
    end if;
    select pt.allows_custom_name, pt.name, pt.active,
           public.is_psm_family_project_type(pt.code, pt.name)
      into v_allows_custom, v_new_type_name, v_type_active, v_type_psm
      from public.project_types pt
     where pt.id = p_project_type_id;
    if not found or v_type_active is distinct from true then
      raise exception '[CATEGORY_INVALID] Choose an active Project Category.'
        using errcode = '23514';
    end if;
    if v_type_psm then
      raise exception '[CATEGORY_PSM_FAMILY] An Other project cannot use a PSM / PSAIM Project Category.'
        using errcode = '23514';
    end if;
    if v_allows_custom and v_detail_in is null then
      raise exception '[DETAIL_REQUIRED] Specify the category name for this Project Category.'
        using errcode = '23514';
    end if;
    if not v_allows_custom and v_detail_in is not null then
      raise exception '[DETAIL_NOT_ALLOWED] This Project Category does not take a custom name.'
        using errcode = '23514';
    end if;
  end if;

  -- 4. Same lock order as every other setup writer: advisory lock, then rows.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if auth.uid() is null or public.current_user_role() is null
     or public.is_system_admin() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a System Admin can correct a Project Type.'
      using errcode = '42501';
  end if;

  select structure_family, project_type_id, project_category_detail, updated_at
    into v_old, v_old_type, v_old_detail, v_version
    from public.projects
   where id = p_project
   for update;
  if not found then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'P0002';
  end if;
  if v_version is distinct from p_expected_updated_at then
    raise exception '[STALE] The project changed since this page loaded. Reload before correcting.'
      using errcode = 'PT409';
  end if;
  if v_old is null then
    raise exception '[NOT_CLASSIFIED] This project is not classified yet. Classify it from Project Setup instead.'
      using errcode = '22023';
  end if;
  if v_old = p_new_family then
    raise exception '[SAME_TYPE] The project already has this Project Type.' using errcode = '22023';
  end if;

  -- 4b. (2C.1c) An Other project whose structure is still active cannot
  -- become PSM. Archived units alone do not block the correction; they stay
  -- with the project, read-only (the structure guard refuses writes on a
  -- non-Other project). Stronger guards arrive with historical references.
  if v_old = 'other' and p_new_family = 'psm' and exists (
    select 1 from public.project_structure_nodes n
     where n.project_id = p_project and n.archived_at is null
  ) then
    raise exception '[STRUCTURE_EXISTS] Archive this project''s structure units before changing it to a PSM Project.'
      using errcode = '23514';
  end if;

  select pt.name into v_old_type_name from public.project_types pt where pt.id = v_old_type;
  select p.full_name into v_actor_name from public.profiles p where p.id = auth.uid();

  -- 5. Audit BEFORE the change: the lock trigger looks for this row.
  insert into public.project_classification_corrections (
    project_id, old_family, new_family,
    old_project_type_id, new_project_type_id,
    old_project_type_name, new_project_type_name,
    old_category_detail, new_category_detail,
    reason, corrected_by, corrected_by_name
  ) values (
    p_project, v_old, p_new_family,
    v_old_type, p_project_type_id,
    v_old_type_name, v_new_type_name,
    v_old_detail, v_detail_in,
    v_reason, auth.uid(), v_actor_name
  );

  -- 6. Then the project, to exactly the audited target.
  update public.projects
     set structure_family = p_new_family,
         project_type_id = p_project_type_id,
         project_category_detail = v_detail_in
   where id = p_project
   returning updated_at into v_saved_at;

  return v_saved_at;
end;
$correct$;

revoke execute on function public.correct_project_structure_family(uuid, timestamptz, text, uuid, text, text)
  from public, anon;
grant execute on function public.correct_project_structure_family(uuid, timestamptz, text, uuid, text, text)
  to authenticated;
