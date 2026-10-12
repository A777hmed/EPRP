-- Phase 2C.3D Wave 1: Other Project Structure Responsibilities.
--
-- Additive. Other projects only. Connects the canonical project team
-- (public.project_members, 2C.3C) to the project's own structure units
-- (public.project_structure_nodes, 2C.1c) in two SEPARATE, authority-free
-- models:
--
--   * public.project_structure_unit_members — who works in a unit, and who
--     leads it. Many-to-many. A Lead is an extra 'lead' row beside the
--     person's normal 'member' row, so a Lead is always also a Unit Member,
--     and promoting / demoting a Lead never touches the member row that the
--     person's reporting responsibilities hang on.
--   * public.project_structure_report_responsibilities — who provides a unit's
--     Weekly / Monthly OPERATIONAL INPUT (Responsible) and the standing
--     alternate (Backup), per report type. Always held through the person's
--     active member row of that SAME unit.
--
-- Untouched: project_members' own rules (Reports To, Party, Project Role), the
-- unit Weekly / Monthly flags and their overlap rule (still the only place an
-- Other project declares which units owe input), project_contacts and every
-- PSM assignment, Department Manager authority, project_delegations, Replace
-- Person, and every authorization predicate.
--
-- AUTHORITY-FREE BY DESIGN. Unit Member, Unit Lead, Weekly / Monthly
-- Responsible and Backup grant no platform or project authority, and no
-- report-writing right. No authorization helper and no other table's policy
-- reads either new table; the post-check at the end refuses to finish if one
-- does.
--
-- History: rows are created active; ended_at is the only lifecycle field;
-- ended rows are immutable; nothing is ever physically deleted (except when
-- the whole project is deleted). No backfill: both tables start empty.
--
-- Writes go ONLY through save_structure_unit_responsibilities(): a hardened
-- SECURITY DEFINER function with explicit authority (System Admin / Project
-- Control Admin, or Project Control / Planning assigned to THIS project), the
-- archived-project refusal, the existing setup lock and the project-version
-- compare-and-swap. Authenticated callers hold SELECT only.
--
-- Refusals are explicit and tagged; nothing is ended silently:
--   * a project membership cannot end while the person has active unit rows;
--   * a unit member row cannot end while the person leads the unit or holds
--     one of its reporting responsibilities;
--   * a unit cannot be archived while it has active people;
--   * Weekly / Monthly input cannot be turned off while a responsibility for
--     it is active;
--   * a unit with any people history cannot be hard-deleted (archive it);
--   * a Backup needs an active Responsible; Responsible and Backup are
--     different people;
--   * Lead / Responsible / Backup need a COMPLETE project membership (Party
--     and Project Role). An incomplete legacy membership may still be a
--     normal unit member.

/* ------------------- 1. Unit membership and leadership ------------------- */

create table public.project_structure_unit_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  node_id     uuid not null,
  member_id   uuid not null,
  unit_role   text not null,
  ended_at    timestamptz,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint project_structure_unit_members_role_valid
    check (unit_role in ('member', 'lead')),
  -- The unit belongs to the SAME project. NO ACTION: a unit with people
  -- history can never be hard-deleted (guard_structure_node_people() refuses
  -- first, with a domain message); a project delete still cascades cleanly.
  constraint project_structure_unit_members_node_same_project
    foreign key (node_id, project_id)
    references public.project_structure_nodes (id, project_id),
  -- The person is a member of the SAME project.
  constraint project_structure_unit_members_member_same_project
    foreign key (project_id, member_id)
    references public.project_members (project_id, id),
  -- Target of the reporting-responsibility reference (same unit, same person).
  constraint project_structure_unit_members_identity
    unique (id, project_id, node_id, member_id),
  constraint project_structure_unit_members_ended_after_created
    check (ended_at is null or ended_at >= created_at)
);

-- One active Member row, and at most one active Lead row, per person per unit.
create unique index project_structure_unit_members_one_active
  on public.project_structure_unit_members (node_id, member_id, unit_role)
  where ended_at is null;
-- At most one active Lead per unit.
create unique index project_structure_unit_members_one_lead
  on public.project_structure_unit_members (node_id)
  where unit_role = 'lead' and ended_at is null;
create index project_structure_unit_members_project_node
  on public.project_structure_unit_members (project_id, node_id);
