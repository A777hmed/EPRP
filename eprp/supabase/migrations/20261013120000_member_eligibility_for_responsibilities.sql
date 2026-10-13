-- Phase 2C.3E (final alignment): an ACTIVE member of the same project's
-- team is sufficient eligibility to TAKE OVER a fixed responsibility through
-- Replace Person, and to RECEIVE a project position (Project Information,
-- Replace Person or any write). A pre-existing project_contacts row is no
-- longer required to establish eligibility for either.
--
-- Three existing functions are redefined; no table, column, policy or
-- authority predicate changes and no row is written.
--
--   1. replace_project_responsibility() — ONLY its two eligibility
--      pre-checks change (fixed responsibility and project position): from
--      "has a project_contacts row" to "is an ACTIVE member of THIS project".
--      Everything else — authority, input checks, compare-and-swap, the role's
--      row moved or created, delegation handling, error tags and the one
--      history row per call — is the live definition unchanged.
--   2. guard_fixed_project_responsibility_membership() — a fixed holder must
--      have a project_contacts row (unchanged: a new project names its first
--      holders this way) OR an ACTIVE membership of this project (Replace
--      Person names a member before moving the role's row). Constraint
--      trigger timing unchanged.
--   3. guard_project_position_membership() — a NEW position holder must be an
--      ACTIVE member of this project (was: have a project_contacts row). An
--      unchanged row, including the setup save's upsert of an existing
--      position, is not re-checked, so a legacy holder never blocks an
--      unrelated save.
--
-- Unchanged: non-members, ended members and members of another project stay
-- refused (also by guard_fixed_holder_replacement /
-- guard_position_holder_replacement); no membership is ever created;
-- project_members grants no authority (no authorization helper reads it); a
-- filled responsibility carries only the authority that responsibility
-- already carries (Project Control / Reporting Coordinator through the role's
-- row, which Replace Person moves; positions none). PSM department rules and
-- archived read-only are unchanged.

/* --------------- 1. Replace Person: member eligibility -------------------- */

CREATE OR REPLACE FUNCTION public.replace_project_responsibility(p_project uuid, p_unit_kind text, p_from_contact uuid, p_to_contact uuid, p_responsibility_role text DEFAULT NULL::text, p_department_id uuid DEFAULT NULL::uuid, p_assignment_role text DEFAULT NULL::text, p_position_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    -- 2C.3E: an ACTIVE member of this project's team is eligible; a
    -- pre-existing project_contacts row is no longer required (the role's
    -- project_contacts row is moved, or created, below).
    if not exists (
      select 1 from public.project_members m
       where m.project_id = p_project and m.contact_id = p_to_contact and m.ended_at is null
    ) then
      raise exception '[NOT_PROJECT_MEMBER] Only an active member of this project''s team can take over this responsibility. Add the person to the Project Team first.'
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

    -- 2C.3E: an ACTIVE member of this project's team is eligible; a
    -- pre-existing project_contacts row is no longer required.
    if not exists (
      select 1 from public.project_members m
       where m.project_id = p_project and m.contact_id = p_to_contact and m.ended_at is null
    ) then
      raise exception '[NOT_PROJECT_MEMBER] Only an active member of this project''s team can take over this responsibility. Add the person to the Project Team first.'
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
$function$;

/* ----------- 2. Fixed responsibility holders: row OR active member ------- */

create or replace function public.guard_fixed_project_responsibility_membership() returns trigger
language plpgsql security definer set search_path = '' as $guard$
declare
  holder uuid;
begin
  foreach holder in array array[
    new.project_manager_id,
    new.project_control_manager_id,
    new.client_representative_id,
    new.reporting_coordinator_id,
    new.project_sponsor_id
  ]
  loop
    if holder is null then
      continue;
    end if;

    -- Serialize every membership check for this project/contact pair. This
    -- closes the race between assigning a responsibility and deleting its last
    -- membership row in another transaction.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.id::text || ':' || holder::text, 0)
    );

    perform 1
      from public.project_contacts pc
     where pc.project_id = new.id
       and pc.contact_id = holder
       for key share;

    if not found then
      -- 2C.3E: an ACTIVE member of this project's team is eligible too. The
      -- membership row is locked so it cannot end underneath (ending it is
      -- refused while the person holds a responsibility).
      perform 1
        from public.project_members m
       where m.project_id = new.id
         and m.contact_id = holder
         and m.ended_at is null
         for share;
      if not found then
        raise exception
          'A fixed Project Responsibility may only be assigned to a person already assigned to the same project.'
          using errcode = 'foreign_key_violation';
      end if;
    end if;
  end loop;
  return new;
end;
$guard$;

/* --------------- 3. Project positions: active member eligibility ---------- */

create or replace function public.guard_project_position_membership() returns trigger
language plpgsql security definer set search_path = '' as $guard$
begin
  -- Only a NEW holder is checked.
  if tg_op = 'UPDATE'
     and new.contact_id is not distinct from old.contact_id
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.project_positions p
     where p.id = new.id
       and p.project_id = new.project_id
       and p.contact_id is not distinct from new.contact_id
  ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.project_id::text || ':' || new.contact_id::text,
      0
    )
  );

  -- 2C.3E: eligibility is an ACTIVE membership of this project's team, locked
  -- so it cannot end underneath (ending it is refused while the person holds
  -- a position).
  perform 1
    from public.project_members m
   where m.project_id = new.project_id
     and m.contact_id = new.contact_id
     and m.ended_at is null
     for share;

  if not found then
    raise exception '[HOLDER_MEMBER_REQUIRED] Only an active member of this project''s team can take over this responsibility. Add the person to the Project Team first.'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;

/* ------------------------------ 4. Post-checks ---------------------------- */

do $post$
declare
  v_replace text := (select prosrc from pg_catalog.pg_proc where oid = 'public.replace_project_responsibility(uuid,text,uuid,uuid,text,uuid,text,uuid,text)'::regprocedure);
begin
  if v_replace ~ 'select 1 from public\.project_contacts\s+where project_id = p_project and contact_id = p_to_contact' then
    raise exception '2C.3E eligibility post-check failed: Replace Person still requires a project_contacts row.';
  end if;
  if (select count(*) from regexp_matches(v_replace, 'from public\.project_members m', 'g')) <> 2 then
    raise exception '2C.3E eligibility post-check failed: Replace Person member checks missing.';
  end if;
  if not has_function_privilege('authenticated', 'public.replace_project_responsibility(uuid,text,uuid,uuid,text,uuid,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.replace_project_responsibility(uuid,text,uuid,uuid,text,uuid,text,uuid,text)', 'EXECUTE') then
    raise exception '2C.3E eligibility post-check failed: Replace Person privileges changed.';
  end if;
  -- Membership stays authority-free.
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
                     or p.proname ~ '_accepts_department_input$')
                and p.prosrc ilike '%project_members%') then
    raise exception '2C.3E eligibility post-check failed: an authorization helper reads project_members.';
  end if;
end;
$post$;
