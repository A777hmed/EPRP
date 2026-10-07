-- Phase 2C.3A: additive Project Parties foundation. Prepared, NOT applied.
-- Owner is resolved through projects.client_id; no Client master data is copied.
-- Subcontractors are project-owned company names with independent stable UUIDs.
-- No people, responsibilities, structure, report or chart records are rewritten.

create table public.project_parties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('eprom', 'owner', 'subcontractor')),
  name text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_parties_name_shape check (
    (kind in ('eprom', 'owner') and name is null)
    or (kind = 'subcontractor' and name is not null
        and name = btrim(name) and length(name) between 1 and 140)
  ),
  constraint project_parties_project_identity unique (project_id, id)
);

create unique index project_parties_required_kind
  on public.project_parties(project_id, kind) where kind in ('eprom', 'owner');
create index project_parties_project_order
  on public.project_parties(project_id, sort_order, id);

comment on table public.project_parties is
  'Project parties: one EPROM service provider, one Owner resolved via projects.client_id, and zero or more project-owned subcontractors. Not person master data or reporting authority.';

-- Add exactly two rows per existing project. No UPDATE to projects, Client,
-- People, setup scope, reports or charts; version invalidation is installed AFTER this.
insert into public.project_parties(project_id, kind, sort_order)
select p.id, kinds.kind, kinds.sort_order
from public.projects p cross join (values ('eprom', 0), ('owner', 1)) kinds(kind, sort_order);

-- Trigger-only privilege for server-owned rows; no client-callable helper.
create function public.initialize_project_parties() returns trigger
language plpgsql security definer set search_path = '' as $initialize$
begin
  insert into public.project_parties(project_id, kind, sort_order)
  values (new.id, 'eprom', 0), (new.id, 'owner', 1);
  return new;
end;
$initialize$;
revoke execute on function public.initialize_project_parties() from public, anon, authenticated, service_role;
create trigger initialize_project_parties after insert on public.projects
  for each row execute function public.initialize_project_parties();

create function public.guard_project_party_identity() returns trigger
language plpgsql set search_path = '' as $identity$
begin
  if new.id is distinct from old.id or new.project_id is distinct from old.project_id
     or new.kind is distinct from old.kind then
    raise exception 'Project party identity is immutable.' using errcode = '23514';
  end if;
  new.created_at := old.created_at;
  return new;
end;
$identity$;
revoke execute on function public.guard_project_party_identity() from public, anon, authenticated, service_role;
create trigger guard_project_party_identity before update on public.project_parties
  for each row execute function public.guard_project_party_identity();

-- At-most-one is an index; exactly-one is checked against final transaction state.
-- Parent deletion cascades safely because a missing project no longer needs parties.
create function public.check_required_project_parties() returns trigger
language plpgsql security definer set search_path = '' as $required$
declare v_project uuid; v_count integer;
begin
  if tg_table_name = 'projects' then
    v_project := new.id;
  elsif tg_op = 'DELETE' then
    v_project := old.project_id;
  else
    v_project := new.project_id;
  end if;
  if not exists (select 1 from public.projects where id = v_project) then return null; end if;
  select count(*) into v_count from public.project_parties
   where project_id = v_project and kind in ('eprom', 'owner');
  if v_count <> 2 then
    raise exception 'A project requires exactly one EPROM and one Owner party.' using errcode = '23514';
  end if;
  return null;
end;
$required$;
revoke execute on function public.check_required_project_parties() from public, anon, authenticated, service_role;
create constraint trigger check_required_project_parties
  after insert or update or delete on public.project_parties
  deferrable initially deferred for each row execute function public.check_required_project_parties();
create constraint trigger check_new_project_parties
  after insert on public.projects
  deferrable initially deferred for each row execute function public.check_required_project_parties();

-- Reuse the committed lock/version protocol, without changing any Structure code.
create trigger lock_project_setup_statement before insert or update or delete on public.project_parties
  for each statement execute function public.lock_project_setup_statement();
create trigger invalidate_setup_project_version before insert or update or delete on public.project_parties
  for each row execute function public.invalidate_setup_project_version();
create trigger set_updated_at before update on public.project_parties
  for each row execute function public.set_updated_at();

alter table public.project_parties enable row level security;
revoke all on table public.project_parties from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.project_parties to authenticated;
grant select, insert, update, delete on table public.project_parties to service_role;

-- Read follows projects' effective RLS. Write uses the existing Setup authority.
-- Clients cannot insert, edit, remove or repurpose required party rows.
create policy project_parties_select on public.project_parties
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_parties.project_id));
create policy project_parties_insert on public.project_parties
  for insert to authenticated
  with check (kind = 'subcontractor' and public.can_manage_project_setup(project_id));
create policy project_parties_update on public.project_parties
  for update to authenticated
  using (kind = 'subcontractor' and public.can_manage_project_setup(project_id))
  with check (kind = 'subcontractor' and public.can_manage_project_setup(project_id));
create policy project_parties_delete on public.project_parties
  for delete to authenticated
  using (kind = 'subcontractor' and public.can_manage_project_setup(project_id));

-- Existing save_project_setup_patch already delegates every supplied relation
-- to save_project_setup_relation atomically. Extend only this relation dispatcher;
-- existing branches, authorization, PT409, final-version confirmation and ACL stay intact.
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
    for v_item in select value from jsonb_array_elements(p_rows) loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or v_item->>'kind' is distinct from 'subcontractor'
         or jsonb_typeof(v_item->'name') is distinct from 'string'
         or length(btrim(v_item->>'name')) not between 1 and 140
         or (v_item ? 'id' and jsonb_typeof(v_item->'id') not in ('string', 'null')) then
        raise exception 'Invalid subcontractor row.' using errcode = '22023';
      end if;
      v_id := nullif(v_item->>'id', '')::uuid;
      if v_id is null then
        insert into public.project_parties(project_id, kind, name, sort_order)
        values (p_project, 'subcontractor', btrim(v_item->>'name'), cardinality(v_keep))
        returning id into v_id;
      else
        update public.project_parties
           set name = btrim(v_item->>'name'), sort_order = cardinality(v_keep)
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