create index project_structure_unit_members_project_member
  on public.project_structure_unit_members (project_id, member_id);

comment on table public.project_structure_unit_members is
  'Phase 2C.3D. Who works in (unit_role = member) and who leads (unit_role = lead) an Other project''s structure unit. Many-to-many over active project_members; a Lead row requires the person''s active member row. AUTHORITY-FREE: no authorization helper may read this table. ended_at NULL = active; ended rows are history, never edited or deleted.';
comment on column public.project_structure_unit_members.unit_role is
  'member = works in the unit; lead = Unit Lead / Manager (an extra row beside the member row). Descriptive only: grants nothing.';
comment on column public.project_structure_unit_members.ended_at is
  'The single lifecycle field: NULL = active, set = ended. Ended rows are history.';

/* -------------- 2. Weekly / Monthly reporting responsibility ------------- */

create table public.project_structure_report_responsibilities (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  node_id         uuid not null,
  member_id       uuid not null,
  unit_member_id  uuid not null,
  report_kind     text not null,
  responsibility  text not null,
  ended_at        timestamptz,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint project_structure_report_responsibilities_kind_valid
    check (report_kind in ('weekly', 'monthly')),
  constraint project_structure_report_responsibilities_responsibility_valid
    check (responsibility in ('responsible', 'backup')),
  -- Held through the person's member row of the SAME unit, SAME project.
  constraint project_structure_report_responsibilities_same_unit_member
    foreign key (unit_member_id, project_id, node_id, member_id)
    references public.project_structure_unit_members (id, project_id, node_id, member_id),
  constraint project_structure_report_responsibilities_ended_after_created
    check (ended_at is null or ended_at >= created_at)
);

-- One active Responsible and one active Backup per unit per report type.
create unique index project_structure_report_responsibilities_one_active
  on public.project_structure_report_responsibilities (node_id, report_kind, responsibility)
  where ended_at is null;
-- The Responsible and the Backup are different people.
create unique index project_structure_report_responsibilities_distinct_people
  on public.project_structure_report_responsibilities (node_id, report_kind, member_id)
  where ended_at is null;
create index project_structure_report_responsibilities_project_node
  on public.project_structure_report_responsibilities (project_id, node_id);
create index project_structure_report_responsibilities_project_member
  on public.project_structure_report_responsibilities (project_id, member_id);
create index project_structure_report_responsibilities_unit_member
  on public.project_structure_report_responsibilities (unit_member_id);

comment on table public.project_structure_report_responsibilities is
  'Phase 2C.3D. Who provides an Other project structure unit''s Weekly / Monthly OPERATIONAL INPUT (responsible) and the standing alternate (backup). Only on units flagged for that report, only through the person''s active member row of the same unit. Configuration only: grants no authority and no report-writing right. ended_at NULL = active; history is never edited or deleted.';
comment on column public.project_structure_report_responsibilities.report_kind is
  'weekly or monthly. The unit''s matching weekly/monthly_reporting_required flag must be on.';
comment on column public.project_structure_report_responsibilities.responsibility is
  'responsible = accountable for the unit''s input for this report; backup = standing alternate (needs an active responsible). Temporary dated delegation is a separate, later model.';

/* ------------------------------ 3. Row guards ----------------------------- */

-- Unit membership rows. Every write path reaches this (the writer is the only
-- one open to clients; the table owner is bound by it too).
create function public.guard_structure_unit_member_write() returns trigger
language plpgsql security definer set search_path = '' as $guard$
declare
  v_family        text;
  v_node_found    boolean;
  v_node_archived timestamptz;
  v_member_found  boolean;
  v_member_ended  timestamptz;
  v_party         uuid;
  v_role          text;
