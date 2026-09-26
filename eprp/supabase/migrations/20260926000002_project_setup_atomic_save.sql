-- Project Setup saves one owned relation per step. The version check, all row
-- changes, and the returned confirmation run in one PostgreSQL transaction.
-- This migration is prepared for review; it has not been applied.

-- RLS remains the business-role boundary. Do not grant anything to anon.
grant usage on schema public to authenticated;
grant select on public.projects to authenticated;
grant update (updated_at) on public.projects to authenticated;
grant select, insert, update, delete on public.project_contacts to authenticated;
grant select, insert, update, delete on public.project_sites, public.project_positions,
  public.project_delegations to authenticated;

-- One lock order for parent and child writers, including direct table writes.
-- Deliberately serialize setup transactions across projects until a narrower
-- per-project protocol is available for multi-project master-data operations.
create function public.lock_project_setup_statement() returns trigger
language plpgsql set search_path = '' as $lock$
begin
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  return null;
end;
$lock$;
revoke execute on function public.lock_project_setup_statement() from public, anon, authenticated, service_role;

create function public.advance_setup_project_version() returns trigger
language plpgsql set search_path = '' as $version$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$version$;
revoke execute on function public.advance_setup_project_version() from public, anon, authenticated, service_role;
drop trigger set_updated_at on public.projects;
create trigger set_updated_at before update on public.projects
  for each row execute function public.advance_setup_project_version();

-- Trigger-only privilege is needed to invalidate a parent after an authorized
-- child write. Authorization stays on the child table / governing RPC.
create function public.invalidate_setup_project_version() returns trigger
language plpgsql security definer set search_path = '' as $invalidate$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'Moving setup rows between projects is not supported.' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then
    update public.projects set updated_at = clock_timestamp() where id = old.project_id;
    return old;
  end if;
  update public.projects set updated_at = clock_timestamp() where id = new.project_id;
  return new;
end;
$invalidate$;
revoke execute on function public.invalidate_setup_project_version() from public, anon, authenticated, service_role;

do $triggers$
declare v_table text;
begin
  foreach v_table in array array['projects', 'project_departments', 'project_disciplines',
    'project_contacts', 'project_delegations', 'project_positions', 'project_sites'] loop
    execute format('create trigger lock_project_setup_statement before insert or update or delete on public.%I for each statement execute function public.lock_project_setup_statement()', v_table);
    if v_table <> 'projects' then
      execute format('create trigger invalidate_setup_project_version before insert or update or delete on public.%I for each row execute function public.invalidate_setup_project_version()', v_table);
    end if;
  end loop;
end;
$triggers$;

create function public.save_project_setup_relation(
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
      using errcode = '40001';
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

-- Existing Project Info editors own several fields/relations. This entry point
-- keeps their entire submission atomic, without accepting server-owned columns.
grant update (code, name, short_name, description, project_type_id, client_id,
  contract_number, purchase_order_number, contract_start_date, planned_start_date,
  actual_start_date, planned_finish_date, forecast_finish_date, actual_finish_date,
  project_manager_id, project_control_manager_id, client_representative_id,
  reporting_coordinator_id, project_sponsor_id, status, overall_status,
  planned_progress, actual_progress, current_phase_id, priority, weekly_enabled,
  monthly_enabled, executive_enabled, weekly_reporting_day, monthly_cutoff_day,
  milestone_update_approval, currency, working_week, time_zone, site, country,
  city, client_contact_name, client_contact_email, client_contact_phone,
  project_logo_ref, client_logo_ref, report_header_title, report_footer_text,
  report_reference_prefix, default_language, include_qr_code, include_signature_section)
  on public.projects to authenticated;

create function public.save_project_setup_patch(
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
    'report_reference_prefix', 'default_language', 'include_qr_code', 'include_signature_section'];
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
    raise exception 'Project Setup changed since this page loaded. Reload before saving.' using errcode = '40001';
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
