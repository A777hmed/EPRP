-- EPRP — Replace Person, Pass A: history foundation + transactional RPC.
--
-- Project -> Team & Responsibilities -> Replace Person. PROJECT-LEVEL,
-- RESPONSIBILITY-SCOPED: swaps who holds ONE already-identified assignment on
-- ONE project. Never a blanket "replace this person everywhere in the
-- project", never cross-project, never touches Auth/profiles/Users & Roles.
--
-- Mirrors the one existing precedent for this exact shape of problem —
-- position_assignment_history / assignContact() on the Organization Chart
-- (20260722000001_organization_charts.sql) — adapted to the three shapes
-- Team & Responsibilities actually stores a person in:
--   1. fixed_responsibility    — one of the five columns on public.projects,
--                                mirrored by a NULL-scoped public.project_contacts row
--   2. department_assignment   — the logical (project, department, person,
--                                assignment_role) unit, which may be backed by
--                                several public.project_contacts rows (one per
--                                scope item / discipline)
--   3. project_position        — one public.project_positions row
--
-- WHY A NEW TABLE RATHER THAN REUSING position_assignment_history
--   That table is owned by (position_id, chart_id) — the Organization Chart's
--   own identity. Team & Responsibilities has no "position" row for a fixed
--   responsibility or a department assignment, so there is nothing to key it
--   to. A parallel, purpose-built table is the smaller change; it does not
--   touch the Organization Chart's table, trigger, or service.
--
-- WHY A SINGLE SECURITY DEFINER FUNCTION RATHER THAN CLIENT-SIDE STEPS
--   The existing generic team persistence (replaceTeam / ensureResponsibility-
--   Contacts / pruneResponsibilityContacts in supabase-project-service.ts) is a
--   delete-then-insert diff keyed on row CONTENT, not row IDENTITY — reusing it
--   here would delete and recreate the very rows a history entry needs to point
--   at, and a client-side sequence of separate statements could leave a
--   replacement applied with no history row, or a history row with no applied
--   replacement, if the connection dropped mid-sequence. A single plpgsql
--   function commits atomically or not at all, matching the existing
--   set_weekly_report_status()/set_monthly_report_status() pattern
--   (20260820000005_report_lifecycle_enforcement.sql): authority is checked
--   FIRST so an unauthorized caller learns nothing, business rules are
--   re-validated at the data boundary, and every branch raises a human-readable
--   message tagged with a stable [REASON] prefix the application layer parses
--   into a semantic error — never a raw Postgres/UUID detail.
--
-- AUTHORIZATION — reuses the existing NARROW boundary, changes nothing else
--   can_manage_project_responsibilities() (20260824000001_authorization_
--   foundation_wave1.sql) already resolves to exactly the approved model for
--   this feature: active System Admin or Project Control Admin (global), or
--   the project's own assigned Project Control / Planning responsible —
--   Reporting Coordinator and Department User are NOT admitted. This is
--   already the function `project_positions` writes use; `project_contacts`
--   and `project_delegations` writes still use the wider
--   can_manage_project_setup() (which does admit Reporting Coordinator) — a
--   pre-existing inconsistency recorded in the Pass-0 read-only report. This
--   migration does not touch that inconsistency or any existing RLS policy:
--   Replace Person is authorized independently by this function calling
--   can_manage_project_responsibilities() directly, so it is correctly narrow
--   regardless of how the general project_contacts policies are ever
--   reconciled.
--
-- WHAT THIS DOES NOT TOUCH
--   No column, row, trigger, policy, or function on projects / project_contacts
--   / project_positions / project_delegations / profiles / weekly_* / monthly_*
--   is altered. No existing RLS policy is dropped or replaced. Additive only.

/* ------------------------ project_responsibility_history ------------------ */

create table public.project_responsibility_history (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,

  -- Which of the three shapes this event replaced. Exactly one of the
  -- shape-specific column groups below is populated, enforced by the CHECK.
  unit_kind            text not null,
  responsibility_role  text,               -- fixed_responsibility: project_contacts.role value
  department_id        uuid references public.departments(id) on delete set null,
  assignment_role      text,               -- department_assignment: department_manager / team_member_lead / team_member
  project_position_id  uuid references public.project_positions(id) on delete set null,

  previous_contact_id  uuid references public.contacts(id) on delete set null,
  contact_id           uuid references public.contacts(id) on delete set null,

  -- Required (MVP: plain text, no taxonomy). Enforced twice: NOT NULL here as
  -- the backstop, and by the RPC's own trimmed-non-empty check below, which is
  -- what actually produces a semantic [REASON_REQUIRED] error instead of a raw
  -- constraint violation.
  reason               text not null,

  created_by           uuid references auth.users(id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),

  constraint project_responsibility_history_unit_kind_valid
    check (unit_kind in ('fixed_responsibility', 'department_assignment', 'project_position')),

  -- One shape's identifying columns are populated, the other two shapes' are
  -- NULL — the same discipline the three assignment shapes already carry in
  -- project_contacts / project_positions, restated as a hard constraint since
  -- this table has no other way to say which shape a row describes.
  constraint project_responsibility_history_shape_valid check (
    (
      unit_kind = 'fixed_responsibility'
      and responsibility_role is not null
      and department_id is null and assignment_role is null and project_position_id is null
    ) or (
      unit_kind = 'department_assignment'
      and department_id is not null and assignment_role is not null
      and responsibility_role is null and project_position_id is null
    ) or (
      unit_kind = 'project_position'
      and project_position_id is not null
      and responsibility_role is null and department_id is null and assignment_role is null
    )
  )
);

