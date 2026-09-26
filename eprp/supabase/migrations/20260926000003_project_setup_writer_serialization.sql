-- Forward-only hardening of existing setup writers; migration 00002 first.
-- Existing master move validations and register synchronization are preserved.
create or replace function public.move_discipline_system(
  p_discipline_id uuid,
  p_department_id uuid,
  p_system_id     uuid,
  p_fields        jsonb default '{}'::jsonb
)
returns public.disciplines
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rec        public.disciplines;
  sys        public.systems;
  dept_name  text;
  sys_name   text;
  conflicts  text[] := '{}';
  fields     jsonb  := coalesce(p_fields, '{}'::jsonb);
  new_name   text;
  new_code   text;
  r          record;
  n          integer;
  moved      boolean;
begin
  if auth.uid() is null or public.current_user_role() is null
     or public.has_global_operational_authority() is distinct from true then
    raise exception 'Master data access is required.' using errcode = '42501';
  end if;
  -- Acquire the same setup lock BEFORE the existing discipline lock/reads.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if auth.uid() is null or public.current_user_role() is null
     or public.has_global_operational_authority() is distinct from true then
    raise exception 'Master data access is required.' using errcode = '42501';
  end if;
  select * into rec from public.disciplines
   where id = p_discipline_id
   for update;

  if not found then
    raise exception 'Record not found.' using errcode = 'no_data_found';
  end if;

  if p_department_id is null or p_system_id is null then
    raise exception
      'A Department and a System are both required — the hierarchy Project → Department → System → this level is mandatory.'
      using errcode = 'check_violation';
  end if;

  /* ---------- Validate the scalar half of the payload -------------------- */

  new_name := case when fields ? 'name'
                   then nullif(btrim(fields ->> 'name'), '')
                   else rec.name end;
  new_code := case when fields ? 'code'
                   then nullif(btrim(fields ->> 'code'), '')
                   else rec.code end;

  if new_name is null then
    raise exception 'Name is required.' using errcode = 'check_violation';
  end if;
  if new_code is null then
    raise exception 'Code is required.' using errcode = 'check_violation';
  end if;

  -- Case-insensitive, matching the service-layer check, so the same rename is
  -- refused the same way whichever path reaches the database.
  if exists (
    select 1 from public.disciplines d
     where d.id <> p_discipline_id
       and lower(btrim(d.name)) = lower(new_name)
  ) then
    raise exception 'This name already exists' using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from public.disciplines d
     where d.id <> p_discipline_id
       and d.code is not null
       and lower(btrim(d.code)) = lower(new_code)
  ) then
    raise exception 'This code already exists' using errcode = 'unique_violation';
  end if;

  /* ---------- Validate the hierarchy half -------------------------------- */

  select * into sys from public.systems where id = p_system_id;
  if not found then
    raise exception 'The selected System no longer exists.'
      using errcode = 'foreign_key_violation';
  end if;

  select name into dept_name from public.departments where id = p_department_id;
  if dept_name is null then
    raise exception 'The selected Department no longer exists.'
      using errcode = 'foreign_key_violation';
  end if;

  sys_name := sys.name;

  if sys.department_id is distinct from p_department_id then
    raise exception
      'System "%" does not belong to Department "%". Choose a System owned by that Department, or move the System first.',
      sys_name, dept_name
      using errcode = 'check_violation';
  end if;

  -- Recorded before the write, because the UPDATE below changes the values the
  -- test reads. Every register sync is gated on this: a pure rename cannot
  -- invalidate scope and must not touch the registers.
  moved := rec.department_id is distinct from p_department_id
        or rec.system_id     is distinct from p_system_id;

  -- Only when the hierarchy is actually changing do the affected projects
  -- need to be re-validated; a pure rename cannot invalidate their scope.
  if moved then

    for r in
      select distinct pd.project_id,
             coalesce(p.code, left(pd.project_id::text, 8)) as project_code,
             coalesce(p.short_name, p.name, '(unnamed project)') as project_name
        from public.project_disciplines pd
        left join public.projects p on p.id = pd.project_id
       where pd.discipline_id = p_discipline_id
       order by 2
    loop
      if not exists (
        select 1 from public.project_departments
         where project_id = r.project_id and department_id = p_department_id
      ) then
        conflicts := conflicts || format(
          '%s (%s): Department "%s" is not part of this project''s scope',
          r.project_code, r.project_name, dept_name);
        continue;
      end if;

      if not exists (
        select 1
          from public.project_departments pdept,
               lateral jsonb_array_elements(coalesce(pdept.systems, '[]'::jsonb)) elem
         where pdept.project_id    = r.project_id
           and pdept.department_id = p_department_id
           and elem ->> 'id'       = p_system_id::text
      ) then
        conflicts := conflicts || format(
          '%s (%s): System "%s" is not assigned to this project',
          r.project_code, r.project_name, sys_name);
        continue;
      end if;

      select count(*) into n
        from public.project_disciplines
       where project_id    = r.project_id
         and discipline_id = p_discipline_id;
      if n > 1 then
        conflicts := conflicts || format(
          '%s (%s): the project already has %s links to this record; the move would merge them into a duplicate',
          r.project_code, r.project_name, n);
      end if;
    end loop;

    if array_length(conflicts, 1) > 0 then
      raise exception 'Cannot move to System "%": % project(s) cannot accept it. %  Nothing was changed. Resolve these in Project Setup, then move again.',
        sys_name,
        array_length(conflicts, 1),
        array_to_string(conflicts, ' | ')
        using errcode = 'check_violation';
    end if;
  end if;

  /* ---------- Everything validated: write the whole edit at once --------- */

  update public.disciplines
     set name          = new_name,
         code          = new_code,
         description   = case when fields ? 'description'
                              then fields ->> 'description'
                              else description end,
         department_id = p_department_id,
         system_id     = p_system_id
   where id = p_discipline_id
   returning * into rec;

  update public.project_disciplines
     set department_id = p_department_id,
         system_id     = p_system_id
   where discipline_id = p_discipline_id
     and (department_id is distinct from p_department_id
          or system_id is distinct from p_system_id);

  /*
   * M5 — the master registers follow the same move, in this transaction.
   *
   * Both tables denormalize department_id and system_id alongside
   * discipline_id, so a Discipline that moves leaves them stale. They are
   * re-pointed here rather than by a caller, for the same reason the project
   * links are: a second statement could fail after this one commits.
   *
   * Rows already holding the target scope are excluded, so a re-run writes
   * nothing and updated_at is not churned. Archived rows are included
   * deliberately — history must stay consistent with the hierarchy it is read
   * against, and an archived record can be restored.
   */
  if moved then
    update public.master_milestones
       set department_id = p_department_id,
           system_id     = p_system_id
     where discipline_id = p_discipline_id
       and (department_id is distinct from p_department_id
            or system_id is distinct from p_system_id);

    update public.master_deliverables
       set department_id = p_department_id,
           system_id     = p_system_id
     where discipline_id = p_discipline_id
       and (department_id is distinct from p_department_id
            or system_id is distinct from p_system_id);
  end if;

  /* ---------- Verify before committing ----------------------------------- */

  if rec.system_id is distinct from p_system_id
     or rec.department_id is distinct from p_department_id then
    raise exception 'Post-move check failed: the master record did not take the target hierarchy.';
  end if;

  if rec.name is distinct from new_name or rec.code is distinct from new_code then
    raise exception 'Post-move check failed: the record did not take the edited values.';
  end if;

  select count(*) into n
    from public.project_disciplines
   where discipline_id = p_discipline_id
     and (system_id is distinct from p_system_id
          or department_id is distinct from p_department_id);
  if n > 0 then
    raise exception 'Post-move check failed: % project link(s) still hold the old System.', n;
  end if;

  select count(*) into n from (
    select project_id, discipline_id
      from public.project_disciplines
     where discipline_id = p_discipline_id
     group by 1, 2 having count(*) > 1) dup;
  if n > 0 then
    raise exception 'Post-move check failed: % duplicate project link(s) would be created.', n;
  end if;

  select count(*) into n
    from public.project_disciplines pd
   where pd.discipline_id = p_discipline_id
     and (not exists (select 1 from public.systems s where s.id = pd.system_id)
       or not exists (select 1 from public.departments d where d.id = pd.department_id)
       or not exists (select 1 from public.projects pr where pr.id = pd.project_id));
  if n > 0 then
    raise exception 'Post-move check failed: % orphan reference(s) detected.', n;
  end if;

  -- M5: the registers are verified on the same terms as the project links. A
  -- stale row here is the defect this migration exists to close, so it must
  -- roll the whole move back rather than be discovered later.
  select count(*) into n
    from public.master_milestones
   where discipline_id = p_discipline_id
     and (department_id is distinct from p_department_id
          or system_id is distinct from p_system_id);
  if n > 0 then
    raise exception 'Post-move check failed: % milestone(s) still hold the old scope.', n;
  end if;

  select count(*) into n
    from public.master_deliverables
   where discipline_id = p_discipline_id
     and (department_id is distinct from p_department_id
          or system_id is distinct from p_system_id);
  if n > 0 then
    raise exception 'Post-move check failed: % deliverable(s) still hold the old scope.', n;
  end if;

  return rec;
