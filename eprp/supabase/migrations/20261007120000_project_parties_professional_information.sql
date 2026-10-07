-- Phase 2C.3B: Professional Project Information for subcontractor parties.
-- Additive only. Prepared, NOT applied. Shared by PSM and Other projects.
-- * Four nullable columns; EPROM and Owner rows keep every one of them null.
-- * Existing (2C.3A) subcontractor rows are preserved with null professional
--   fields. Nothing is backfilled, including Engagement Status. The "required"
--   rule is added NOT VALID, so those rows survive while every new or updated
--   subcontractor row must carry Scope / Package and an Engagement Status.
-- * Duplicate company names are refused by the save function, not by an index.
-- * No people, responsibilities, structure, report or chart records are touched.
-- Adding nullable columns and constraints rewrites no row and fires no row
-- trigger, so this migration itself invalidates no project version.

alter table public.project_parties
  add column short_name text,
  add column scope text,
  add column contract_reference text,
  add column engagement_status text;

-- Shape is checked for every row now: all existing rows hold nulls and pass.
alter table public.project_parties
  add constraint project_parties_professional_shape check (
    (kind in ('eprom', 'owner')
      and short_name is null and scope is null
      and contract_reference is null and engagement_status is null)
    or (kind = 'subcontractor'
      and (short_name is null
        or (short_name = btrim(short_name) and length(short_name) between 1 and 40))
      and (scope is null
        or (scope = btrim(scope) and length(scope) between 1 and 250))
      and (contract_reference is null
        or (contract_reference = btrim(contract_reference) and length(contract_reference) between 1 and 100))
      and (engagement_status is null
        or engagement_status in ('planned', 'active', 'suspended', 'completed')))
  );

-- Required for new or updated subcontractor rows only. Legacy rows show
-- "Needs completion" in the application until they are next saved.
alter table public.project_parties
  add constraint project_parties_subcontractor_professional_required check (
    kind <> 'subcontractor' or (scope is not null and engagement_status is not null)
  ) not valid;

comment on column public.project_parties.name is
  'Subcontractor Registered Company Name. Null for EPROM and Owner (Owner resolves via projects.client_id).';
comment on column public.project_parties.short_name is 'Subcontractor Short Name / Acronym (optional).';
comment on column public.project_parties.scope is
  'Subcontractor Scope / Package. Required on new or updated subcontractor rows.';
comment on column public.project_parties.contract_reference is 'Subcontract / Contract Reference (optional).';
comment on column public.project_parties.engagement_status is
  'Subcontractor Engagement Status: planned, active, suspended or completed. No default; chosen explicitly.';

-- Re-create the relation dispatcher from 20261006123219_project_parties_foundation.sql.
-- Only the 'parties' branch changes. Every other branch, the authorization,
-- the PT409 compare-and-swap and the final-version return are unchanged.
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
  if p_relation is null or p_relation not in ('departments', 'disciplines', 'team', 'positions', 'sites', 'delegations', 'parties')
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
  elsif p_relation = 'parties' then
    -- Only subcontractors are editable. Required parties never come from this payload.
    -- 2C.3B: every written subcontractor carries Scope / Package and an explicit
    -- Engagement Status. The payload is the project's complete subcontractor list,
    -- so a duplicate here is a duplicate in the project (trim + case-insensitive).
    if exists (
      select 1 from jsonb_array_elements(p_rows) x(value)
       where jsonb_typeof(x.value) = 'object' and jsonb_typeof(x.value->'name') = 'string'
       group by lower(btrim(x.value->>'name')) having count(*) > 1
    ) then
      raise exception 'A subcontractor company name can appear only once per project.' using errcode = '23505';
    end if;
    for v_item in select value from jsonb_array_elements(p_rows) loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or v_item->>'kind' is distinct from 'subcontractor'
         or jsonb_typeof(v_item->'name') is distinct from 'string'
         or length(btrim(v_item->>'name')) not between 1 and 140
         or (v_item ? 'id' and jsonb_typeof(v_item->'id') not in ('string', 'null'))
         or jsonb_typeof(v_item->'scope') is distinct from 'string'
         or length(btrim(v_item->>'scope')) not between 1 and 250
         or jsonb_typeof(v_item->'engagementStatus') is distinct from 'string'
         or v_item->>'engagementStatus' not in ('planned', 'active', 'suspended', 'completed')
         or (v_item ? 'shortName' and jsonb_typeof(v_item->'shortName') not in ('string', 'null'))
         or length(btrim(coalesce(v_item->>'shortName', ''))) > 40
         or (v_item ? 'contractReference' and jsonb_typeof(v_item->'contractReference') not in ('string', 'null'))
         or length(btrim(coalesce(v_item->>'contractReference', ''))) > 100 then
        raise exception 'Invalid subcontractor row.' using errcode = '22023';
      end if;
      v_id := nullif(v_item->>'id', '')::uuid;
      if v_id is null then
        insert into public.project_parties(project_id, kind, name, short_name, scope,
          contract_reference, engagement_status, sort_order)
        values (p_project, 'subcontractor', btrim(v_item->>'name'),
          nullif(btrim(coalesce(v_item->>'shortName', '')), ''), btrim(v_item->>'scope'),
          nullif(btrim(coalesce(v_item->>'contractReference', '')), ''),
          v_item->>'engagementStatus', cardinality(v_keep))
        returning id into v_id;
      else
        update public.project_parties
           set name = btrim(v_item->>'name'),
               short_name = nullif(btrim(coalesce(v_item->>'shortName', '')), ''),
               scope = btrim(v_item->>'scope'),
               contract_reference = nullif(btrim(coalesce(v_item->>'contractReference', '')), ''),
               engagement_status = v_item->>'engagementStatus',
               sort_order = cardinality(v_keep)
         where id = v_id and project_id = p_project and kind = 'subcontractor';
        if not found then
          raise exception 'Subcontractor identity does not belong to this project.' using errcode = '23503';
        end if;
      end if;
      v_keep := array_append(v_keep, v_id);
    end loop;
    delete from public.project_parties
     where project_id = p_project and kind = 'subcontractor' and not (id = any(v_keep));
    select count(*) into v_actual_count from public.project_parties
     where project_id = p_project and kind = 'subcontractor';

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