begin
  if tg_op = 'DELETE' then
    -- A parent-project cascade removes the rows (the project itself is gone).
    if exists (select 1 from public.projects p where p.id = old.project_id) then
      raise exception '[ASSIGNMENT_HISTORY_PRESERVED] Structure unit assignments are history and are never deleted. End the assignment instead.'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if public.project_is_archived(new.project_id) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its responsibilities are read-only.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.ended_at is not null then
      raise exception '[ASSIGNMENT_MUST_START_ACTIVE] A new unit assignment must be active.' using errcode = '23514';
    end if;
    select p.structure_family into v_family from public.projects p where p.id = new.project_id;
    if v_family is distinct from 'other' then
      raise exception '[NOT_OTHER] Only an Other project assigns people to structure units.' using errcode = '23514';
    end if;
    select true, n.archived_at into v_node_found, v_node_archived
      from public.project_structure_nodes n
     where n.id = new.node_id and n.project_id = new.project_id;
    if v_node_found is distinct from true then
      raise exception '[UNIT_NOT_FOUND] This structure unit is not part of this project.' using errcode = '23514';
    end if;
    if v_node_archived is not null then
      raise exception '[UNIT_ARCHIVED] This structure unit is archived; its people are read-only.' using errcode = '23514';
    end if;
    select true, m.ended_at, m.party_id, m.project_role
      into v_member_found, v_member_ended, v_party, v_role
      from public.project_members m
     where m.id = new.member_id and m.project_id = new.project_id;
    if v_member_found is distinct from true or v_member_ended is not null then
      raise exception '[MEMBER_NOT_ACTIVE] Only an active member of this project can be assigned to a unit.' using errcode = '23514';
    end if;
    if new.unit_role = 'lead' then
      if v_party is null or v_role is null then
        raise exception '[MEMBERSHIP_INCOMPLETE] Complete this person''s Party and Project Role before making them accountable for a unit.'
          using errcode = '23514';
      end if;
      if not exists (select 1 from public.project_structure_unit_members a
                      where a.node_id = new.node_id and a.member_id = new.member_id
                        and a.unit_role = 'member' and a.ended_at is null) then
        raise exception '[LEAD_NOT_UNIT_MEMBER] The Unit Lead must be a member of this unit.' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE: the only change is ending an active row, once.
  if new.id is distinct from old.id or new.project_id is distinct from old.project_id
     or new.node_id is distinct from old.node_id or new.member_id is distinct from old.member_id
     or new.unit_role is distinct from old.unit_role or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception '[ASSIGNMENT_IMMUTABLE] A unit assignment keeps its unit, person and role. End it and add a new one instead.'
      using errcode = '23514';
  end if;
  if old.ended_at is not null then
    raise exception '[ASSIGNMENT_ENDED] An ended unit assignment is history and cannot be changed.' using errcode = '23514';
  end if;
  if new.ended_at is not null and old.unit_role = 'member' then
    if exists (select 1 from public.project_structure_unit_members a
                where a.node_id = old.node_id and a.member_id = old.member_id
                  and a.unit_role = 'lead' and a.ended_at is null) then
      raise exception '[UNIT_MEMBER_IS_LEAD] Remove this person as Unit Lead before removing them from the unit.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.project_structure_report_responsibilities r
                where r.unit_member_id = old.id and r.ended_at is null) then
      raise exception '[UNIT_MEMBER_HAS_RESPONSIBILITY] Reassign this person''s Weekly / Monthly responsibility before removing them from the unit.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_structure_unit_member_write() from public, anon, authenticated, service_role;

