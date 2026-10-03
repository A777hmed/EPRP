-- Phase 2C.1 — Project Setup Classification.
--
-- Prepared for review; it has not been applied to any database.
--
-- Adds the first Project Setup choice (PSM Project / Other Project) as
-- `projects.structure_family`, reuses the existing `project_types` master as
-- the Project Category, and lets one category row accept a project-specific
-- custom name (`project_category_detail`).
--
--   * No backfill: every existing project keeps structure_family = NULL and is
--     read through the existing PSM code/name inference until classified.
--   * NULL -> psm/other is allowed once. After that the value is locked; the
--     only way to change it is correct_project_structure_family(), which is
--     System Admin only and writes an audit row first.
--   * No project_types rows are inserted, renamed or reclassified here.
--   * save_project_setup_patch() is re-created from 20260926000002 unchanged
--     apart from three additional editable columns, including the previously
--     unsaved portfolio_group_id (explicit bug fix).

/* ------------------------------ Columns ---------------------------------- */

alter table public.project_types
  add column allows_custom_name boolean not null default false;

comment on column public.project_types.allows_custom_name is
  'When true, an Other project choosing this Project Category must give a project-specific name in projects.project_category_detail. The custom name never becomes a master row.';

alter table public.projects
  add column structure_family text,
  add column project_category_detail text;

alter table public.projects
  add constraint projects_structure_family_valid
    check (structure_family is null or structure_family in ('psm', 'other')),
  add constraint projects_category_detail_not_blank
    check (project_category_detail is null or length(btrim(project_category_detail)) > 0),
  add constraint projects_other_requires_category
    check (structure_family is distinct from 'other' or project_type_id is not null),
  add constraint projects_category_detail_only_other
    check (project_category_detail is null or structure_family = 'other'),
  -- A PSM project has no Project Category. Legacy (NULL) projects are not
  -- touched: the rule applies only once a project is classified psm.
  add constraint projects_psm_has_no_category
    check (structure_family is distinct from 'psm' or project_type_id is null);

comment on column public.projects.structure_family is
  'First Project Setup choice: psm (Departments -> Systems -> Programs & Studies) or other. NULL = legacy, unclassified; read through the existing project-type inference. Locked once set; corrected only by correct_project_structure_family().';
comment on column public.projects.project_category_detail is
  'Project-specific category name for an Other project whose Project Category (project_types row) has allows_custom_name. Not a master-data row.';

/* ---------------------- Correction audit (append-only) -------------------- */

-- Each row records the WHOLE classification before and after: family,
-- category and custom name. Category and person names are snapshotted as text
-- so the history stays readable even if a category is later renamed or a
-- user removed; the ids are kept alongside, deliberately without foreign keys,
-- so history never blocks master-data maintenance or is rewritten by it.
create table public.project_classification_corrections (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects(id) on delete cascade,
  old_family              text not null,
  new_family              text not null,
  old_project_type_id     uuid,
  new_project_type_id     uuid,
  old_project_type_name   text,
  new_project_type_name   text,
  old_category_detail     text,
  new_category_detail     text,
  reason                  text not null,
  corrected_by            uuid references auth.users(id) on delete set null,
  corrected_by_name       text,
  corrected_at            timestamptz not null default now(),
  -- Ties the row to the transaction that changed the project. The lock
  -- trigger accepts a locked-family change only when this transaction wrote
  -- the matching row.
  transaction_id          xid8 not null default pg_catalog.pg_current_xact_id(),
  constraint project_classification_corrections_old_valid
    check (old_family in ('psm', 'other')),
  constraint project_classification_corrections_new_valid
    check (new_family in ('psm', 'other')),
  constraint project_classification_corrections_changes
    check (old_family <> new_family),
  constraint project_classification_corrections_reason_not_blank
    check (length(btrim(reason)) > 0),
  -- The recorded target is itself a valid classification: PSM carries no
  -- category, Other always carries one.
  constraint project_classification_corrections_new_psm_has_no_category
    check (new_family <> 'psm' or (new_project_type_id is null and new_category_detail is null)),
  constraint project_classification_corrections_new_other_has_category
    check (new_family <> 'other' or new_project_type_id is not null)
);

create index idx_project_classification_corrections_project
  on public.project_classification_corrections(project_id, corrected_at desc);

comment on table public.project_classification_corrections is
  'Append-only audit of System Admin corrections to a locked projects.structure_family, with the full before/after classification (family, Project Category, custom name). Written exclusively by correct_project_structure_family(); rows cannot be updated.';

-- Immutable: no UPDATE for anyone, the owner included. DELETE is left to the
-- project's own ON DELETE CASCADE (there is no direct delete grant).
create function public.prevent_classification_correction_update() returns trigger
language plpgsql
set search_path = ''
as $immutable$
begin
  raise exception 'Project Type correction history cannot be changed.' using errcode = '42501';
end;
$immutable$;

revoke execute on function public.prevent_classification_correction_update()
  from public, anon, authenticated, service_role;

create trigger prevent_classification_correction_update
  before update on public.project_classification_corrections
  for each row execute function public.prevent_classification_correction_update();

alter table public.project_classification_corrections enable row level security;