end;
$$;

revoke execute on function public.move_discipline_system(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.move_discipline_system(uuid, uuid, uuid, jsonb) to authenticated;
-- Preserve the existing last-membership prechecks, CAS and immutable history.
create or replace function public.replace_project_responsibility(
  p_project             uuid,
  p_unit_kind           text,
  p_from_contact        uuid,
  p_to_contact          uuid,
  p_responsibility_role text default null,
  p_department_id       uuid default null,
  p_assignment_role     text default null,
  p_position_id         uuid default null,
  p_reason              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_column_name                text;
  v_current_fixed_contact      uuid;
  v_to_active                  boolean;
  v_existing_unit_count        integer;
  v_remaining_membership_count integer;
  v_still_referenced           boolean;
  v_rows_updated               integer := 0;
  v_reports_repointed          integer := 0;
  v_delegations_as_delegate    integer := 0;
  v_delegations_requiring_review integer := 0;
  v_position_project           uuid;
  v_position_contact           uuid;
  v_position_job_title         uuid;
  v_reason                     text;
  v_history_id                 uuid;
begin
  -- 1. Authority FIRST — an unauthorized caller learns nothing about whether
  --    the project, the person, or the assignment exist. Reuses the existing
  --    narrow boundary verbatim; does not redefine it.
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_responsibilities(p_project) is distinct from true then
    raise exception '[UNAUTHORIZED] You do not have permission to change responsibilities on this project.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Serialize all three replacement shapes BEFORE inspecting assignments.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_responsibilities(p_project) is distinct from true then
    raise exception '[UNAUTHORIZED] You do not have permission to change responsibilities on this project.'
      using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.projects where id = p_project for update;
  if not found then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'no_data_found';
  end if;

  -- 2. Input shape.
  if p_unit_kind is null or p_unit_kind not in ('fixed_responsibility', 'department_assignment', 'project_position') then
    raise exception '[INVALID_INPUT] Unrecognized responsibility type.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_from_contact is null or p_to_contact is null then
    raise exception '[INVALID_INPUT] Both the current person and the replacement person are required.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_from_contact = p_to_contact then
    raise exception '[SAME_PERSON] Choose a different person to replace them with.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A replacement is a governed responsibility change, not a data edit — plain
  -- required text, no taxonomy, per the approved MVP scope. Computed once here
  -- so every later reference (and the history insert) uses the same trimmed
  -- value; the column's own NOT NULL is only the backstop.
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception '[REASON_REQUIRED] A reason is required to replace this responsibility.'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from public.projects where id = p_project) then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from public.contacts where id = p_from_contact) then
    raise exception '[NOT_FOUND] The person being replaced was not found.' using errcode = 'no_data_found';
  end if;

  select active into v_to_active from public.contacts where id = p_to_contact;
  if v_to_active is null then
    raise exception '[NOT_FOUND] Replacement person not found.' using errcode = 'no_data_found';
  end if;
  -- Inactive contacts are excluded from ordinary pickers (contactService.getAll()
  -- filters to active). The replacement candidate follows the same convention;
  -- the OUTGOING person is deliberately never checked for active status here —
  -- replacing an inactive person is a legitimate reason to use this feature,
  -- and their history must not be erased or blocked by their own inactivity.
  if not v_to_active then
    raise exception '[INACTIVE_REPLACEMENT] The replacement person is not active. Choose an active person.'
      using errcode = 'check_violation';
  end if;

  /* ------------------------- Shape 1: fixed responsibility ---------------- */
  if p_unit_kind = 'fixed_responsibility' then
    v_column_name := case p_responsibility_role
      when 'project_manager'         then 'project_manager_id'
      when 'project_control_manager' then 'project_control_manager_id'
      when 'reporting_coordinator'   then 'reporting_coordinator_id'
      when 'client_representative'   then 'client_representative_id'
      when 'project_sponsor'         then 'project_sponsor_id'
      else null
    end;
    if v_column_name is null then
      raise exception '[INVALID_INPUT] Unrecognized responsibility role.'
        using errcode = 'invalid_parameter_value';
    end if;

    execute format('select %I from public.projects where id = $1', v_column_name)
      into v_current_fixed_contact using p_project;

    if v_current_fixed_contact is distinct from p_from_contact then
      raise exception '[STALE_ASSIGNMENT] This responsibility is no longer held by the selected person. Reload and try again.'
        using errcode = 'no_data_found';
    end if;

    if exists (
      select 1 from public.project_contacts
       where project_id = p_project
         and role = p_responsibility_role
         and department_id is null and system_id is null
         and discipline_id is null and assignment_role is null
         and contact_id = p_to_contact
    ) then
      raise exception '[DUPLICATE_ASSIGNMENT] The replacement person already holds this responsibility.'
        using errcode = 'unique_violation';
    end if;

    if not exists (
      select 1 from public.project_contacts
       where project_id = p_project and contact_id = p_to_contact
    ) then
      raise exception '[NOT_PROJECT_MEMBER] The replacement person must already be part of this project before they can hold this responsibility.'
        using errcode = 'foreign_key_violation';
    end if;

    -- Compare-and-swap, not a blind write: the WHERE clause re-checks the OLD
    -- value inside the same statement that changes it, so a second concurrent
    -- Replace Person call on this exact column cannot silently overwrite a
    -- change the first one already committed. `v_column_name` is passed twice
    -- as separate %I arguments — both substitutions are the same
    -- whitelist-resolved identifier, never raw input.
    execute format(
      'update public.projects set %I = $1, updated_at = now() where id = $2 and %I = $3',
      v_column_name, v_column_name
    ) using p_to_contact, p_project, p_from_contact;
    get diagnostics v_rows_updated = row_count;
    if v_rows_updated = 0 then
      raise exception '[STALE_ASSIGNMENT] This responsibility is no longer held by the selected person. Reload and try again.'
        using errcode = 'no_data_found';
    end if;

    update public.project_contacts
       set contact_id = p_to_contact, updated_at = now()
     where project_id = p_project
       and role = p_responsibility_role
       and department_id is null and system_id is null
       and discipline_id is null and assignment_role is null
       and contact_id = p_from_contact;
    get diagnostics v_rows_updated = row_count;

    if v_rows_updated = 0 then
      -- Defensive: the mirrored project_contacts row is normally guaranteed by
      -- ensureResponsibilityContacts(), but the projects column is the
      -- authoritative value for fixed roles, so a missing mirror row is
      -- repaired rather than treated as a failure.
      insert into public.project_contacts (project_id, contact_id, role)
      values (p_project, p_to_contact, p_responsibility_role);
      v_rows_updated := 1;
    end if;

  /* ------------------------- Shape 2: department assignment --------------- */
  elsif p_unit_kind = 'department_assignment' then
    if p_department_id is null or p_assignment_role is null then
      raise exception '[INVALID_INPUT] Department and assignment role are required.'
        using errcode = 'invalid_parameter_value';
    end if;
    if p_assignment_role not in ('department_manager', 'team_member_lead', 'team_member') then
      raise exception '[INVALID_INPUT] Unrecognized assignment role.'
        using errcode = 'invalid_parameter_value';
    end if;

    if not exists (
      select 1 from public.project_departments
       where project_id = p_project and department_id = p_department_id
    ) then
      raise exception '[NOT_FOUND] This department is not part of the selected project.'
        using errcode = 'no_data_found';
    end if;

    select count(*) into v_existing_unit_count
      from public.project_contacts
     where project_id = p_project
       and department_id = p_department_id
       and role = 'team_member'
       and assignment_role = p_assignment_role
       and contact_id = p_from_contact;

    if v_existing_unit_count = 0 then
      raise exception '[STALE_ASSIGNMENT] This assignment is no longer held by the selected person. Reload and try again.'
        using errcode = 'no_data_found';
    end if;

    if exists (
      select 1 from public.project_contacts
       where project_id = p_project and department_id = p_department_id
         and role = 'team_member' and assignment_role = p_assignment_role
         and contact_id = p_to_contact
    ) then
      raise exception '[DUPLICATE_ASSIGNMENT] The replacement person already holds this role in this department.'
        using errcode = 'unique_violation';
    end if;

    -- Department Manager conflict: a genuinely different manager already on
    -- this department. Deliberately NOT the same check the UI's
    -- managerConflict() runs (assignment-rules.ts) — that predicate treats the
    -- CURRENT incumbent as the conflict, which is correct for "promote this
    -- person" but wrong here, since replacing the incumbent is exactly what
    -- this call is for. Only a THIRD person already holding
    -- department_manager is refused.
    if p_assignment_role = 'department_manager' and exists (
      select 1 from public.project_contacts
       where project_id = p_project and department_id = p_department_id
         and role = 'team_member' and assignment_role = 'department_manager'
         and contact_id <> p_from_contact
    ) then
      raise exception '[MANAGER_CONFLICT] Another person already manages this department. Resolve that conflict before replacing the manager.'
        using errcode = 'check_violation';
    end if;

    -- NEW (this migration): would this retarget leave the outgoing person with
    -- ZERO project_contacts rows on this project, while a fixed responsibility
    -- column or a project_positions row here still names them? Mirrors
    -- guard_project_contact_membership_removal()'s own predicate exactly —
    -- same two references, same project scope — so that trigger's refusal
    -- (which fires regardless, unchanged) is anticipated here with a semantic
    -- message instead of reaching the caller as a raw one. This does not
    -- reassign or remove the other responsibility, does not touch any other
    -- project, and does not weaken the trigger itself.
    select count(*) into v_remaining_membership_count
      from public.project_contacts
     where project_id = p_project
       and contact_id = p_from_contact
       and not (
         role = 'team_member'
         and department_id = p_department_id
         and assignment_role = p_assignment_role
       );

    if v_remaining_membership_count = 0 then
      select
        exists (
          select 1 from public.projects p
           where p.id = p_project
             and p_from_contact = any (array[
               p.project_manager_id,
               p.project_control_manager_id,
               p.client_representative_id,
               p.reporting_coordinator_id,
               p.project_sponsor_id
             ])
        )
        or exists (
          select 1 from public.project_positions pp
           where pp.project_id = p_project and pp.contact_id = p_from_contact
        )
        into v_still_referenced;

      if v_still_referenced then
        raise exception '[LAST_MEMBERSHIP_REFERENCED] This person still holds another project responsibility. Reassign that responsibility first before removing their final project team assignment.'
          using errcode = 'foreign_key_violation';
      end if;
    end if;

    -- `contact_id = p_from_contact` in the WHERE clause is the compare-and-swap
    -- guard: if a concurrent call already moved these rows off Person A since
    -- the count above, this matches zero rows rather than retargeting whatever
    -- is there now.
    update public.project_contacts
       set contact_id = p_to_contact, updated_at = now()
     where project_id = p_project
       and department_id = p_department_id
       and role = 'team_member'
       and assignment_role = p_assignment_role
       and contact_id = p_from_contact;
    get diagnostics v_rows_updated = row_count;
    if v_rows_updated = 0 then
      raise exception '[STALE_ASSIGNMENT] This assignment is no longer held by the selected person. Reload and try again.'
        using errcode = 'no_data_found';
    end if;

    -- Reporting-line repoint — Department Manager replacement only, and only
    -- within this same (project, department). Nothing outside it is touched.
    if p_assignment_role = 'department_manager' then
      -- The new manager reports to no one inside their own department — same
      -- invariant setAssignment() already enforces client-side. Handles the
      -- case where the replacement was previously a lead/member reporting to
      -- the outgoing manager, which would otherwise leave a self-reference.
      update public.project_contacts
         set reports_to_contact_id = null, updated_at = now()
       where project_id = p_project and department_id = p_department_id
         and contact_id = p_to_contact and reports_to_contact_id is not null;

      update public.project_contacts
         set reports_to_contact_id = p_to_contact, updated_at = now()
       where project_id = p_project and department_id = p_department_id
         and reports_to_contact_id = p_from_contact
         and contact_id <> p_to_contact;
      get diagnostics v_reports_repointed = row_count;
    end if;

    -- Delegations are detected, never transferred — nothing here writes to
    -- project_delegations. Two counts, deliberately named for what the schema
    -- can actually prove rather than what is merely likely:
    --   * delegations_as_delegate — provable fact: delegate_contact_id IS the
    --     outgoing person, so THEY personally hold a delegated Weekly
    --     responsibility in this department.
    --   * delegations_requiring_review — project_delegations has no delegator
    --     column, so which manager actually granted a given delegation is not
    --     a stored fact, only an implicit assumption. When a Department
    --     Manager is being replaced, every active delegation in the
    --     department is surfaced for a human to look at — NOT reported as
    --     "granted by the outgoing manager", which would claim more than the
    --     schema supports.
    select count(*) into v_delegations_as_delegate
      from public.project_delegations
     where project_id = p_project and department_id = p_department_id
       and delegate_contact_id = p_from_contact and active;

    if p_assignment_role = 'department_manager' then
      select count(*) into v_delegations_requiring_review
        from public.project_delegations
       where project_id = p_project and department_id = p_department_id
         and active;
    end if;

  /* ------------------------- Shape 3: project position --------------------- */
  elsif p_unit_kind = 'project_position' then
    if p_position_id is null then
      raise exception '[INVALID_INPUT] Position is required.'
        using errcode = 'invalid_parameter_value';
    end if;

    select project_id, contact_id, job_title_id
      into v_position_project, v_position_contact, v_position_job_title
      from public.project_positions
     where id = p_position_id;

    if v_position_project is null then
      raise exception '[NOT_FOUND] Position not found.' using errcode = 'no_data_found';
    end if;
    if v_position_project <> p_project then
      raise exception '[NOT_FOUND] This position does not belong to the selected project.'
        using errcode = 'no_data_found';
    end if;
    if v_position_contact is distinct from p_from_contact then
      raise exception '[STALE_ASSIGNMENT] This position is no longer held by the selected person. Reload and try again.'
        using errcode = 'no_data_found';
    end if;

    if exists (
      select 1 from public.project_positions
       where id <> p_position_id and project_id = p_project
         and job_title_id = v_position_job_title
         and contact_id = p_to_contact
    ) then
      raise exception '[DUPLICATE_ASSIGNMENT] The replacement person already holds this position.'
        using errcode = 'unique_violation';
    end if;

    if not exists (
      select 1 from public.project_contacts
       where project_id = p_project and contact_id = p_to_contact
    ) then
      raise exception '[NOT_PROJECT_MEMBER] The replacement person must already be part of this project before they can hold this position.'
        using errcode = 'foreign_key_violation';
    end if;

    -- `contact_id = p_from_contact` is the same compare-and-swap guard as the
    -- other two shapes: without it this statement matches by id alone and
    -- would blindly overwrite whoever holds the position NOW, regardless of
    -- whether it is still the person this call was validated against.
    update public.project_positions
       set contact_id = p_to_contact, updated_at = now()
     where id = p_position_id
       and contact_id = p_from_contact;
    get diagnostics v_rows_updated = row_count;
    if v_rows_updated = 0 then
      raise exception '[STALE_ASSIGNMENT] This position is no longer held by the selected person. Reload and try again.'
        using errcode = 'no_data_found';
    end if;
  end if;

  /* ------------------------------- History --------------------------------- */
  -- Exactly one row per call, regardless of how many project_contacts rows the
  -- department_assignment branch retargeted (v_rows_updated may be > 1 there)
  -- — one logical replacement is one governed event, never one per backing row.
  insert into public.project_responsibility_history (
    project_id, unit_kind, responsibility_role, department_id, assignment_role,
    project_position_id, previous_contact_id, contact_id, reason, created_by
  ) values (
    p_project, p_unit_kind, p_responsibility_role, p_department_id, p_assignment_role,
    p_position_id, p_from_contact, p_to_contact, v_reason,
    auth.uid()
  )
  returning id into v_history_id;

  return jsonb_build_object(
    'historyId', v_history_id,
    'unitKind', p_unit_kind,
    'rowsUpdated', v_rows_updated,
    'reportsRepointed', v_reports_repointed,
    'delegationsAsDelegate', v_delegations_as_delegate,
    'delegationsRequiringReview', v_delegations_requiring_review
  );