-- Reporting responsibility rows.
create function public.guard_structure_report_responsibility_write() returns trigger
language plpgsql security definer set search_path = '' as $guard$
declare
  v_unit_role     text;
  v_unit_ended    timestamptz;
  v_unit_found    boolean;
  v_node_archived timestamptz;
  v_weekly        boolean;
  v_monthly       boolean;
  v_member_ended  timestamptz;
  v_party         uuid;
  v_role          text;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.projects p where p.id = old.project_id) then
      raise exception '[ASSIGNMENT_HISTORY_PRESERVED] Reporting responsibilities are history and are never deleted. End the responsibility instead.'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if public.project_is_archived(new.project_id) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its responsibilities are read-only.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.ended_at is not null then
      raise exception '[ASSIGNMENT_MUST_START_ACTIVE] A new reporting responsibility must be active.' using errcode = '23514';
    end if;
    select true, a.unit_role, a.ended_at into v_unit_found, v_unit_role, v_unit_ended
      from public.project_structure_unit_members a
     where a.id = new.unit_member_id and a.project_id = new.project_id
       and a.node_id = new.node_id and a.member_id = new.member_id;
    if v_unit_found is distinct from true or v_unit_role <> 'member' or v_unit_ended is not null then
      raise exception '[RESPONSIBLE_NOT_UNIT_MEMBER] Weekly and Monthly responsibility must be held by an active member of this unit.'
        using errcode = '23514';
    end if;
    select n.archived_at, n.weekly_reporting_required, n.monthly_reporting_required
      into v_node_archived, v_weekly, v_monthly
      from public.project_structure_nodes n where n.id = new.node_id;
    if v_node_archived is not null then
      raise exception '[UNIT_ARCHIVED] This structure unit is archived; its people are read-only.' using errcode = '23514';
    end if;
    if new.report_kind = 'weekly' and v_weekly is distinct from true then
      raise exception '[UNIT_NOT_REPORTING] This unit does not provide Weekly input.' using errcode = '23514';
    end if;
    if new.report_kind = 'monthly' and v_monthly is distinct from true then
      raise exception '[UNIT_NOT_REPORTING] This unit does not provide Monthly input.' using errcode = '23514';
    end if;
    select m.ended_at, m.party_id, m.project_role into v_member_ended, v_party, v_role
      from public.project_members m where m.id = new.member_id and m.project_id = new.project_id;
    if v_member_ended is not null then
      raise exception '[MEMBER_NOT_ACTIVE] Only an active member of this project can be assigned to a unit.' using errcode = '23514';
    end if;
    if v_party is null or v_role is null then
      raise exception '[MEMBERSHIP_INCOMPLETE] Complete this person''s Party and Project Role before making them accountable for a unit.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.project_structure_report_responsibilities r
                where r.node_id = new.node_id and r.report_kind = new.report_kind
                  and r.member_id = new.member_id and r.ended_at is null) then
      raise exception '[SAME_PERSON] The Responsible and the Backup must be different people.' using errcode = '23514';
    end if;
    if new.responsibility = 'backup'
       and not exists (select 1 from public.project_structure_report_responsibilities r
                        where r.node_id = new.node_id and r.report_kind = new.report_kind
                          and r.responsibility = 'responsible' and r.ended_at is null) then
      raise exception '[BACKUP_WITHOUT_RESPONSIBLE] Assign the Responsible before the Backup.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.project_id is distinct from old.project_id
     or new.node_id is distinct from old.node_id or new.member_id is distinct from old.member_id
     or new.unit_member_id is distinct from old.unit_member_id
     or new.report_kind is distinct from old.report_kind or new.responsibility is distinct from old.responsibility
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
    raise exception '[ASSIGNMENT_IMMUTABLE] A reporting responsibility keeps its unit, person and type. End it and add a new one instead.'
      using errcode = '23514';
  end if;
  if old.ended_at is not null then
    raise exception '[ASSIGNMENT_ENDED] An ended reporting responsibility is history and cannot be changed.' using errcode = '23514';
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_structure_report_responsibility_write() from public, anon, authenticated, service_role;

-- A Backup never stands without an active Responsible for the same unit and
-- report. Checked when the transaction commits, so the writer can replace the
-- Responsible while an unchanged Backup stays (end old, add new) without
-- rewriting the Backup's history.
create function public.check_structure_report_backup() returns trigger
language plpgsql security definer set search_path = '' as $check$
begin
  if exists (select 1 from public.project_structure_report_responsibilities b
              where b.node_id = new.node_id and b.report_kind = new.report_kind
                and b.responsibility = 'backup' and b.ended_at is null)
     and not exists (select 1 from public.project_structure_report_responsibilities r
                      where r.node_id = new.node_id and r.report_kind = new.report_kind
                        and r.responsibility = 'responsible' and r.ended_at is null) then
    raise exception '[BACKUP_WITHOUT_RESPONSIBLE] A Backup needs an active Responsible for the same unit and report.'
      using errcode = '23514';
  end if;
  return null;
end;
$check$;
revoke execute on function public.check_structure_report_backup() from public, anon, authenticated, service_role;

