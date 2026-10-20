-- Phase 13.9B — Project Setup Governance — Step 4: structure / scope
-- governance (B17, closed; renames governed — owner decision 2026-10-16).
--
-- Architecture: docs/02_PLATFORM_ARCHITECTURE.md §26.24.2a; logical model:
-- docs/06_DATABASE_SCHEMA.md §10A.11.3, §10A.11.6, §10A.11.8.
--
-- WHAT THIS ADDS
--   1. Structured structure amendments in the EXISTING project_setup_amendments
--      model (no second approval system). A structure request names its
--      registry key (structure_units · structure_levels ·
--      structure_departments · structure_disciplines), an ACTION and a
--      target. previous_value is the server-read state of exactly that target
--      (the stale basis); proposed_value is {action, …payload, labels}. The new
--      target_key column lets unrelated targets be pending together while a
--      second request on the same target is refused (one pending request per
--      project, key and target).
--   2. request_project_structure_amendment() validates the action against the
--      live structure (the same rules the structure triggers enforce, checked
--      up front so a request that could never apply is refused at once).
--      decide_project_setup_amendment() is re-created to handle field and
--      structure requests: state changed or no longer valid → stale, nothing
--      applied; approved → applied atomically in the decision transaction by
--      project_setup_apply_structure().
--   3. guard_structure_setup_controlled — BEFORE INSERT / UPDATE / DELETE on
--      project_departments, project_disciplines, project_structure_levels and
--      project_structure_nodes. Once Controlled, a GOVERNED change is accepted
--      only in the transaction that approved the amendment for exactly that
--      target. Old and new values are compared, so unchanged saves pass;
--      display order, descriptions / notes, department lead and project
--      description stay free (and logged). Before Controlled nothing changes.
--   4. save_project_setup_relation(): the Programs & Studies branch applies
--      differences (one row per Program & Study, its unique key) instead of
--      deleting and re-inserting every row, so an unchanged save writes
--      nothing and the guard sees real changes only. Every other branch is the
--      live definition unchanged.
--   5. The Step 3 relation history also records Departments, Programs &
--      Studies, structure levels and structure units (one net before / after
--      row per record per transaction), so every applied or free structure
--      change appears in Project History.
--
-- UNCHANGED: every existing structure rule and trigger (2C.1c, 2C.3E archived
-- guards and the 13.6 people guards still answer first), structure
-- responsibilities and unit people (free, own history), the structure-family
-- correction, and the Step 1–3 field, finalisation and Reported Progress rules.
-- A unit is removed by archiving it once Controlled (safe archive; a delete is
-- a governed change no action requests).

/* ----------------------- 1. Amendment target key -------------------------- */

alter table public.project_setup_amendments add column target_key text not null default '';
comment on column public.project_setup_amendments.target_key is
  '13.9B Step 4. Empty for a field amendment. For a structure amendment, the target it changes: unit:<id>, add:<parent id|root>:<level>:<name>, levels, department:<id>, discipline:<id>. One pending request per project, field key and target.';
drop index public.project_setup_amendments_one_pending;
create unique index project_setup_amendments_one_pending
  on public.project_setup_amendments (project_id, field_key, target_key) where status = 'pending';

/* ------------------------- 2. State images (internal) --------------------- */

create function public.project_structure_unit_state(p_unit uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
           'id', n.id, 'level_number', n.level_number, 'parent_id', n.parent_id, 'name', n.name, 'code', n.code,
           'archived', n.archived_at is not null,
           'weekly_reporting_required', n.weekly_reporting_required,
           'monthly_reporting_required', n.monthly_reporting_required)
    from public.project_structure_nodes n where n.id = p_unit;
$fn$;

create function public.project_structure_level_state(p_project uuid, p_level integer)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('level_number', l.level_number, 'singular_label', l.singular_label, 'plural_label', l.plural_label)
    from public.project_structure_levels l where l.project_id = p_project and l.level_number = p_level;
$fn$;

-- The set of system ids a department's project scope holds (order ignored).
create function public.project_system_ids(p_systems jsonb)
returns jsonb language sql immutable set search_path = '' as $fn$
  select coalesce((select jsonb_agg(distinct s ->> 'id' order by s ->> 'id')
                     from jsonb_array_elements(coalesce(p_systems, '[]'::jsonb)) s), '[]'::jsonb);
$fn$;

-- The governed part of a department assignment: reporting and its systems.
create function public.project_department_state(p_project uuid, p_department uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
           'department_id', d.department_id,
           'reporting_required', d.reporting_required,
           'system_ids', public.project_system_ids(d.systems))
    from public.project_departments d where d.project_id = p_project and d.department_id = p_department;
$fn$;