end;
$fn$;

-- Master-delete lock inventory (SET NULL / CASCADE into protected setup tables):
-- departments -> project_disciplines.department_id, project_contacts.department_id
-- systems -> project_disciplines.system_id, project_contacts.system_id
-- disciplines -> project_contacts.discipline_id
-- contacts -> projects.{project_control_manager_id,client_representative_id,
--   reporting_coordinator_id,project_sponsor_id}, project_contacts.reports_to_contact_id
-- project_phases -> projects.current_phase_id
-- portfolio_groups -> projects.portfolio_group_id
-- auth.users -> project_delegations.created_by
-- projects -> all six setup children: already protected by migration 00002.
-- RESTRICT / NO ACTION links cannot cascade into setup rows; leave them unchanged.
-- BEFORE STATEMENT runs before master row locks, including direct Data API,
-- database-function and FK-cascade deletes. RLS and privileges stay unchanged.
-- Explicit transactions must also acquire this lock BEFORE any earlier row lock.
do $master_delete_locks$
declare v_table text;
begin
  foreach v_table in array array['departments', 'systems', 'disciplines', 'contacts',
    'project_phases', 'portfolio_groups'] loop
    execute format('create trigger lock_project_setup_master_delete before delete on public.%I for each statement execute function public.lock_project_setup_statement()', v_table);
  end loop;
end;
$master_delete_locks$;

-- Auth deletion is a database-side writer, even though it is not a master-data UI action.
create trigger lock_project_setup_master_delete before delete on auth.users
  for each statement execute function public.lock_project_setup_statement();