-- Structure units (existing table): no archive, no flag-off, no hard delete
-- over people. A NEW trigger; the 2C.1c guards are not edited.
create function public.guard_structure_node_people() returns trigger
language plpgsql security definer set search_path = '' as $guard$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.projects p where p.id = old.project_id)
       and exists (select 1 from public.project_structure_unit_members a where a.node_id = old.id) then
      raise exception '[UNIT_HAS_PEOPLE_HISTORY] This unit has people history and cannot be deleted. Archive it instead.'
        using errcode = '23514';
    end if;
    return old;
  end if;
  if old.archived_at is null and new.archived_at is not null
     and exists (select 1 from public.project_structure_unit_members a
                  where a.node_id = old.id and a.ended_at is null) then
    raise exception '[UNIT_HAS_ACTIVE_PEOPLE] Remove this unit''s Lead, members and Weekly / Monthly responsibilities before archiving it.'
      using errcode = '23514';
  end if;
  if old.weekly_reporting_required and new.weekly_reporting_required is distinct from true
     and exists (select 1 from public.project_structure_report_responsibilities r
                  where r.node_id = old.id and r.report_kind = 'weekly' and r.ended_at is null) then
    raise exception '[WEEKLY_RESPONSIBILITY_EXISTS] Remove this unit''s Weekly Responsible and Backup before turning off Weekly input.'
      using errcode = '23514';
  end if;
  if old.monthly_reporting_required and new.monthly_reporting_required is distinct from true
     and exists (select 1 from public.project_structure_report_responsibilities r
                  where r.node_id = old.id and r.report_kind = 'monthly' and r.ended_at is null) then
    raise exception '[MONTHLY_RESPONSIBILITY_EXISTS] Remove this unit''s Monthly Responsible and Backup before turning off Monthly input.'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_structure_node_people() from public, anon, authenticated, service_role;

-- Project membership (existing table): no ending over active unit rows. A NEW
-- trigger; the 2C.3C guard is not edited.
create function public.guard_project_member_unit_assignments() returns trigger
language plpgsql security definer set search_path = '' as $guard$
begin
  if old.ended_at is null and new.ended_at is not null then
    if exists (select 1 from public.project_structure_report_responsibilities r
                where r.project_id = old.project_id and r.member_id = old.id and r.ended_at is null)
       or exists (select 1 from public.project_structure_unit_members a
                   where a.project_id = old.project_id and a.member_id = old.id
                     and a.unit_role = 'lead' and a.ended_at is null) then
      raise exception '[MEMBER_HAS_UNIT_RESPONSIBILITY] This person is a Unit Lead or holds a Weekly / Monthly responsibility. Reassign it before ending their membership.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.project_structure_unit_members a
                where a.project_id = old.project_id and a.member_id = old.id and a.ended_at is null) then
      raise exception '[MEMBER_HAS_UNIT_ASSIGNMENTS] This person still belongs to structure units. Remove them from those units before ending their membership.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_project_member_unit_assignments() from public, anon, authenticated, service_role;

/* ------------------------------- 4. Triggers ------------------------------ */

-- BEFORE row triggers fire alphabetically: each guard refuses before the
-- shared setup-version trigger advances the project.
create trigger guard_structure_unit_member_write
  before insert or update or delete on public.project_structure_unit_members
  for each row execute function public.guard_structure_unit_member_write();
create trigger guard_structure_report_responsibility_write
  before insert or update or delete on public.project_structure_report_responsibilities
  for each row execute function public.guard_structure_report_responsibility_write();
create constraint trigger check_structure_report_backup
  after insert or update on public.project_structure_report_responsibilities
  deferrable initially deferred
  for each row execute function public.check_structure_report_backup();
create trigger guard_structure_node_people
  before update or delete on public.project_structure_nodes
  for each row execute function public.guard_structure_node_people();
create trigger guard_project_member_unit_assignments
  before update on public.project_members
  for each row execute function public.guard_project_member_unit_assignments();

-- The committed setup lock / version protocol: a responsibility change makes
-- every older Project Setup page stale, exactly like a membership write.
do $setup_triggers$
declare v_table text;
begin
  foreach v_table in array array['project_structure_unit_members', 'project_structure_report_responsibilities'] loop
    execute format('create trigger lock_project_setup_statement before insert or update or delete on public.%I for each statement execute function public.lock_project_setup_statement()', v_table);
    execute format('create trigger invalidate_setup_project_version before insert or update or delete on public.%I for each row execute function public.invalidate_setup_project_version()', v_table);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', v_table);
  end loop;
end;
$setup_triggers$;

/* ------------------------- 5. Row level security -------------------------- */

alter table public.project_structure_unit_members enable row level security;
alter table public.project_structure_report_responsibilities enable row level security;
-- SELECT only, for everyone. No direct INSERT / UPDATE / DELETE: the writer is
-- the only write path, so its version check cannot be bypassed.
revoke all on table public.project_structure_unit_members from public, anon, authenticated, service_role;
revoke all on table public.project_structure_report_responsibilities from public, anon, authenticated, service_role;
grant select on table public.project_structure_unit_members to authenticated, service_role;
grant select on table public.project_structure_report_responsibilities to authenticated, service_role;