-- Same audience that manages the project's setup and operations. No write
-- policy: rows are written only by the security-definer correction function.
create policy project_classification_corrections_select
  on public.project_classification_corrections
  for select to authenticated
  using (public.can_manage_project_operations(project_id));

revoke all on public.project_classification_corrections from public, anon, authenticated;
grant select on public.project_classification_corrections to authenticated;

/* --------------------- PSM-family Project Category rule -------------------- */

-- The ONE database-side rule for "is this project_types row PSM-family?".
-- It mirrors the existing application rule isPsmProjectType() in
-- src/config/project-terminology.ts exactly, and is not a second model:
--   * a non-blank code decides: anchored PSM / PSAIM at a word boundary, so
--     PSAIM-01 matches and AIM-01 does not;
--   * only a row with no code falls back to its name ("process safety").
create function public.is_psm_family_project_type(p_code text, p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $psm_family$
  select case
    when nullif(btrim(coalesce(p_code, '')), '') is not null
      then btrim(p_code) ~* '^(PSM|PSAIM)\y'
    else coalesce(p_name, '') ~* 'process\s+safety'
  end;
$psm_family$;

comment on function public.is_psm_family_project_type(text, text) is
  'True for a PSM / PSAIM-family Project Category. Database mirror of isPsmProjectType() (project-terminology.ts): code ^(PSM|PSAIM)\b, else name /process\s+safety/i. An Other project may never use such a category.';

revoke execute on function public.is_psm_family_project_type(text, text) from public, anon;
grant execute on function public.is_psm_family_project_type(text, text) to authenticated;

/* ------------------------- Classification trigger ------------------------- */

create function public.enforce_project_classification() returns trigger
language plpgsql
security definer
set search_path = ''
as $classify$
declare
  v_check_category boolean;
  v_allows_custom  boolean;
  v_type_found     boolean;
  v_type_active    boolean;
  v_type_psm       boolean;
begin
  -- Locked family: a change away from a non-NULL value needs a correction row
  -- written by this same transaction.
  if tg_op = 'UPDATE' then
    if old.structure_family is not null
       and new.structure_family is distinct from old.structure_family then
      if not exists (
        select 1
          from public.project_classification_corrections c
         where c.project_id = new.id
           and c.old_family = old.structure_family
           and c.new_family is not distinct from new.structure_family
           and c.transaction_id = pg_catalog.pg_current_xact_id()
      ) then
        raise exception 'Project Type is locked once the project is saved. Only a System Admin correction can change it.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  -- Other project's category: an active, non-PSM-family row, with a custom
  -- name exactly when that row accepts one. Checked only when the
  -- classification actually changes, so later master-data edits (archiving,
  -- toggling allows_custom_name) never block unrelated project saves. Every
  -- write path reaches this: the Project Setup patch, direct table writes and
  -- the System Admin correction alike.
  if new.structure_family = 'other' then
    if tg_op = 'INSERT' then
      v_check_category := true;
    else
      v_check_category := new.structure_family is distinct from old.structure_family
        or new.project_type_id is distinct from old.project_type_id
        or new.project_category_detail is distinct from old.project_category_detail;
    end if;

    if v_check_category then
      select true, pt.active, pt.allows_custom_name,
             public.is_psm_family_project_type(pt.code, pt.name)
        into v_type_found, v_type_active, v_allows_custom, v_type_psm
        from public.project_types pt
       where pt.id = new.project_type_id;

      if v_type_found is distinct from true or v_type_active is distinct from true then
        raise exception 'Choose an active Project Category.' using errcode = '23514';
      end if;
      if v_type_psm then
        raise exception 'An Other project cannot use a PSM / PSAIM Project Category.'
          using errcode = '23514';
      end if;
      v_allows_custom := coalesce(v_allows_custom, false);

      if v_allows_custom and new.project_category_detail is null then
        raise exception 'Specify the category name for this Project Category.'
          using errcode = '23514';
      end if;
      if not v_allows_custom and new.project_category_detail is not null then
        raise exception 'A custom category name is only allowed for a Project Category that accepts one.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$classify$;

revoke execute on function public.enforce_project_classification()
  from public, anon, authenticated, service_role;

create trigger enforce_project_classification
  before insert or update of structure_family, project_type_id, project_category_detail
  on public.projects
  for each row execute function public.enforce_project_classification();

/* ------------------- System Admin correction (audited) -------------------- */

-- Corrects a locked PSM / Other choice to a complete, valid target
-- classification in one transaction:
--   * Other -> PSM: family psm, Project Category and custom name cleared.
--   * PSM -> Other: family other with an active, non-PSM-family Project
--     Category, plus the custom name exactly when that category requires one.
-- Messages carry a [TAG] the application maps to its own fixed wording, so no
-- raw database text reaches the user.
create function public.correct_project_structure_family(
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
      using errcode = '40001';
  end if;
  if v_old is null then
    raise exception '[NOT_CLASSIFIED] This project is not classified yet. Classify it from Project Setup instead.'
      using errcode = '22023';
  end if;
  if v_old = p_new_family then
    raise exception '[SAME_TYPE] The project already has this Project Type.' using errcode = '22023';
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

/* --------------- Project Setup patch: three more editable columns -------- */

grant update (structure_family, project_category_detail, portfolio_group_id)
  on public.projects to authenticated;

-- Body identical to 20260926000002 except the v_columns allowlist.
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
