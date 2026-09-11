-- EPRP — Replace Person, Pass A correction: pre-validate project membership.
--
-- FOUND DURING LOCAL SMOKE TESTING (20260909), not by static review.
--
-- public.projects carries `trg_fixed_project_responsibility_membership`
-- (DEFERRABLE INITIALLY IMMEDIATE, from the pre-existing schema) and
-- public.project_positions carries `trg_project_position_membership`
-- (also pre-existing). Both require that a contact placed into a fixed
-- responsibility column or a project_positions row already holds SOME
-- public.project_contacts row on that project — see
-- guard_fixed_project_responsibility_membership() and
-- guard_project_position_membership().
--
-- replace_project_responsibility() (20260909000001) never checked this before
-- writing. Proven live: replacing a fixed responsibility with a person who is
-- not yet a project member raised the trigger's raw
-- `foreign_key_violation` — not wrapped in this function's own [TAG] message
-- convention, so the application layer's tag parser fell through to a fully
-- generic message instead of a specific, actionable one. The mutation was
-- correctly refused either way (the trigger did its job), but the refusal
-- reason was not what this function promises to produce.
--
-- FIX — additive, `create or replace function` only. No table, trigger,
-- policy or other function is touched. Two new pre-checks, one per affected
-- shape, each mirroring the trigger's own predicate so the refusal happens
-- with this function's own message before the write is even attempted:
--   fixed_responsibility — replacement must already hold a project_contacts
--     row on this project (any role) before becoming a fixed responsibility.
--   project_position     — same check, before becoming a project_positions
--     holder.
-- department_assignment is deliberately NOT touched: a department-assignment
-- replacement's own project_contacts row IS the membership being granted,
-- and no such trigger exists on project_contacts itself.
--
-- Everything else in the function — authorization, same-person, reason
-- requirement, active-replacement check, duplicate checks, manager conflict,
-- the compare-and-swap guards, reporting-line repoint, delegation counts, the
-- one-history-row guarantee — is unchanged, copied verbatim.

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
  if not public.can_manage_project_responsibilities(p_project) then
    raise exception '[UNAUTHORIZED] You do not have permission to change responsibilities on this project.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 2. Input shape.
  if p_unit_kind not in ('fixed_responsibility', 'department_assignment', 'project_position') then
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

    -- NEW (this migration): the same requirement
    -- guard_fixed_project_responsibility_membership() enforces at the data
    -- boundary — checked here so the refusal carries this function's own
    -- [TAG] message instead of the trigger's raw one reaching the caller.
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

    -- NEW (this migration): same reasoning as the fixed_responsibility branch
    -- above, mirroring guard_project_position_membership()'s own requirement.
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

comment on function public.replace_project_responsibility(uuid, text, uuid, uuid, text, uuid, text, uuid, text) is
  'Replace Person, Pass A (corrected 20260909000002: pre-validates project membership before writing a fixed responsibility or a project_positions row, matching the pre-existing membership triggers on those tables). Swaps who holds ONE identified project responsibility and writes one project_responsibility_history row, atomically. Authorized by can_manage_project_responsibilities() — System Admin / Project Control Admin (global) or the projects own assigned Project Control / Planning only. Never touches Auth, profiles, Users & Roles, other projects, or historical report attribution.';

/* ------------------------------- Post-check -------------------------------- */

do $post$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'replace_project_responsibility'
       and p.prosecdef
  ) then
    raise exception 'Post-check failed: replace_project_responsibility() must still exist and be SECURITY DEFINER after this correction.';
  end if;

  if has_function_privilege('anon', 'public.replace_project_responsibility(uuid, text, uuid, uuid, text, uuid, text, uuid, text)', 'EXECUTE') then
    raise exception 'Post-check failed: anon must still not be able to execute replace_project_responsibility().';
  end if;

  raise notice 'Replace Person membership pre-check installed: fixed_responsibility and project_position now refuse a non-member replacement with [NOT_PROJECT_MEMBER] before writing, instead of surfacing the trigger''s raw exception.';
end;
$post$;