-- Read follows project visibility, like project_members and the structure.
create policy project_structure_unit_members_select on public.project_structure_unit_members
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_structure_unit_members.project_id));
create policy project_structure_report_responsibilities_select on public.project_structure_report_responsibilities
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_structure_report_responsibilities.project_id));

/* -------------------------- 6. The per-unit writer ------------------------ */

-- Saves ONE unit's people as a complete desired state: its members, Lead,
-- and Weekly / Monthly Responsible + Backup. Applies only the differences:
-- unchanged rows are untouched; removed rows are ended (never deleted) in
-- dependency order (responsibilities, then Lead, then members); new rows are
-- added in the reverse order. Nothing outside this unit is touched.
--
-- p_members / p_lead / p_* are project_members ids. Every Lead and reporting
-- person must also be listed in p_members.
create function public.save_structure_unit_responsibilities(
  p_project              uuid,
  p_expected_updated_at  timestamptz,
  p_node                 uuid,
  p_members              uuid[],
  p_lead                 uuid default null,
  p_weekly_responsible   uuid default null,
  p_weekly_backup        uuid default null,
  p_monthly_responsible  uuid default null,
  p_monthly_backup       uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $save$
declare
  v_members  uuid[] := coalesce(p_members, array[]::uuid[]);
  v_family   text;
  v_found    boolean;
  v_archived timestamptz;
  v_weekly   boolean;
  v_monthly  boolean;
  v_version  timestamptz;
  v_slot     record;
begin
  -- 1. Authority first: an active signed-in account that is System Admin /
  --    Project Control Admin, or Project Control / Planning on THIS project.
  if auth.uid() is null or public.current_user_role() is null
     or not (public.has_global_operational_authority() or public.is_project_control_planning(p_project)) then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s responsibilities.' using errcode = '42501';
  end if;

  -- 2. Shape of the desired state.
  if p_project is null or p_expected_updated_at is null or p_node is null then
    raise exception '[INVALID_INPUT] Project, version and unit are required.' using errcode = '22023';
  end if;
  if pg_catalog.array_position(v_members, null) is not null
     or (select count(*) from pg_catalog.unnest(v_members) x)
        <> (select count(distinct x) from pg_catalog.unnest(v_members) x) then
    raise exception '[INVALID_INPUT] Each unit member must be listed once.' using errcode = '22023';
  end if;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its responsibilities are read-only.' using errcode = '42501';
  end if;
  if p_lead is not null and not (p_lead = any (v_members)) then
    raise exception '[LEAD_NOT_UNIT_MEMBER] The Unit Lead must be a member of this unit.' using errcode = '23514';
  end if;
  if (p_weekly_responsible is not null and not (p_weekly_responsible = any (v_members)))
     or (p_weekly_backup is not null and not (p_weekly_backup = any (v_members)))
     or (p_monthly_responsible is not null and not (p_monthly_responsible = any (v_members)))
     or (p_monthly_backup is not null and not (p_monthly_backup = any (v_members))) then
    raise exception '[RESPONSIBLE_NOT_UNIT_MEMBER] Weekly and Monthly responsibility must be held by an active member of this unit.'
      using errcode = '23514';
  end if;
  if (p_weekly_backup is not null and p_weekly_responsible is null)
     or (p_monthly_backup is not null and p_monthly_responsible is null) then
    raise exception '[BACKUP_WITHOUT_RESPONSIBLE] Assign the Responsible before the Backup.' using errcode = '23514';
  end if;
  if p_weekly_backup = p_weekly_responsible or p_monthly_backup = p_monthly_responsible then
    raise exception '[SAME_PERSON] The Responsible and the Backup must be different people.' using errcode = '23514';
  end if;

  -- 3. The existing setup lock, authority again, then the version check.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if not (public.has_global_operational_authority() or public.is_project_control_planning(p_project)) then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s responsibilities.' using errcode = '42501';
  end if;
  update public.projects
     set updated_at = pg_catalog.clock_timestamp()
   where id = p_project and updated_at = p_expected_updated_at;
  if not found then
    raise exception '[STALE] Project Setup changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;
  select p.structure_family into v_family from public.projects p where p.id = p_project;
  if v_family is distinct from 'other' then
    raise exception '[NOT_OTHER] Only an Other project assigns people to structure units.' using errcode = '23514';
  end if;

  -- 4. The unit: this project's, active, and owing the reports being staffed.
  select true, n.archived_at, n.weekly_reporting_required, n.monthly_reporting_required
    into v_found, v_archived, v_weekly, v_monthly
    from public.project_structure_nodes n
   where n.id = p_node and n.project_id = p_project;
  if v_found is distinct from true then
    raise exception '[UNIT_NOT_FOUND] This structure unit is no longer available. Reload the page.' using errcode = 'P0002';
  end if;
  if v_archived is not null then
    raise exception '[UNIT_ARCHIVED] This structure unit is archived; its people are read-only.' using errcode = '23514';
  end if;
  if not v_weekly and (p_weekly_responsible is not null or p_weekly_backup is not null) then
    raise exception '[UNIT_NOT_REPORTING] This unit does not provide Weekly input.' using errcode = '23514';
  end if;
  if not v_monthly and (p_monthly_responsible is not null or p_monthly_backup is not null) then
    raise exception '[UNIT_NOT_REPORTING] This unit does not provide Monthly input.' using errcode = '23514';
  end if;

  -- 5. People: active members of THIS project; accountable roles complete.
  if exists (select 1 from pg_catalog.unnest(v_members) x
              where not exists (select 1 from public.project_members m
                                 where m.id = x and m.project_id = p_project and m.ended_at is null)) then
    raise exception '[MEMBER_NOT_ACTIVE] Only an active member of this project can be assigned to a unit.' using errcode = '23514';
  end if;
  if exists (select 1 from public.project_members m
              where m.id in (p_lead, p_weekly_responsible, p_weekly_backup, p_monthly_responsible, p_monthly_backup)
                and (m.party_id is null or m.project_role is null)) then
    raise exception '[MEMBERSHIP_INCOMPLETE] Complete this person''s Party and Project Role before making them accountable for a unit.'
      using errcode = '23514';
  end if;

  -- 6. End what is no longer wanted, in dependency order.
  update public.project_structure_report_responsibilities r
     set ended_at = pg_catalog.clock_timestamp()
   where r.node_id = p_node and r.ended_at is null
     -- Null-safe: a cleared slot (NULL) matches no row, so its row is ended.
     and not (   (r.report_kind = 'weekly'  and r.responsibility = 'responsible' and r.member_id is not distinct from p_weekly_responsible)
              or (r.report_kind = 'weekly'  and r.responsibility = 'backup'      and r.member_id is not distinct from p_weekly_backup)
              or (r.report_kind = 'monthly' and r.responsibility = 'responsible' and r.member_id is not distinct from p_monthly_responsible)
              or (r.report_kind = 'monthly' and r.responsibility = 'backup'      and r.member_id is not distinct from p_monthly_backup));
  update public.project_structure_unit_members a
     set ended_at = pg_catalog.clock_timestamp()
   where a.node_id = p_node and a.unit_role = 'lead' and a.ended_at is null
     and a.member_id is distinct from p_lead;
  update public.project_structure_unit_members a
     set ended_at = pg_catalog.clock_timestamp()
   where a.node_id = p_node and a.unit_role = 'member' and a.ended_at is null
     and not (a.member_id = any (v_members));

  -- 7. Add what is new: members, then the Lead, then Responsible before Backup.
  --    created_by keeps its column default, auth.uid(): the signed-in caller.
  insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role)
  select p_project, p_node, x, 'member'
    from pg_catalog.unnest(v_members) x
   where not exists (select 1 from public.project_structure_unit_members a
                      where a.node_id = p_node and a.member_id = x
                        and a.unit_role = 'member' and a.ended_at is null);
  if p_lead is not null
     and not exists (select 1 from public.project_structure_unit_members a
                      where a.node_id = p_node and a.member_id = p_lead
                        and a.unit_role = 'lead' and a.ended_at is null) then
    insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role)
    values (p_project, p_node, p_lead, 'lead');
  end if;
  for v_slot in
    select s.kind, s.responsibility, s.member_id
      from (values (1, 'weekly', 'responsible', p_weekly_responsible),
                   (2, 'weekly', 'backup', p_weekly_backup),
                   (3, 'monthly', 'responsible', p_monthly_responsible),
                   (4, 'monthly', 'backup', p_monthly_backup)) s(ord, kind, responsibility, member_id)
     where s.member_id is not null
     order by s.ord
  loop
    if not exists (select 1 from public.project_structure_report_responsibilities r
                    where r.node_id = p_node and r.report_kind = v_slot.kind
                      and r.responsibility = v_slot.responsibility
                      and r.member_id = v_slot.member_id and r.ended_at is null) then
      insert into public.project_structure_report_responsibilities
        (project_id, node_id, member_id, unit_member_id, report_kind, responsibility)
      select p_project, p_node, v_slot.member_id, a.id, v_slot.kind, v_slot.responsibility
        from public.project_structure_unit_members a
       where a.node_id = p_node and a.member_id = v_slot.member_id
         and a.unit_role = 'member' and a.ended_at is null;
    end if;
  end loop;

  select updated_at into strict v_version from public.projects where id = p_project;
  return pg_catalog.jsonb_build_object('node_id', p_node, 'version', v_version);
