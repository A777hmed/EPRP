-- Phase 2C.3D Wave 2: PSM linkage to canonical project membership.
--
-- Additive. Two new guard triggers; no table, column, policy, authority
-- predicate or existing function is changed, and no row is written.
--
--   1. guard_psm_assignment_membership() on public.project_contacts.
--      A NEW or EDITED scoped PSM / legacy assignment (a department-team row:
--      role = team_member, or any department / system / Program & Study scope
--      or assignment_role) must name a person with an ACTIVE membership of
--      the SAME project (public.project_members) whose person record is
--      active. Applies to every write path: the Contacts step's
--      save_project_setup_relation('team'), Replace Person's department
--      branch (the replacement), and any direct write. An UPDATE that changes
--      none of the assignment's fields (the setup save rewrites title and
--      Reports To for every kept row) is not an edit and is not checked, so
--      existing legacy rows stay readable and savable as they are.
--
--   2. guard_project_member_psm_responsibilities() on public.project_members.
--      A membership cannot END while the person still holds a fixed project
--      responsibility (Project Manager, Project Control Manager, Reporting
--      Coordinator, Client Representative, Project Sponsor) or a project
--      position, or any department-team assignment (Department Manager, Team
--      Member Lead, Team Member). Nothing is removed or reassigned for them.
--
-- UNCHANGED, by design: project_contacts stays the authority-bearing PSM
-- model (Department Manager approve / return, department users, Project
-- Control / Planning and Reporting Coordinator), the PSM hierarchy, the
-- setup-write authority, replace_project_responsibility(), and the six
-- malformed legacy rows (role = project_manager carrying a department and
-- assignment_role = department_manager): never normalized, never treated as
-- Department Manager authority (every predicate still requires
-- role = team_member). project_members stays AUTHORITY-FREE: these triggers
-- only refuse writes; no authorization helper or policy reads membership,
-- which the post-check below re-proves. No backfill: the read-only preflight
-- found every scoped assignment's person already an active member.

/* ------------------- 1. Scoped PSM assignments need a member -------------- */

create function public.guard_psm_assignment_membership() returns trigger
language plpgsql security definer set search_path = '' as $guard$
declare
  v_member_found boolean;
  v_person_active boolean;
begin
  -- Only department-team assignments; fixed-responsibility mirror rows carry
  -- no scope and keep their own rules.
  if not (new.role = 'team_member' or new.department_id is not null or new.system_id is not null
          or new.discipline_id is not null or new.assignment_role is not null) then
    return new;
  end if;
  -- An UPDATE that changes nothing about the assignment is not an edit.
  if tg_op = 'UPDATE'
     and new.project_id is not distinct from old.project_id
     and new.contact_id is not distinct from old.contact_id
     and new.role is not distinct from old.role
     and new.department_id is not distinct from old.department_id
     and new.system_id is not distinct from old.system_id
     and new.discipline_id is not distinct from old.discipline_id
     and new.assignment_role is not distinct from old.assignment_role
     and new.reports_to_contact_id is not distinct from old.reports_to_contact_id
     and new.functional_title is not distinct from old.functional_title then
    return new;
  end if;

  select true into v_member_found
    from public.project_members m
   where m.project_id = new.project_id and m.contact_id = new.contact_id and m.ended_at is null
   limit 1;
  if v_member_found is distinct from true then
    raise exception '[PSM_MEMBER_REQUIRED] Only an active member of this project''s team can hold a department assignment. Add the person to the Project Team first.'
      using errcode = '23514';
  end if;
  select c.active and c.archived_at is null into v_person_active
    from public.contacts c where c.id = new.contact_id;
  if v_person_active is distinct from true then
    raise exception '[PSM_PERSON_INACTIVE] This person is inactive and cannot take a new or changed department assignment.'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_psm_assignment_membership() from public, anon, authenticated, service_role;

-- BEFORE row triggers fire alphabetically: this guard refuses before the
-- shared setup-version trigger advances the project. The existing removal
-- guard (trg_project_contact_membership_removal) is unchanged.
create trigger guard_psm_assignment_membership
  before insert or update on public.project_contacts
  for each row execute function public.guard_psm_assignment_membership();

/* --------------- 2. Membership cannot end over PSM responsibility ---------- */

create function public.guard_project_member_psm_responsibilities() returns trigger
language plpgsql security definer set search_path = '' as $guard$
begin
  -- An archived project's team is read-only: guard_project_member_write gives
  -- that refusal, so it is not pre-empted with a responsibility message here.
  if public.project_is_archived(old.project_id) then
    return new;
  end if;
  if old.ended_at is null and new.ended_at is not null then
    if exists (select 1 from public.projects p
                where p.id = old.project_id
                  and old.contact_id = any (array[p.project_manager_id, p.project_control_manager_id,
                                                  p.reporting_coordinator_id, p.client_representative_id,
                                                  p.project_sponsor_id]))
       or exists (select 1 from public.project_positions pp
                   where pp.project_id = old.project_id and pp.contact_id = old.contact_id) then
      raise exception '[MEMBER_HAS_PROJECT_RESPONSIBILITY] This person holds a project responsibility or position on this project. Reassign it before ending their membership.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.project_contacts pc
                where pc.project_id = old.project_id and pc.contact_id = old.contact_id
                  and pc.role = 'team_member') then
      raise exception '[MEMBER_HAS_PSM_ASSIGNMENTS] This person still holds department assignments on this project. Remove or replace them on the Contacts step before ending their membership.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_project_member_psm_responsibilities() from public, anon, authenticated, service_role;

create trigger guard_project_member_psm_responsibilities
  before update on public.project_members
  for each row execute function public.guard_project_member_psm_responsibilities();

/* ------------------------------ 3. Post-checks ---------------------------- */

do $post$
declare
  v_helpers text;
  v_policies text;
begin
  if not exists (select 1 from pg_catalog.pg_trigger
                  where tgname = 'guard_psm_assignment_membership'
                    and tgrelid = 'public.project_contacts'::regclass) then
    raise exception '2C.3D Wave 2 post-check failed: the project_contacts membership guard is missing.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
                  where tgname = 'guard_project_member_psm_responsibilities'
                    and tgrelid = 'public.project_members'::regclass) then
    raise exception '2C.3D Wave 2 post-check failed: the membership-end guard is missing.';
  end if;
  -- Membership stays authority-free: no authorization helper or policy reads it.
  select string_agg(p.proname, ', ' order by p.proname) into v_helpers
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
          or p.proname ~ '_accepts_department_input$')
     and p.prosrc ilike '%project_members%';
  if v_helpers is not null then
    raise exception '2C.3D Wave 2 post-check failed: authorization helper(s) read project_members: %', v_helpers;
  end if;
  select string_agg(schemaname || '.' || tablename || ':' || policyname, ', ') into v_policies
    from pg_catalog.pg_policies
   where tablename <> 'project_members'
     and (coalesce(qual, '') ilike '%project_members%' or coalesce(with_check, '') ilike '%project_members%');
  if v_policies is not null then
    raise exception '2C.3D Wave 2 post-check failed: policies read project_members: %', v_policies;
  end if;
  -- Department Manager authority still requires role = team_member, so the
  -- malformed legacy rows grant nothing (unchanged, re-proved here).
  if (select prosrc from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'is_weekly_department_manager') !~ 'pc\.role = ''team_member''' then
    raise exception '2C.3D Wave 2 post-check failed: Department Manager authority no longer requires role = team_member.';
  end if;
end;
$post$;
