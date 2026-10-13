-- Phase 2C.3E (follow-up): a held project-level responsibility can only be
-- REPLACED by an active member of the same project's team.
--
-- Additive. Two new guard triggers; no table, column, policy, authority
-- predicate or existing function is changed, and no row is written.
--
-- Replace Person's fixed-responsibility and project-position branches
-- (replace_project_responsibility()) only checked that the replacement had
-- SOME row on the project, and the setup patch and direct writes could move a
-- fixed holder to anyone (the patch adds the new holder's row itself). The
-- canonical rule since 2C.3D Wave 2 is the Project Team: a person joins the
-- team first.
--
--   1. guard_fixed_holder_replacement() — BEFORE UPDATE on public.projects.
--      When a fixed responsibility (Project Manager, Project Control Manager,
--      Reporting Coordinator, Client Representative, Project Sponsor) moves
--      from one person to ANOTHER, the new holder must have an ACTIVE
--      membership of this project.
--   2. guard_position_holder_replacement() — BEFORE UPDATE OF contact_id on
--      public.project_positions. The same rule when a project position moves
--      to another person.
--
-- Both refuse with [HOLDER_MEMBER_REQUIRED]. Applies to every write path:
-- Replace Person, the setup patch / relation saves and direct writes. NOT a
-- replacement, and therefore unchanged: a new project naming its first
-- holders, filling a vacant responsibility, clearing one, and a new position
-- row. The department-assignment branch keeps its own 2C.3D Wave 2 guard.
-- Replace Person's history, its other checks and its error tags are
-- unchanged; a refused replacement writes nothing. Archived projects are
-- refused earlier by block_archived_project_setup (2C.3E). Membership stays
-- authority-free: these guards only refuse writes.

/* ----------------------- 1. Fixed responsibility holders ------------------- */

create function public.guard_fixed_holder_replacement() returns trigger
language plpgsql security definer set search_path = '' as $guard$
begin
  if exists (
    select 1
      from (values (new.project_manager_id, old.project_manager_id),
                   (new.project_control_manager_id, old.project_control_manager_id),
                   (new.reporting_coordinator_id, old.reporting_coordinator_id),
                   (new.client_representative_id, old.client_representative_id),
                   (new.project_sponsor_id, old.project_sponsor_id)) h(next_holder, previous_holder)
     where h.previous_holder is not null
       and h.next_holder is not null
       and h.next_holder is distinct from h.previous_holder
       and not exists (select 1 from public.project_members m
                        where m.project_id = new.id and m.contact_id = h.next_holder and m.ended_at is null)
  ) then
    raise exception '[HOLDER_MEMBER_REQUIRED] Only an active member of this project''s team can take over this responsibility. Add the person to the Project Team first.'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_fixed_holder_replacement() from public, anon, authenticated, service_role;

-- BEFORE row triggers fire alphabetically: after block_archived_project_setup
-- and enforce_project_classification, before the version bump.
create trigger guard_fixed_holder_replacement
  before update of project_manager_id, project_control_manager_id, reporting_coordinator_id,
                   client_representative_id, project_sponsor_id
  on public.projects
  for each row execute function public.guard_fixed_holder_replacement();

/* --------------------------- 2. Project positions -------------------------- */

create function public.guard_position_holder_replacement() returns trigger
language plpgsql security definer set search_path = '' as $guard$
begin
  if old.contact_id is not null
     and new.contact_id is not null
     and new.contact_id is distinct from old.contact_id
     and not exists (select 1 from public.project_members m
                      where m.project_id = new.project_id and m.contact_id = new.contact_id and m.ended_at is null) then
    raise exception '[HOLDER_MEMBER_REQUIRED] Only an active member of this project''s team can take over this responsibility. Add the person to the Project Team first.'
      using errcode = '23514';
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_position_holder_replacement() from public, anon, authenticated, service_role;

-- After block_archived_project_setup; before the version bump and the
-- existing position membership guard.
create trigger guard_position_holder_replacement
  before update of contact_id on public.project_positions
  for each row execute function public.guard_position_holder_replacement();

/* ------------------------------ 3. Post-checks ---------------------------- */

do $post$
begin
  if not exists (select 1 from pg_catalog.pg_trigger
                  where tgname = 'guard_fixed_holder_replacement' and tgrelid = 'public.projects'::regclass)
     or not exists (select 1 from pg_catalog.pg_trigger
                     where tgname = 'guard_position_holder_replacement' and tgrelid = 'public.project_positions'::regclass) then
    raise exception '2C.3E holder post-check failed: a replacement guard is missing.';
  end if;
  -- Membership stays authority-free: still no authorization helper reads it.
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
                     or p.proname ~ '_accepts_department_input$')
                and p.prosrc ilike '%project_members%') then
    raise exception '2C.3E holder post-check failed: an authorization helper reads project_members.';
  end if;
end;
$post$;