end;
$save$;
revoke execute on function public.save_structure_unit_responsibilities(uuid, timestamptz, uuid, uuid[], uuid, uuid, uuid, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.save_structure_unit_responsibilities(uuid, timestamptz, uuid, uuid[], uuid, uuid, uuid, uuid, uuid)
  to authenticated;

/* ------------------------------ 7. Post-checks ---------------------------- */

do $post$
declare
  v_table    text;
  v_helpers  text;
  v_policies text;
  v_has_rows boolean;
begin
  foreach v_table in array array['project_structure_unit_members', 'project_structure_report_responsibilities'] loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = v_table) then
      raise exception '2C.3D post-check failed: RLS is not enabled on %.', v_table;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
       or has_table_privilege('authenticated', 'public.' || v_table, 'TRUNCATE')
       or has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       or has_table_privilege('anon', 'public.' || v_table, 'INSERT')
       or has_table_privilege('anon', 'public.' || v_table, 'UPDATE')
       or has_table_privilege('anon', 'public.' || v_table, 'DELETE') then
      raise exception '2C.3D post-check failed: % must be SELECT-only for authenticated and closed to anon.', v_table;
    end if;
    if exists (select 1 from pg_catalog.pg_policies
                where schemaname = 'public' and tablename = v_table and cmd <> 'SELECT') then
      raise exception '2C.3D post-check failed: a write policy exists on %.', v_table;
    end if;
    execute format('select exists (select 1 from public.%I)', v_table) into v_has_rows;
    if v_has_rows then
      raise exception '2C.3D post-check failed: % must start empty (no backfill).', v_table;
    end if;
  end loop;

  if not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'save_structure_unit_responsibilities'
                    and p.prosecdef and p.proconfig @> array['search_path=""']
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and not has_function_privilege('anon', p.oid, 'EXECUTE')
                    and not has_function_privilege('service_role', p.oid, 'EXECUTE')) then
    raise exception '2C.3D post-check failed: the writer must be SECURITY DEFINER, empty search_path, EXECUTE for authenticated only.';
  end if;

  -- Structure responsibilities (and membership) grant no authority.
  select string_agg(p.proname, ', ' order by p.proname) into v_helpers
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
          or p.proname ~ '_accepts_department_input$')
     and (p.prosrc ilike '%project_structure_unit_members%'
          or p.prosrc ilike '%project_structure_report_responsibilities%'
          or p.prosrc ilike '%project_members%');
  if v_helpers is not null then
    raise exception '2C.3D post-check failed: authorization helper(s) read structure responsibilities or membership: %', v_helpers;
  end if;
  select string_agg(schemaname || '.' || tablename || ':' || policyname, ', ') into v_policies
    from pg_catalog.pg_policies
   where tablename not in ('project_structure_unit_members', 'project_structure_report_responsibilities')
     and (coalesce(qual, '') ilike '%project_structure_unit_members%'
          or coalesce(qual, '') ilike '%project_structure_report_responsibilities%'
          or coalesce(with_check, '') ilike '%project_structure_unit_members%'
          or coalesce(with_check, '') ilike '%project_structure_report_responsibilities%');
  if v_policies is not null then
    raise exception '2C.3D post-check failed: policies read structure responsibilities: %', v_policies;
  end if;
end;
$post$;