create function public.project_discipline_state(p_project uuid, p_discipline uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('discipline_id', d.discipline_id, 'department_id', d.department_id, 'system_id', d.system_id)
    from public.project_disciplines d where d.project_id = p_project and d.discipline_id = p_discipline;
$fn$;

-- The stale basis of a structure request: the state of exactly its target.
create function public.project_structure_state(p_project uuid, p_field_key text, p_proposed jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_action text := p_proposed ->> 'action';
  v_unit uuid := nullif(p_proposed ->> 'unit_id', '')::uuid;
  v_parent uuid := nullif(p_proposed ->> 'parent_id', '')::uuid;
  v_level integer := nullif(p_proposed ->> 'level_number', '')::integer;
begin
  case p_field_key
    when 'structure_units' then
      if v_action = 'add' then
        return jsonb_build_object('parent', public.project_structure_unit_state(v_parent),
                                  'level', public.project_structure_level_state(p_project, v_level));
      elsif v_action = 'move' then
        return jsonb_build_object('unit', public.project_structure_unit_state(v_unit),
                                  'parent', public.project_structure_unit_state(v_parent));
      end if;
      return jsonb_build_object('unit', public.project_structure_unit_state(v_unit));
    when 'structure_levels' then
      return jsonb_build_object(
        'level', public.project_structure_level_state(p_project, v_level),
        'level_count', (select count(*) from public.project_structure_levels l where l.project_id = p_project));
    when 'structure_departments' then
      return jsonb_build_object('assignment',
        public.project_department_state(p_project, nullif(p_proposed ->> 'department_id', '')::uuid));
    when 'structure_disciplines' then
      return jsonb_build_object('assignment',
        public.project_discipline_state(p_project, nullif(p_proposed ->> 'discipline_id', '')::uuid));
  end case;
  raise exception '[FIELD_NOT_AMENDABLE] This is not a structure change.' using errcode = '22023';
end;
$fn$;

/* -------------------------- 3. Request validation ------------------------- */

-- The 2C.1c overlap rule (check_project_structure_node), checked up front:
-- a unit under p_parent, with its own flags and the flags of p_unit's
-- descendants, must not owe the same input as an ancestor or descendant.
create function public.project_structure_reporting_conflict(
  p_parent uuid, p_unit uuid, p_weekly boolean, p_monthly boolean
) returns text language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_cursor uuid := p_parent;
  v_next uuid;
  v_w boolean;
  v_m boolean;
  v_anc_weekly boolean := false;
  v_anc_monthly boolean := false;
  v_desc_weekly boolean := false;
  v_desc_monthly boolean := false;
begin
  while v_cursor is not null loop
    select n.parent_id, n.weekly_reporting_required, n.monthly_reporting_required into v_next, v_w, v_m
      from public.project_structure_nodes n where n.id = v_cursor;
    v_anc_weekly := v_anc_weekly or coalesce(v_w, false);
    v_anc_monthly := v_anc_monthly or coalesce(v_m, false);
    v_cursor := v_next;
  end loop;
  if p_unit is not null then
    with recursive d as (
      select c.id, c.weekly_reporting_required as w, c.monthly_reporting_required as m
        from public.project_structure_nodes c where c.parent_id = p_unit
      union all
      select c.id, c.weekly_reporting_required, c.monthly_reporting_required
        from public.project_structure_nodes c join d on c.parent_id = d.id)
    select coalesce(bool_or(d.w), false), coalesce(bool_or(d.m), false) into v_desc_weekly, v_desc_monthly from d;
  end if;
  if (v_anc_weekly and (p_weekly or v_desc_weekly)) or (p_weekly and v_desc_weekly) then
    return 'A unit and the units above or below it cannot all owe Weekly input.';
  end if;
  if (v_anc_monthly and (p_monthly or v_desc_monthly)) or (p_monthly and v_desc_monthly) then
    return 'A unit and the units above or below it cannot all owe Monthly input.';
  end if;
  return null;
end;
$fn$;

-- Validates a proposed structure change against the live structure. Returns
-- its target key, the target's name and the labels shown with the request;
-- raises the user's sentence otherwise.
create function public.project_structure_validate(p_project uuid, p_field_key text, p_proposed jsonb)
returns table (target_key text, target_label text, labels jsonb)
language plpgsql stable security definer set search_path = '' as $fn$
#variable_conflict use_column
declare
  v_action text := p_proposed ->> 'action';
  v_family text := (select p.structure_family from public.projects p where p.id = p_project);
  v_unit public.project_structure_nodes;
  v_parent public.project_structure_nodes;
  v_level integer;
  v_count integer;
  v_name text := nullif(btrim(coalesce(p_proposed ->> 'name', '')), '');
  v_code text := nullif(btrim(coalesce(p_proposed ->> 'code', '')), '');
  v_singular text := nullif(btrim(coalesce(p_proposed ->> 'singular_label', '')), '');
  v_plural text := nullif(btrim(coalesce(p_proposed ->> 'plural_label', '')), '');
  v_department uuid;
  v_discipline uuid;
  v_system uuid;
  v_weekly boolean;
  v_monthly boolean;
  v_current jsonb;
  v_ids jsonb;
  v_conflict text;
  v_level_label text;
begin
  if v_action is null then
    raise exception '[INVALID_STRUCTURE_CHANGE] Choose what to change.' using errcode = '22023';
  end if;
  if p_field_key in ('structure_units', 'structure_levels') and v_family is distinct from 'other' then
    raise exception '[INVALID_STRUCTURE_CHANGE] Only an Other project has a configurable Project Structure.' using errcode = '23514';
  end if;
  if p_field_key in ('structure_departments', 'structure_disciplines') and v_family = 'other' then
    raise exception '[INVALID_STRUCTURE_CHANGE] Departments, Systems and Programs & Studies belong to a PSM project.' using errcode = '23514';
  end if;

  begin
    v_department := nullif(p_proposed ->> 'department_id', '')::uuid;
    v_discipline := nullif(p_proposed ->> 'discipline_id', '')::uuid;
    v_system := nullif(p_proposed ->> 'system_id', '')::uuid;
    v_level := nullif(p_proposed ->> 'level_number', '')::integer;
    select * into v_unit from public.project_structure_nodes n
     where n.id = nullif(p_proposed ->> 'unit_id', '')::uuid and n.project_id = p_project;
    select * into v_parent from public.project_structure_nodes n
     where n.id = nullif(p_proposed ->> 'parent_id', '')::uuid and n.project_id = p_project;
  exception when invalid_text_representation then
    raise exception '[INVALID_STRUCTURE_CHANGE] The structure change is not valid.' using errcode = '22023';
  end;

  /* ---- Other: units ---- */
  if p_field_key = 'structure_units' then
    if v_action = 'add' then
      v_level_label := (select l.singular_label from public.project_structure_levels l
                         where l.project_id = p_project and l.level_number = v_level);
      if v_level_label is null then
        raise exception '[INVALID_STRUCTURE_CHANGE] Choose a defined structure level.' using errcode = '22023';
      end if;
      if v_level = 1 and p_proposed ->> 'parent_id' is not null then
        raise exception '[INVALID_STRUCTURE_CHANGE] A top-level unit has no parent.' using errcode = '22023';
      end if;
      if v_level > 1 and (v_parent.id is null or v_parent.level_number <> v_level - 1 or v_parent.archived_at is not null) then
        raise exception '[INVALID_STRUCTURE_CHANGE] Choose an active parent unit on the level directly above.' using errcode = '22023';
      end if;
      v_weekly := coalesce((p_proposed ->> 'weekly_reporting_required')::boolean, false);
      v_monthly := coalesce((p_proposed ->> 'monthly_reporting_required')::boolean, false);
    elsif v_unit.id is null then
      raise exception '[INVALID_STRUCTURE_CHANGE] That unit is not part of this project.' using errcode = '22023';
    end if;

    case v_action
      when 'add' then null;
      when 'rename' then
        if v_name = v_unit.name and v_code is not distinct from v_unit.code then
          raise exception '[NO_CHANGE] The new name and code are the same as the current ones.' using errcode = '22023';
        end if;
      when 'move' then
        if v_unit.level_number = 1 or v_parent.id is null or v_parent.level_number <> v_unit.level_number - 1
           or v_parent.archived_at is not null then
          raise exception '[INVALID_STRUCTURE_CHANGE] Choose an active parent unit on the level directly above.' using errcode = '22023';
        end if;
        if v_parent.id = v_unit.parent_id then
          raise exception '[NO_CHANGE] The unit already sits under that parent.' using errcode = '22023';
        end if;
        v_conflict := public.project_structure_reporting_conflict(
          v_parent.id, v_unit.id, v_unit.weekly_reporting_required, v_unit.monthly_reporting_required);
      when 'archive' then
        if v_unit.archived_at is not null then
          raise exception '[NO_CHANGE] The unit is already archived.' using errcode = '22023';
        end if;
        if exists (select 1 from public.project_structure_nodes c where c.parent_id = v_unit.id and c.archived_at is null) then
          raise exception '[ACTIVE_CHILDREN] Archive this unit''s child units first.' using errcode = '23514';
        end if;
        if exists (select 1 from public.project_structure_unit_members a where a.node_id = v_unit.id and a.ended_at is null) then
          raise exception '[UNIT_HAS_ACTIVE_PEOPLE] Remove this unit''s Lead, members and Weekly / Monthly responsibilities before archiving it.'
            using errcode = '23514';
        end if;
      when 'restore' then
        if v_unit.archived_at is null then
          raise exception '[NO_CHANGE] The unit is already active.' using errcode = '22023';
        end if;
        if v_unit.parent_id is not null and exists (select 1 from public.project_structure_nodes p
                                                      where p.id = v_unit.parent_id and p.archived_at is not null) then
          raise exception '[PARENT_ARCHIVED] Restore the parent unit first.' using errcode = '23514';
        end if;
      when 'set_reporting_scope' then
        if jsonb_typeof(p_proposed -> 'weekly_reporting_required') is distinct from 'boolean'
           or jsonb_typeof(p_proposed -> 'monthly_reporting_required') is distinct from 'boolean' then
          raise exception '[INVALID_STRUCTURE_CHANGE] Choose the unit''s Weekly and Monthly input.' using errcode = '22023';
        end if;
        v_weekly := (p_proposed ->> 'weekly_reporting_required')::boolean;
        v_monthly := (p_proposed ->> 'monthly_reporting_required')::boolean;
        if v_unit.archived_at is not null and (v_weekly or v_monthly) then
          raise exception '[INVALID_STRUCTURE_CHANGE] An archived unit owes no reporting input.' using errcode = '22023';
        end if;
        if v_weekly = v_unit.weekly_reporting_required and v_monthly = v_unit.monthly_reporting_required then
          raise exception '[NO_CHANGE] The unit''s reporting input is already set that way.' using errcode = '22023';
        end if;
        if v_unit.weekly_reporting_required and not v_weekly and exists (
             select 1 from public.project_structure_report_responsibilities r
              where r.node_id = v_unit.id and r.report_kind = 'weekly' and r.ended_at is null) then
          raise exception '[WEEKLY_RESPONSIBILITY_EXISTS] Remove this unit''s Weekly Responsible and Backup before turning off Weekly input.'
            using errcode = '23514';
        end if;
        if v_unit.monthly_reporting_required and not v_monthly and exists (
             select 1 from public.project_structure_report_responsibilities r
              where r.node_id = v_unit.id and r.report_kind = 'monthly' and r.ended_at is null) then
          raise exception '[MONTHLY_RESPONSIBILITY_EXISTS] Remove this unit''s Monthly Responsible and Backup before turning off Monthly input.'
            using errcode = '23514';
        end if;
        v_conflict := public.project_structure_reporting_conflict(v_unit.parent_id, v_unit.id, v_weekly, v_monthly);
      else
        raise exception '[INVALID_STRUCTURE_CHANGE] That structure change is not supported.' using errcode = '22023';
    end case;

    -- Names and codes (the active sibling-name and active-code unique rules).
    if v_action in ('add', 'rename') then
      if v_name is null or length(v_name) > 140 or length(coalesce(v_code, '')) > 40 then
        raise exception '[INVALID_STRUCTURE_CHANGE] A unit needs a name (140 characters at most) and an optional code (40 at most).'
          using errcode = '22023';
      end if;
    else
      v_name := v_unit.name;
      v_code := v_unit.code;
    end if;
    if v_action in ('add', 'rename', 'move', 'restore') and (v_action <> 'rename' or v_unit.archived_at is null) then
      if exists (select 1 from public.project_structure_nodes s
                  where s.project_id = p_project and s.archived_at is null and s.id is distinct from v_unit.id
                    and s.parent_id is not distinct from case when v_action in ('add', 'move') then v_parent.id else v_unit.parent_id end
                    and lower(s.name) = lower(v_name)) then
        raise exception '[DUPLICATE_UNIT] Another active unit with this name already sits under the same parent.' using errcode = '23505';
      end if;
      if v_code is not null and exists (select 1 from public.project_structure_nodes s
                                         where s.project_id = p_project and s.archived_at is null
                                           and s.id is distinct from v_unit.id and upper(s.code) = upper(v_code)) then
        raise exception '[DUPLICATE_UNIT] Another active unit already uses this code.' using errcode = '23505';
      end if;
    end if;
    if v_action = 'add' then
      v_conflict := public.project_structure_reporting_conflict(v_parent.id, null, v_weekly, v_monthly);
    end if;
    if v_conflict is not null then
      raise exception '[REPORTING_OVERLAP] %', v_conflict using errcode = '23514';
    end if;

    if v_action = 'add' then
      return query select 'add:' || coalesce(v_parent.id::text, 'root') || ':' || v_level || ':' || lower(v_name), v_name,
        jsonb_strip_nulls(jsonb_build_object('target', v_name, 'level', v_level_label, 'parent', v_parent.name));
    else
      return query select 'unit:' || v_unit.id::text, v_unit.name,
        jsonb_strip_nulls(jsonb_build_object(
          'target', v_unit.name,
          'level', (select l.singular_label from public.project_structure_levels l
                     where l.project_id = p_project and l.level_number = v_unit.level_number),
          'current_parent', (select p.name from public.project_structure_nodes p where p.id = v_unit.parent_id),
          'parent', case when v_action = 'move' then v_parent.name end));
    end if;
    return;
  end if;

  /* ---- Other: levels ---- */
  if p_field_key = 'structure_levels' then
    select count(*) into v_count from public.project_structure_levels l where l.project_id = p_project;
    v_current := public.project_structure_level_state(p_project, v_level);
    case v_action
      when 'rename_level' then
        if v_current is null then
          raise exception '[INVALID_STRUCTURE_CHANGE] That level is not defined.' using errcode = '22023';
        end if;
        if v_singular = v_current ->> 'singular_label' and v_plural = v_current ->> 'plural_label' then
          raise exception '[NO_CHANGE] The level already has those names.' using errcode = '22023';
        end if;
      when 'add_level' then
        if v_count >= 4 then
          raise exception '[LEVEL_LIMIT] A project structure has at most four levels.' using errcode = '22023';
        end if;
        if v_level is distinct from v_count + 1 then
          raise exception '[INVALID_STRUCTURE_CHANGE] A new level is added below the deepest one.' using errcode = '22023';
        end if;
      when 'remove_level' then
        if v_level is distinct from v_count or v_count <= 1 then
          raise exception '[INVALID_STRUCTURE_CHANGE] Only the deepest level can be removed, and one level always remains.'
            using errcode = '22023';
        end if;
        if exists (select 1 from public.project_structure_nodes n where n.project_id = p_project and n.level_number = v_level) then
          raise exception '[LEVEL_IN_USE] A level that has structure units cannot be removed.' using errcode = '23514';
        end if;
      else
        raise exception '[INVALID_STRUCTURE_CHANGE] That structure change is not supported.' using errcode = '22023';
    end case;
    if v_action in ('rename_level', 'add_level') then
      if v_singular is null or v_plural is null or length(v_singular) > 60 or length(v_plural) > 60 then
        raise exception '[INVALID_STRUCTURE_CHANGE] A level needs a singular and a plural name (60 characters at most).'
          using errcode = '22023';
      end if;
      if exists (select 1 from public.project_structure_levels l
                  where l.project_id = p_project and l.level_number <> v_level
                    and (lower(l.singular_label) = lower(v_singular) or lower(l.plural_label) = lower(v_plural))) then
        raise exception '[DUPLICATE_LABEL] Each level needs its own name.' using errcode = '23505';
      end if;
    end if;
    return query select 'levels'::text, coalesce(v_current ->> 'singular_label', v_singular),
      jsonb_strip_nulls(jsonb_build_object('target', coalesce(v_current ->> 'singular_label', v_singular),
                                           'current_plural', v_current ->> 'plural_label'));
    return;
  end if;

  /* ---- PSM: departments and their systems ---- */
  if p_field_key = 'structure_departments' then
    if v_department is null or not exists (select 1 from public.departments d where d.id = v_department) then
      raise exception '[INVALID_STRUCTURE_CHANGE] Choose a department.' using errcode = '22023';
    end if;
    v_current := public.project_department_state(p_project, v_department);
    if v_action in ('add_department', 'set_department_scope') then
      if jsonb_typeof(p_proposed -> 'system_ids') is distinct from 'array'
         or jsonb_typeof(p_proposed -> 'reporting_required') is distinct from 'boolean' then
        raise exception '[INVALID_STRUCTURE_CHANGE] Choose the department''s systems and whether it reports.' using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(p_proposed -> 'system_ids') s
                  where jsonb_typeof(s) <> 'string'
                     or not exists (select 1 from public.systems y
                                     where y.id::text = s #>> '{}' and y.department_id = v_department)) then
        raise exception '[INVALID_STRUCTURE_CHANGE] Every system must belong to the department.' using errcode = '22023';
      end if;
      v_ids := coalesce((select jsonb_agg(distinct s order by s) from jsonb_array_elements_text(p_proposed -> 'system_ids') s),
                        '[]'::jsonb);
    end if;
    case v_action
      when 'add_department' then
        if v_current is not null then
          raise exception '[NO_CHANGE] The department is already part of this project.' using errcode = '22023';
        end if;
      when 'remove_department' then
        if v_current is null then
          raise exception '[NO_CHANGE] The department is not part of this project.' using errcode = '22023';
        end if;
        if exists (select 1 from public.project_disciplines x where x.project_id = p_project and x.department_id = v_department) then
          raise exception '[INVALID_STRUCTURE_CHANGE] Move or remove the department''s Programs & Studies first.' using errcode = '23514';
        end if;
      when 'set_department_scope' then
        if v_current is null then
          raise exception '[INVALID_STRUCTURE_CHANGE] The department is not part of this project.' using errcode = '22023';
        end if;
        if (v_current -> 'system_ids') = v_ids
           and (v_current ->> 'reporting_required')::boolean = (p_proposed ->> 'reporting_required')::boolean then
          raise exception '[NO_CHANGE] The department''s scope is already set that way.' using errcode = '22023';
        end if;
        if exists (select 1 from public.project_disciplines x
                    where x.project_id = p_project and x.department_id = v_department
                      and x.system_id is not null and not v_ids ? x.system_id::text) then
          raise exception '[INVALID_STRUCTURE_CHANGE] A Program & Study is still assigned to a system this change removes. Move it first.'
            using errcode = '23514';
        end if;
      else
        raise exception '[INVALID_STRUCTURE_CHANGE] That structure change is not supported.' using errcode = '22023';
    end case;
    return query select 'department:' || v_department::text, (select d.name from public.departments d where d.id = v_department),
      jsonb_strip_nulls(jsonb_build_object(
        'target', (select d.name from public.departments d where d.id = v_department),
        'systems', case when v_ids is not null then coalesce((select jsonb_agg(y.name order by y.name) from public.systems y
                                                               where v_ids ? y.id::text), '[]'::jsonb) end,
        'current_systems', case when v_current is not null then
          coalesce((select jsonb_agg(y.name order by y.name) from public.systems y
                     where (v_current -> 'system_ids') ? y.id::text), '[]'::jsonb) end,
        'current_reporting_required', v_current -> 'reporting_required'));
    return;
  end if;

  /* ---- PSM: Programs & Studies (never merged with Disciplines) ---- */
  if p_field_key = 'structure_disciplines' then
    if v_discipline is null or not exists (select 1 from public.disciplines d where d.id = v_discipline) then
      raise exception '[INVALID_STRUCTURE_CHANGE] Choose a Program & Study.' using errcode = '22023';
    end if;
    v_current := public.project_discipline_state(p_project, v_discipline);
    if v_action in ('add_discipline', 'move_discipline') then
      if v_department is null or public.project_department_state(p_project, v_department) is null then
        raise exception '[INVALID_STRUCTURE_CHANGE] Choose a department that is part of this project.' using errcode = '22023';
      end if;
      if v_system is not null
         and not (public.project_department_state(p_project, v_department) -> 'system_ids') ? v_system::text then
        raise exception '[INVALID_STRUCTURE_CHANGE] Choose a system in the department''s project scope.' using errcode = '22023';
      end if;
    end if;
    case v_action
      when 'add_discipline' then
        if v_current is not null then
          raise exception '[NO_CHANGE] The Program & Study is already part of this project.' using errcode = '22023';
        end if;
      when 'remove_discipline' then
        if v_current is null then
          raise exception '[NO_CHANGE] The Program & Study is not part of this project.' using errcode = '22023';
        end if;
      when 'move_discipline' then
        if v_current is null then
          raise exception '[INVALID_STRUCTURE_CHANGE] The Program & Study is not part of this project.' using errcode = '22023';
        end if;
        if (v_current ->> 'department_id') is not distinct from v_department::text
           and (v_current ->> 'system_id') is not distinct from v_system::text then
          raise exception '[NO_CHANGE] The Program & Study already sits there.' using errcode = '22023';
        end if;
      else
        raise exception '[INVALID_STRUCTURE_CHANGE] That structure change is not supported.' using errcode = '22023';
    end case;
    return query select 'discipline:' || v_discipline::text, (select d.name from public.disciplines d where d.id = v_discipline),
      jsonb_strip_nulls(jsonb_build_object(
        'target', (select d.name from public.disciplines d where d.id = v_discipline),
        'department', (select d.name from public.departments d where d.id = v_department),
        'system', (select y.name from public.systems y where y.id = v_system),
        'current_department', (select d.name from public.departments d where d.id = (v_current ->> 'department_id')::uuid),
        'current_system', (select y.name from public.systems y where y.id = (v_current ->> 'system_id')::uuid)));
    return;
  end if;

  raise exception '[FIELD_NOT_AMENDABLE] This is not a structure change.' using errcode = '22023';
end;
$fn$;

/* ---------------------------- 4. Apply (internal) -------------------------- */

-- Applies an APPROVED structure change. Called only by
-- decide_project_setup_amendment() after the approved row is written in this
-- transaction; guard_structure_setup_controlled re-checks that binding row by
-- row, target by target.
create function public.project_setup_apply_structure(p_project uuid, p_field_key text, p_proposed jsonb)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  v_action text := p_proposed ->> 'action';
  v_unit uuid := nullif(p_proposed ->> 'unit_id', '')::uuid;
  v_parent uuid := nullif(p_proposed ->> 'parent_id', '')::uuid;
  v_level integer := nullif(p_proposed ->> 'level_number', '')::integer;
  v_department uuid := nullif(p_proposed ->> 'department_id', '')::uuid;
  v_discipline uuid := nullif(p_proposed ->> 'discipline_id', '')::uuid;
  v_systems jsonb;
  v_count integer;
begin
  if p_field_key = 'structure_units' then
    case v_action
      when 'add' then
        insert into public.project_structure_nodes (
          project_id, level_number, parent_id, name, code, description, sort_order,
          weekly_reporting_required, monthly_reporting_required)
        values (
          p_project, v_level, v_parent, btrim(p_proposed ->> 'name'),
          nullif(btrim(coalesce(p_proposed ->> 'code', '')), ''),
          nullif(btrim(coalesce(p_proposed ->> 'description', '')), ''),
          coalesce((select max(n.sort_order) + 1 from public.project_structure_nodes n
                     where n.project_id = p_project and n.parent_id is not distinct from v_parent), 0),
          coalesce((p_proposed ->> 'weekly_reporting_required')::boolean, false),
          coalesce((p_proposed ->> 'monthly_reporting_required')::boolean, false));
      when 'rename' then
        update public.project_structure_nodes
           set name = btrim(p_proposed ->> 'name'), code = nullif(btrim(coalesce(p_proposed ->> 'code', '')), '')
         where id = v_unit and project_id = p_project;
      when 'move' then
        update public.project_structure_nodes set parent_id = v_parent where id = v_unit and project_id = p_project;
      when 'archive' then
        update public.project_structure_nodes
           set archived_at = now(), weekly_reporting_required = false, monthly_reporting_required = false
         where id = v_unit and project_id = p_project;
      when 'restore' then
        update public.project_structure_nodes set archived_at = null where id = v_unit and project_id = p_project;
      when 'set_reporting_scope' then
        update public.project_structure_nodes
           set weekly_reporting_required = (p_proposed ->> 'weekly_reporting_required')::boolean,
               monthly_reporting_required = (p_proposed ->> 'monthly_reporting_required')::boolean
         where id = v_unit and project_id = p_project;
    end case;
  elsif p_field_key = 'structure_levels' then
    case v_action
      when 'rename_level' then
        update public.project_structure_levels
           set singular_label = btrim(p_proposed ->> 'singular_label'), plural_label = btrim(p_proposed ->> 'plural_label')
         where project_id = p_project and level_number = v_level;
      when 'add_level' then
        insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
        values (p_project, v_level, btrim(p_proposed ->> 'singular_label'), btrim(p_proposed ->> 'plural_label'));
      when 'remove_level' then
        delete from public.project_structure_levels where project_id = p_project and level_number = v_level;
    end case;
  elsif p_field_key = 'structure_departments' then
    if v_action in ('add_department', 'set_department_scope') then
      -- The stored shape ({id, name, code}); a retained system keeps its entry.
      select coalesce(jsonb_agg(coalesce(
               (select e from public.project_departments d, jsonb_array_elements(coalesce(d.systems, '[]'::jsonb)) e
                 where d.project_id = p_project and d.department_id = v_department and e ->> 'id' = y.id::text limit 1),
               jsonb_strip_nulls(jsonb_build_object('id', y.id, 'name', y.name, 'code', y.code)))
             order by y.name), '[]'::jsonb)
        into v_systems
        from public.systems y
       where (p_proposed -> 'system_ids') ? y.id::text;
    end if;
    case v_action
      when 'add_department' then
        insert into public.project_departments (project_id, department_id, reporting_required, systems)
        values (p_project, v_department, (p_proposed ->> 'reporting_required')::boolean, v_systems);
      when 'remove_department' then
        delete from public.project_departments where project_id = p_project and department_id = v_department;
      when 'set_department_scope' then
        update public.project_departments
           set reporting_required = (p_proposed ->> 'reporting_required')::boolean, systems = v_systems
         where project_id = p_project and department_id = v_department;
    end case;
  elsif p_field_key = 'structure_disciplines' then
    case v_action
      when 'add_discipline' then
        insert into public.project_disciplines (project_id, discipline_id, department_id, system_id)
        values (p_project, v_discipline, v_department, nullif(p_proposed ->> 'system_id', '')::uuid);
      when 'remove_discipline' then
        delete from public.project_disciplines where project_id = p_project and discipline_id = v_discipline;
      when 'move_discipline' then
        update public.project_disciplines
           set department_id = v_department, system_id = nullif(p_proposed ->> 'system_id', '')::uuid
         where project_id = p_project and discipline_id = v_discipline;
    end case;
  else
    raise exception 'project_setup_apply_structure(): % is not a structure key', p_field_key using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception '[STRUCTURE_CHANGE_FAILED] The structure change could not be applied. Reject the request and propose it again.'
      using errcode = 'PT409';
  end if;
end;
$fn$;

/* ------------------------------ 5. The guard ------------------------------ */

-- Whether this transaction approved the structure amendment for exactly this
-- key and target.
create function public.project_structure_change_authorised(p_project uuid, p_field_key text, p_target_key text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.project_setup_amendments a
     where a.project_id = p_project and a.field_key = p_field_key and a.target_key = p_target_key
       and a.status = 'approved' and a.applied_transaction_id = pg_catalog.pg_current_xact_id());
$fn$;

create function public.guard_structure_setup_controlled()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  -- Row images: the trigger serves four tables with different columns, so it
  -- reads them as jsonb (a record field missing from a table would fail).
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_project uuid := (v_row ->> 'project_id')::uuid;
  v_key text := case tg_table_name
                  when 'project_departments' then 'structure_departments'
                  when 'project_disciplines' then 'structure_disciplines'
                  when 'project_structure_levels' then 'structure_levels'
                  when 'project_structure_nodes' then 'structure_units' end;
  v_columns text[] := case tg_table_name
                        when 'project_departments' then array['department_id', 'reporting_required']
                        when 'project_disciplines' then array['discipline_id', 'department_id', 'system_id']
                        when 'project_structure_levels' then array['level_number', 'singular_label', 'plural_label']
                        when 'project_structure_nodes' then array['level_number', 'parent_id', 'name', 'code',
                                                                  'weekly_reporting_required', 'monthly_reporting_required'] end;
  v_governed boolean;
  v_target text;
begin
  if v_key is null then
    raise exception 'guard_structure_setup_controlled() is not defined for table %', tg_table_name using errcode = 'P0001';
  end if;
  -- Before Controlled every structure write behaves exactly as today. A
  -- whole-project delete cascades after the project row is gone.
  if not exists (select 1 from public.projects p where p.id = v_project)
     or not public.project_setup_controlled(v_project) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    -- BEFORE INSERT fires before ON CONFLICT is resolved: an upsert of an
    -- existing PSM assignment becomes an UPDATE, which is judged on its own.
    v_governed := case tg_table_name
      when 'project_departments' then not exists (
        select 1 from public.project_departments d
         where d.project_id = v_project and d.department_id = (v_new ->> 'department_id')::uuid)
      when 'project_disciplines' then not exists (
        select 1 from public.project_disciplines d
         where d.project_id = v_project and d.discipline_id = (v_new ->> 'discipline_id')::uuid)
      else true end;
  elsif tg_op = 'DELETE' then
    v_governed := true;
  else
    -- Old against new: only a changed governed column counts. Display order,
    -- descriptions / notes, department lead and project description are free.
    v_governed := exists (select 1 from unnest(v_columns) c where v_new -> c is distinct from v_old -> c)
      or (tg_table_name = 'project_departments'
          and public.project_system_ids(v_new -> 'systems') is distinct from public.project_system_ids(v_old -> 'systems'))
      or (tg_table_name = 'project_structure_nodes'
          and (v_new ->> 'archived_at' is null) is distinct from (v_old ->> 'archived_at' is null));
  end if;
  if not v_governed then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_target := case tg_table_name
    when 'project_departments' then 'department:' || (v_row ->> 'department_id')
    when 'project_disciplines' then 'discipline:' || (v_row ->> 'discipline_id')
    when 'project_structure_levels' then 'levels'
    else case when tg_op = 'INSERT'
              then 'add:' || coalesce(v_new ->> 'parent_id', 'root') || ':' || (v_new ->> 'level_number') || ':'
                   || lower(btrim(v_new ->> 'name'))
              else 'unit:' || (v_old ->> 'id') end
    end;
  if not public.project_structure_change_authorised(v_project, v_key, v_target) then
    raise exception '[SETUP_CONTROLLED] The project structure is controlled once Project Setup is controlled. Propose a structure change; another Project Control Admin or System Administrator must approve it.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

-- "guard_structure_setup_" sorts after block_archived_project_setup,
-- guard_project_structure_write and guard_structure_node_people, so the
-- archived, 2C.1c and 13.6 refusals still answer first.
create trigger guard_structure_setup_controlled
  before insert or update or delete on public.project_departments
  for each row execute function public.guard_structure_setup_controlled();
create trigger guard_structure_setup_controlled
  before insert or update or delete on public.project_disciplines
  for each row execute function public.guard_structure_setup_controlled();
create trigger guard_structure_setup_controlled
  before insert or update or delete on public.project_structure_levels
  for each row execute function public.guard_structure_setup_controlled();
create trigger guard_structure_setup_controlled
  before insert or update or delete on public.project_structure_nodes
  for each row execute function public.guard_structure_setup_controlled();

/* ------------------------------ 6. Request -------------------------------- */

create function public.request_project_structure_amendment(
  p_project uuid,
  p_field_key text,
  p_proposed jsonb,
  p_reason text
) returns public.project_setup_amendments
language plpgsql security definer set search_path = '' as $fn$
declare
  v_entry record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_allowed text[];
  v_target record;
  v_proposed jsonb;
  v_row public.project_setup_amendments;
begin
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_setup(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] Project Setup authority on this project is required to propose a structure change.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'P0002';
  end if;
  select * into v_entry from public.project_setup_registry_entry(p_field_key);
  v_allowed := case p_field_key
    when 'structure_units' then array['action', 'unit_id', 'parent_id', 'level_number', 'name', 'code', 'description',
                                      'weekly_reporting_required', 'monthly_reporting_required']
    when 'structure_levels' then array['action', 'level_number', 'singular_label', 'plural_label']
    when 'structure_departments' then array['action', 'department_id', 'system_ids', 'reporting_required']
    when 'structure_disciplines' then array['action', 'discipline_id', 'department_id', 'system_id'] end;
  if v_allowed is null or v_entry.kind is distinct from 'relation' or v_entry.field_class is distinct from 'governed' then
    raise exception '[FIELD_NOT_AMENDABLE] This is not a governed structure change.' using errcode = '22023';
  end if;
  if p_proposed is null or jsonb_typeof(p_proposed) <> 'object' then
    raise exception '[INVALID_STRUCTURE_CHANGE] Choose what to change.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception '[REASON_REQUIRED] A reason is required to propose a structure change.' using errcode = '22023';
  end if;

  -- Same lock order as every other setup writer: advisory lock, then rows.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if public.can_manage_project_setup(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] Project Setup authority on this project is required to propose a structure change.'
      using errcode = '42501';
  end if;
  perform 1 from public.projects where id = p_project for update;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its setup is read-only.' using errcode = '42501';
  end if;
  if not public.project_setup_controlled(p_project) then
    raise exception '[SETUP_NOT_CONTROLLED] Project Setup is not controlled yet. Change the structure directly.'
      using errcode = '22023';
  end if;

  -- Only the keys the action uses travel (plus the server-read labels).
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_proposed
    from jsonb_each(p_proposed) e
   where e.key = any (v_allowed) and e.value <> 'null'::jsonb;
  select * into v_target from public.project_structure_validate(p_project, p_field_key, v_proposed);
  if exists (select 1 from public.project_setup_amendments a
              where a.project_id = p_project and a.field_key = p_field_key
                and a.target_key = v_target.target_key and a.status = 'pending') then
    raise exception '[AMENDMENT_PENDING] % already has a structure change awaiting approval.', v_target.target_label
      using errcode = 'PT409';
  end if;

  insert into public.project_setup_amendments (
    project_id, field_key, target_key, amendment_class, previous_value, proposed_value, reason,
    impact_code, impact_warning, requested_by, requested_by_name, status
  ) values (
    p_project, p_field_key, v_target.target_key, 'governed',
    public.project_structure_state(p_project, p_field_key, v_proposed),
    v_proposed || jsonb_build_object('labels', v_target.labels), v_reason,
    v_entry.impact_code, v_entry.impact_warning, auth.uid(),
    (select full_name from public.profiles where id = auth.uid()), 'pending'
  ) returning * into v_row;
  return v_row;
end;
$fn$;

comment on function public.request_project_structure_amendment(uuid, text, jsonb, text) is
  '13.9B Step 4. Setup managers (can_manage_project_setup) propose a governed structure change of a Controlled project: {action, …} for structure_units (add · rename · move · archive · restore · set_reporting_scope), structure_levels (rename_level · add_level · remove_level), structure_departments (add_department · remove_department · set_department_scope) or structure_disciplines (add_discipline · remove_discipline · move_discipline). Pending until a different Project Control Admin or System Administrator decides it; previous_value is the target''s state, re-checked on approval.';

/* ------------------------------ 7. Decide --------------------------------- */

-- Re-created: identical for field amendments; a structure amendment re-reads
-- its target's state (changed -> stale), re-validates it (no longer valid ->
-- stale) and is applied in this transaction on approval.
create or replace function public.decide_project_setup_amendment(
  p_amendment uuid,
  p_decision text,
  p_comment text default null
) returns public.project_setup_amendments
language plpgsql security definer set search_path = '' as $fn$
declare
  v_row public.project_setup_amendments;
  v_label text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_current jsonb;
  v_structure boolean;
  v_invalid text;
begin
  if auth.uid() is null or public.current_user_role() is null then
    raise exception '[NOT_AUTHORIZED] Sign in to decide an amendment request.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception '[INVALID_DECISION] A decision is approve or reject.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  select * into v_row from public.project_setup_amendments where id = p_amendment for update;
  if not found then
    raise exception '[NOT_FOUND] Amendment request not found.' using errcode = 'P0002';
  end if;
  select label into v_label from public.project_setup_registry_entry(v_row.field_key);
  v_structure := v_row.target_key <> '';

  -- B24: an archived project's pending request is frozen, never altered.
  if public.project_is_archived(v_row.project_id) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its setup is read-only.' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception '[AMENDMENT_NOT_PENDING] This request was already %.', v_row.status using errcode = 'PT409';
  end if;
  -- B12: never the requester, whatever their role. No break-glass.
  if v_row.requested_by = auth.uid() then
    raise exception '[SELF_APPROVAL] You cannot decide your own amendment request. Another Project Control Admin or System Administrator must decide it.'
      using errcode = '42501';
  end if;
  if public.has_global_operational_authority() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a Project Control Admin or System Administrator can decide an amendment request.'
      using errcode = '42501';
  end if;

  if p_decision = 'reject' then
    if v_comment is null then
      raise exception '[DECISION_COMMENT_REQUIRED] A comment is required to reject a request.' using errcode = '22023';
    end if;
    update public.project_setup_amendments
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = v_comment,
           decided_by_name = (select full_name from public.profiles where id = auth.uid())
     where id = p_amendment returning * into v_row;
    return v_row;
  end if;

  perform 1 from public.projects where id = v_row.project_id for update;
  if v_structure then
    v_current := public.project_structure_state(v_row.project_id, v_row.field_key, v_row.proposed_value);
  else
    v_current := public.project_setup_field_value(v_row.project_id, v_row.field_key);
  end if;
  if v_current <> v_row.previous_value then
    -- State-based stale detection: record it, apply nothing, commit.
    update public.project_setup_amendments
       set status = 'stale', decided_at = now(),
           decision_comment = case when v_structure
                                   then 'The structure changed after this request; nothing was applied.'
                                   else 'The value changed after this request; nothing was applied.' end
     where id = p_amendment returning * into v_row;
    return v_row;
  end if;
  if v_structure then
    -- The target is unchanged, but its surroundings may have moved on (a
    -- sibling took the name, a child was added, …).
    begin
      perform 1 from public.project_structure_validate(
        v_row.project_id, v_row.field_key, v_row.proposed_value - 'labels');
    exception when others then
      v_invalid := regexp_replace(sqlerrm, '^\[[A-Z_]+\]\s*', '');
    end;
    if v_invalid is not null then
      update public.project_setup_amendments
         set status = 'stale', decided_at = now(),
             decision_comment = 'The structure changed after this request and it can no longer be applied: ' || v_invalid
       where id = p_amendment returning * into v_row;
      return v_row;
    end if;
  end if;
  if v_row.field_key = 'onboarding_mode' and public.project_onboarding_transition_rule(
       v_row.project_id, v_current ->> 'onboarding_mode', v_row.proposed_value ->> 'onboarding_mode') = 'prohibited' then
    raise exception '[ONBOARDING_TRANSITION_PROHIBITED] This project now has a Published Planning Snapshot, so its planning mode cannot change from % to %. Reject this request.',
      v_current ->> 'onboarding_mode', v_row.proposed_value ->> 'onboarding_mode' using errcode = '42501';
  end if;

  update public.project_setup_amendments
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = v_comment,
         decided_by_name = (select full_name from public.profiles where id = auth.uid()),
         applied_transaction_id = pg_catalog.pg_current_xact_id()
   where id = p_amendment returning * into v_row;
  if v_structure then
    perform public.project_setup_apply_structure(v_row.project_id, v_row.field_key, v_row.proposed_value);
  else
    perform public.project_setup_apply_value(v_row.project_id, v_row.field_key, v_row.proposed_value);
  end if;
  return v_row;
end;
$fn$;

comment on function public.decide_project_setup_amendment(uuid, text, text) is
  '13.9B / B12. A Project Control Admin or System Administrator OTHER than the requester approves or rejects a pending request. Approve re-checks the value (field) or the target state and validity (structure, Step 4): changed -> stale, nothing applied; otherwise applied in the same transaction. Archived project -> refused, request untouched (B24).';

/* ---------------------- 8. Structure in Project History ------------------- */

alter table public.project_setup_relation_changes drop constraint project_setup_relation_changes_relation_valid;
alter table public.project_setup_relation_changes add constraint project_setup_relation_changes_relation_valid
  check (relation in ('contacts', 'sites', 'parties', 'departments', 'disciplines', 'structure_levels', 'structure_units'));
comment on table public.project_setup_relation_changes is
  '13.9B Steps 3-4. Append-only history of Contacts, Sites, Parties, Departments, Programs & Studies, structure levels and structure units on a Controlled project: one net before / after row per record per transaction (docs/06 §10A.11.8). Written only by log_project_setup_relation_change(); readable by whoever can read the project.';

create or replace function public.project_setup_relation_image(p_relation text, p_row jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if p_row is null then
    return null;
  end if;
  if p_relation = 'contacts' then
    -- Project-level holders mirror projects.*_id (already logged).
    if p_row ->> 'role' in ('project_manager', 'project_control_manager', 'client_representative',
                            'reporting_coordinator', 'project_sponsor')
       and p_row ->> 'department_id' is null and p_row ->> 'system_id' is null
       and p_row ->> 'discipline_id' is null then
      return null;
    end if;
    return jsonb_build_object(
      'contact_id', p_row -> 'contact_id',
      'contact_name', (select c.name from public.contacts c where c.id = (p_row ->> 'contact_id')::uuid),
      'role', p_row -> 'role',
      'department_id', p_row -> 'department_id',
      'system_id', p_row -> 'system_id',
      'discipline_id', p_row -> 'discipline_id',
      'assignment_role', p_row -> 'assignment_role',
      'functional_title', p_row -> 'functional_title',
      'reports_to_contact_id', p_row -> 'reports_to_contact_id');
  elsif p_relation = 'sites' then
    return jsonb_build_object(
      'name', p_row -> 'name', 'country', p_row -> 'country', 'city', p_row -> 'city',
      'is_primary', p_row -> 'is_primary');
  elsif p_relation = 'parties' then
    return jsonb_build_object(
      'kind', p_row -> 'kind', 'name', p_row -> 'name', 'short_name', p_row -> 'short_name',
      'scope', p_row -> 'scope', 'contract_reference', p_row -> 'contract_reference',
      'engagement_status', p_row -> 'engagement_status');
  elsif p_relation = 'departments' then
    return jsonb_build_object(
      'department_id', p_row -> 'department_id',
      'department_name', (select d.name from public.departments d where d.id = (p_row ->> 'department_id')::uuid),
      'reporting_required', p_row -> 'reporting_required',
      'systems', coalesce((select jsonb_agg(s ->> 'name' order by s ->> 'name')
                             from jsonb_array_elements(coalesce(p_row -> 'systems', '[]'::jsonb)) s), '[]'::jsonb),
      'lead_name', p_row -> 'lead_name',
      'project_description', p_row -> 'project_description');
  elsif p_relation = 'disciplines' then
    return jsonb_build_object(
      'discipline_id', p_row -> 'discipline_id',
      'discipline_name', (select d.name from public.disciplines d where d.id = (p_row ->> 'discipline_id')::uuid),
      'department_name', (select d.name from public.departments d where d.id = (p_row ->> 'department_id')::uuid),
      'system_name', (select y.name from public.systems y where y.id = (p_row ->> 'system_id')::uuid));
  elsif p_relation = 'structure_levels' then
    return jsonb_build_object(
      'level_number', p_row -> 'level_number', 'singular_label', p_row -> 'singular_label',
      'plural_label', p_row -> 'plural_label');
  elsif p_relation = 'structure_units' then
    return jsonb_build_object(
      'level_number', p_row -> 'level_number',
      'level_label', (select l.singular_label from public.project_structure_levels l
                       where l.project_id = (p_row ->> 'project_id')::uuid
                         and l.level_number = (p_row ->> 'level_number')::integer),
      'name', p_row -> 'name', 'code', p_row -> 'code',
      'parent_name', (select n.name from public.project_structure_nodes n where n.id = (p_row ->> 'parent_id')::uuid),
      'archived', p_row ->> 'archived_at' is not null,
      'weekly_reporting_required', p_row -> 'weekly_reporting_required',
      'monthly_reporting_required', p_row -> 'monthly_reporting_required',
      'description', p_row -> 'description',
      'sort_order', p_row -> 'sort_order');
  end if;
  return null;
end;
$fn$;

create or replace function public.log_project_setup_relation_change()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_relation text := case tg_table_name
                       when 'project_contacts' then 'contacts'
                       when 'project_sites' then 'sites'
                       when 'project_parties' then 'parties'
                       when 'project_departments' then 'departments'
                       when 'project_disciplines' then 'disciplines'
                       when 'project_structure_levels' then 'structure_levels'
                       when 'project_structure_nodes' then 'structure_units' end;
  v_project uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  v_record uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  v_old jsonb;
  v_new jsonb;
  v_existing public.project_setup_relation_changes;
  v_prev jsonb;
begin
  if v_relation is null then
    raise exception 'log_project_setup_relation_change() is not defined for table %', tg_table_name
      using errcode = 'P0001';
  end if;
  -- A whole-project delete cascades here after the project row is gone.
  if not exists (select 1 from public.projects p where p.id = v_project)
     or not public.project_setup_controlled(v_project) then
    return null;
  end if;
  if tg_op <> 'INSERT' then v_old := public.project_setup_relation_image(v_relation, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then v_new := public.project_setup_relation_image(v_relation, to_jsonb(new)); end if;
  if v_old is null and v_new is null then
    return null;
  end if;

  select * into v_existing from public.project_setup_relation_changes
   where transaction_id = pg_catalog.pg_current_xact_id() and relation = v_relation and record_id = v_record
   for update;
  v_prev := case when found then v_existing.previous_value else v_old end;

  -- Only this trigger may revise a row it is still building (same transaction).
  perform set_config('eprp.relation_log_writer', 'on', true);
  if v_prev is not distinct from v_new then
    -- Net no-op within the transaction (e.g. a re-saved unchanged row).
    if v_existing.id is not null then
      delete from public.project_setup_relation_changes where id = v_existing.id;
    end if;
  elsif v_existing.id is not null then
    update public.project_setup_relation_changes
       set new_value = v_new, changed_at = now()
     where id = v_existing.id;
  else
    insert into public.project_setup_relation_changes
      (project_id, relation, record_id, previous_value, new_value, changed_by, changed_by_name)
    values (v_project, v_relation, v_record, v_prev, v_new, auth.uid(),
            (select p.full_name from public.profiles p where p.id = auth.uid()));
  end if;
  perform set_config('eprp.relation_log_writer', 'off', true);
  return null;
end;
$fn$;

-- "log_" sorts after every existing AFTER trigger on these tables
-- (check_project_structure_* included).
create trigger log_project_setup_relation_change
  after insert or update or delete on public.project_departments
  for each row execute function public.log_project_setup_relation_change();
create trigger log_project_setup_relation_change
  after insert or update or delete on public.project_disciplines
  for each row execute function public.log_project_setup_relation_change();
create trigger log_project_setup_relation_change
  after insert or update or delete on public.project_structure_levels
  for each row execute function public.log_project_setup_relation_change();
create trigger log_project_setup_relation_change
  after insert or update or delete on public.project_structure_nodes
  for each row execute function public.log_project_setup_relation_change();

/* ------------- 9. Programs & Studies save: differences only -------------- */

-- The live definition, with only the 'disciplines' branch changed.

create or replace function public.save_project_setup_relation(p_project uuid, p_expected_updated_at timestamp with time zone, p_relation text, p_rows jsonb)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
as $function$
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
    -- 13.9B Step 4: apply differences, keyed by the Program & Study (unique
    -- per project). An unchanged row is not touched, so an unchanged save
    -- writes nothing and, once Controlled, the structure guard judges only
    -- real changes. Still one transaction: a rejected row leaves every link.
    delete from public.project_disciplines pd
     where pd.project_id = p_project
       and not exists (
         select 1 from jsonb_to_recordset(p_rows) as x("disciplineId" uuid)
          where x."disciplineId" = pd.discipline_id
       );
    insert into public.project_disciplines (
      project_id, discipline_id, department_id, system_id
    )
    select p_project, x."disciplineId", x."departmentId", x."systemId"
      from jsonb_to_recordset(p_rows) as x(
        "disciplineId" uuid, "departmentId" uuid, "systemId" uuid
      )
    on conflict (project_id, discipline_id) do update
      set department_id = excluded.department_id,
          system_id = excluded.system_id
      where public.project_disciplines.department_id is distinct from excluded.department_id
         or public.project_disciplines.system_id is distinct from excluded.system_id;
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
$function$;

/* ------------------------------ 10. Grants -------------------------------- */

do $grants$
declare
  v_internal constant text[] := array[
    'public.project_structure_unit_state(uuid)',
    'public.project_structure_level_state(uuid,integer)',
    'public.project_system_ids(jsonb)',
    'public.project_department_state(uuid,uuid)',
    'public.project_discipline_state(uuid,uuid)',
    'public.project_structure_state(uuid,text,jsonb)',
    'public.project_structure_reporting_conflict(uuid,uuid,boolean,boolean)',
    'public.project_structure_validate(uuid,text,jsonb)',
    'public.project_setup_apply_structure(uuid,text,jsonb)',
    'public.project_structure_change_authorised(uuid,text,text)',
    'public.guard_structure_setup_controlled()',
    'public.project_setup_relation_image(text,jsonb)',
    'public.log_project_setup_relation_change()'];
  v_client constant text[] := array[
    'public.request_project_structure_amendment(uuid,text,jsonb,text)',
    'public.decide_project_setup_amendment(uuid,text,text)'];
  v_fn text;
begin
  foreach v_fn in array v_internal loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
  foreach v_fn in array v_client loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;
end;
$grants$;

/* ---------------------------- 11. Post-checks ----------------------------- */

do $post$
begin
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'guard_structure_setup_controlled') <> 4 then
    raise exception '13.9B Step 4 post-check failed: structure guards missing.';
  end if;
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'log_project_setup_relation_change') <> 7 then
    raise exception '13.9B Step 4 post-check failed: relation history triggers missing.';
  end if;
  -- The archived / 2C.1c / 13.6 guards still answer before the structure guard.
  if exists (select 1 from pg_catalog.pg_trigger g
              where g.tgname = 'guard_structure_setup_controlled'
                and not exists (select 1 from pg_catalog.pg_trigger b
                                 where b.tgrelid = g.tgrelid
                                   and b.tgname in ('block_archived_project_setup', 'guard_project_structure_write')
                                   and b.tgname < g.tgname)) then
    raise exception '13.9B Step 4 post-check failed: an archived guard does not answer first.';
  end if;
  if (select array_agg(a.attname::text order by k.ord)
        from pg_catalog.pg_index i
        cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
        join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
       where i.indexrelid = 'public.project_setup_amendments_one_pending'::regclass)
     is distinct from array['project_id', 'field_key', 'target_key'] then
    raise exception '13.9B Step 4 post-check failed: one-pending index is not per target.';
  end if;
  if (select prosrc from pg_catalog.pg_proc where oid = 'public.save_project_setup_relation(uuid,timestamptz,text,jsonb)'::regprocedure)
       like '%delete from public.project_disciplines where project_id = p_project;%' then
    raise exception '13.9B Step 4 post-check failed: the Programs & Studies save still replaces every row.';
  end if;
  if has_function_privilege('authenticated', 'public.project_setup_apply_structure(uuid,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.request_project_structure_amendment(uuid,text,jsonb,text)', 'EXECUTE') then
    raise exception '13.9B Step 4 post-check failed: structure function grants are wrong.';
  end if;
  if exists (select 1 from public.project_setup_field_registry()
              where field_key in ('structure_units', 'structure_levels', 'structure_departments', 'structure_disciplines')
                and (field_class <> 'governed' or enforced_from <> '13.9B-4')) then
    raise exception '13.9B Step 4 post-check failed: registry structure keys are not governed from 13.9B-4.';
  end if;
end;
$post$;

notify pgrst, 'reload schema';