create index idx_project_responsibility_history_project_id
  on public.project_responsibility_history(project_id);
create index idx_project_responsibility_history_previous_contact
  on public.project_responsibility_history(previous_contact_id);
create index idx_project_responsibility_history_contact
  on public.project_responsibility_history(contact_id);
create index idx_project_responsibility_history_created_at
  on public.project_responsibility_history(created_at desc);

comment on table public.project_responsibility_history is
  'Append-only record of Replace Person events on Team & Responsibilities. project_contacts / project_positions / the five columns on projects remain the source of CURRENT state; this table only records who held an assignment before a replacement. Written exclusively by replace_project_responsibility() — never directly by application code.';
comment on column public.project_responsibility_history.unit_kind is
  'Which of the three Team & Responsibilities shapes this event replaced: fixed_responsibility, department_assignment, or project_position.';
comment on column public.project_responsibility_history.reason is
  'Required free-text reason supplied by the person performing the replacement. Plain text, no taxonomy, in this MVP.';

alter table public.project_responsibility_history enable row level security;

-- Narrower than project_contacts/project_positions themselves (both Tier A,
-- `using (true)`, per 20260820000003_platform_read_visibility.sql). A current
-- responsibility is project structure; a governed log of WHO REPLACED WHOM AND
-- WHY is a different kind of exposure and is deliberately held to the
-- existing project-access boundary instead — the same predicate that already
-- gates Weekly access to this project (weekly_can_access_project():
-- 20260824000001_authorization_foundation_wave1.sql), already granted to
-- `authenticated`, already safe by construction: global authority, the
-- project's own Project Control/Report Coordinator, or anyone holding a
-- project_contacts row on it. This does not reopen or redesign cross-project
-- visibility anywhere else.
create policy project_responsibility_history_select
  on public.project_responsibility_history
  for select to authenticated
  using (public.weekly_can_access_project(project_id));

-- Deliberately NO insert/update/delete policy for `authenticated`. The only
-- writer is replace_project_responsibility(), a SECURITY DEFINER function
-- that inserts as its own (table-owning) role — matching the platform-owned,
-- append-only audit principle (02_PLATFORM_ARCHITECTURE.md §19): a normal
-- connection can read this table but can never write or rewrite it directly.

revoke insert, update, delete on public.project_responsibility_history from authenticated, anon;

/* --------------------------- replace_project_responsibility ---------------- */

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
  'Replace Person, Pass A. Swaps who holds ONE identified project responsibility (fixed role, department assignment unit, or project_positions row) and writes one project_responsibility_history row, atomically. Authorized by can_manage_project_responsibilities() — System Admin / Project Control Admin (global) or the projects own assigned Project Control / Planning only. Never touches Auth, profiles, Users & Roles, other projects, or historical report attribution.';

revoke execute on function public.replace_project_responsibility(uuid, text, uuid, uuid, text, uuid, text, uuid, text)
  from public, anon;
grant execute on function public.replace_project_responsibility(uuid, text, uuid, uuid, text, uuid, text, uuid, text)
  to authenticated, service_role;

/* ------------------------------- Post-check -------------------------------- */

do $post$
declare
  policy_count integer;
  write_policy_count integer;
begin
  select count(*) into policy_count
    from pg_policies
   where schemaname = 'public' and tablename = 'project_responsibility_history';
  if policy_count <> 1 then
    raise exception 'Post-check failed: expected exactly 1 policy on project_responsibility_history, found %.', policy_count;
  end if;

  select count(*) into write_policy_count
    from pg_policies
   where schemaname = 'public' and tablename = 'project_responsibility_history'
     and cmd <> 'SELECT';
  if write_policy_count <> 0 then
    raise exception 'Post-check failed: project_responsibility_history must have no direct write policy for authenticated — found %.', write_policy_count;
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'replace_project_responsibility'
       and p.prosecdef -- security definer
  ) then
    raise exception 'Post-check failed: replace_project_responsibility() must exist and be SECURITY DEFINER.';
  end if;

  if has_function_privilege('anon', 'public.replace_project_responsibility(uuid, text, uuid, uuid, text, uuid, text, uuid, text)', 'EXECUTE') then
    raise exception 'Post-check failed: anon must not be able to execute replace_project_responsibility().';
  end if;

  raise notice 'Replace Person Pass A installed: project_responsibility_history (read-open, no direct write policy) + replace_project_responsibility() (security definer, narrow authorization, anon execute revoked).';
end;
$post$;
