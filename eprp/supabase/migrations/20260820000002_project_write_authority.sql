-- EPRP P0.1 — close the privilege-escalation path on projects / project_contacts.
--
-- THE DEFECT
--   Both tables still carried the Phase-3 bootstrap policy:
--     for all to authenticated using (true) with check (true)
--
--   That is not merely a missing restriction, it is a permission BYPASS, because
--   project_contacts is the table the entire scope model derives from:
--
--     1. Any authenticated account could
--          update public.projects set project_control_manager_id = <own contact>
--        and become a project consolidator -- gaining read AND manage on that
--        project through every predicate that trusts those columns.
--
--     2. Any authenticated account could
--          insert into public.project_contacts (project_id, contact_id,
--                                               department_id, assignment_role)
--          values (<any project>, <own contact>, <any dept>, 'department_manager')
--        and gain write access to that department's Weekly, which RLS would then
--        correctly honour -- because the assignment it reads had been forged.
--
--   Everything downstream was enforcing faithfully on top of a table anyone
--   could rewrite.
--
-- LOCKED DECISIONS APPLIED
--   docs/02_PLATFORM_ARCHITECTURE.md
--     24.2  read and write resolve through DIFFERENT gates. Both tables are
--           Tier A -- project structure, visible to every authenticated
--           account -- so SELECT becomes `true` here rather than staying
--           narrower than the platform rule.
--     24.2.2 widening read must never widen write. Read opens; write closes.
--     24.3   one canonical consolidator rule, and NO self-assignment: an
--            account may not grant itself or anyone else an assignment on a
--            project it does not already manage.
--     8.1    Project Control Admin is a platform role scoped to ALL projects.
--
-- SMALLEST CHANGE
--   Two helpers, eight policies, no table/column/trigger/row touched.
--
-- NO DELETE POLICY ON public.projects -- DELIBERATE
--   ProjectService exposes no delete: `archiveProject` sets status/active/
--   archived_at, and nothing anywhere issues a DELETE against projects. Omitting
--   the policy therefore removes a capability nothing uses, and matches 24.1
--   rule 5 and the master_milestones / master_deliverables precedent, where a
--   record with history is archived and never removed. project_contacts DOES
--   need DELETE: the setup wizard replaces assignments delete-then-insert.
--
-- KNOWN ASYMMETRY, RECORDED RATHER THAN SILENTLY INTRODUCED
--   can_manage_project_setup() admits the project_control_admin platform role
--   (24.3 / 8.1). The twelve tables gated on weekly_can_manage_project() -- and
--   project_departments in particular, which the setup wizard also writes -- do
--   NOT. A Project Control Admin who is not named on a project can therefore
--   edit its record and its assignments but not its department scope. That gap
--   PRE-DATES this migration, it fails CLOSED (it denies, it never escalates),
--   and widening those twelve tables belongs with the rest of the blanket-policy
--   work in P1 -- not to a migration whose job is to close an escalation.

/* --------------------------- Lockout pre-check ---------------------------- */

do $pre$
declare admins integer;
begin
  select count(*) into admins
    from public.profiles
   where role = 'system_admin' and active;

  -- P1.0: the lockout risk this guard exists for requires accounts to lock
  -- out. On an empty profiles table there are none, so the check is skipped
  -- rather than failing a fresh environment. Protection is unchanged whenever
  -- any profile exists.
  if admins = 0 and exists (select 1 from public.profiles) then
    raise exception
      'Refusing to restrict project write access: no active system_admin profile exists, so this would leave the platform unmanageable.';
  end if;
  if not exists (select 1 from public.profiles) then
    raise notice 'Fresh environment: no profiles exist yet, so no account can be locked out. Lockout check not applicable.';
  end if;

  raise notice 'Lockout pre-check passed: % active system_admin profile(s).', admins;
end;
$pre$;

/* --------------------------------- Helpers -------------------------------- */

create or replace function public.can_create_project()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  -- Creating a project is an administrative act, not a project-scoped one:
  -- there is no project to be assigned to yet. Matches the permissions matrix,
  -- where Create Project belongs to System Administrator and Project Control.
  select public.is_system_admin()
      or public.current_user_role() = 'project_control_admin';
$fn$;

comment on function public.can_create_project() is
  'Whether the caller may create a project. Administrative, not project-scoped - no project exists yet to be assigned to.';

create or replace function public.can_manage_project_setup(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  -- Delegates to the canonical manage rule (P0.6) rather than restating it,
  -- and adds the one role that architecture 8.1 scopes to ALL projects.
  --
  -- The role clause is also what prevents a bootstrap trap: createProject()
  -- inserts the project row and THEN writes its assignments, so without it a
  -- Project Control Admin who did not name themselves on the form would create
  -- a project it could not finish setting up.
  select public.weekly_can_manage_project(p_project)
      or public.current_user_role() = 'project_control_admin';
$fn$;

comment on function public.can_manage_project_setup(uuid) is
  'Whether the caller may write a project record and its assignments: the canonical consolidator rule per weekly_can_manage_project(), plus the project_control_admin platform role, which architecture 8.1 scopes to all projects.';

/* -------------------------------- projects -------------------------------- */

drop policy if exists projects_authenticated_all on public.projects;
drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;

-- 24.2 Tier A: a project record is visible to every authenticated account.
-- This does not widen anything today -- the blanket policy already allowed it --
-- it states the rule deliberately instead of leaving it as a bootstrap leftover.
create policy projects_select on public.projects
  for select to authenticated
  using (true);

create policy projects_insert on public.projects
  for insert to authenticated
  with check (public.can_create_project());

-- USING restricts WHICH rows may be updated, so a consolidator of project A
-- cannot reach project B. WITH CHECK repeats it so an update cannot move a row
-- out of the caller's own authority.
create policy projects_update on public.projects
  for update to authenticated
  using (public.can_manage_project_setup(id))
  with check (public.can_manage_project_setup(id));

-- No DELETE policy. See the header.

/* ---------------------------- project_contacts ---------------------------- */

drop policy if exists project_contacts_authenticated_all on public.project_contacts;
drop policy if exists project_contacts_select on public.project_contacts;
drop policy if exists project_contacts_insert on public.project_contacts;
drop policy if exists project_contacts_update on public.project_contacts;
drop policy if exists project_contacts_delete on public.project_contacts;

-- Tier A. Who is on a project is project structure, not departmental content.
create policy project_contacts_select on public.project_contacts
  for select to authenticated
  using (true);

-- THE escalation fix: an assignment may only be written by someone who already
-- manages the project. Self-assignment is impossible because the check reads the
-- project's existing authority, never the row being inserted.
create policy project_contacts_insert on public.project_contacts
  for insert to authenticated
  with check (public.can_manage_project_setup(project_id));

create policy project_contacts_update on public.project_contacts
  for update to authenticated
  using (public.can_manage_project_setup(project_id))
  with check (public.can_manage_project_setup(project_id));

-- Needed: replaceContacts() and replaceTeam() are delete-then-insert.
create policy project_contacts_delete on public.project_contacts
  for delete to authenticated
  using (public.can_manage_project_setup(project_id));

/* -------------------------- Post-condition checks ------------------------- */

do $post$
declare
  blanket   integer;
  del_count integer;
  sel_open  integer;
  total     integer;
begin
  -- 1. No blanket policy may survive on either table. A single `qual = true` on
  --    a write command would leave the escalation open.
  select count(*) into blanket
    from pg_policies
   where schemaname = 'public'
     and tablename in ('projects', 'project_contacts')
     and cmd <> 'SELECT'
     and (qual = 'true' or with_check = 'true');

  if blanket > 0 then
    raise exception 'Post-check failed: % blanket write policy/policies survive on projects/project_contacts.', blanket;
  end if;

  -- 2. projects must carry no DELETE policy at all.
  select count(*) into del_count
    from pg_policies
   where schemaname = 'public' and tablename = 'projects' and cmd = 'DELETE';

  if del_count > 0 then
    raise exception 'Post-check failed: projects has % DELETE policy/policies; it must have none.', del_count;
  end if;

  -- 3. Both SELECT policies must be open, or 24.2 Tier A is not satisfied.
  select count(*) into sel_open
    from pg_policies
   where schemaname = 'public'
     and tablename in ('projects', 'project_contacts')
     and cmd = 'SELECT'
     and qual = 'true';

  if sel_open <> 2 then
    raise exception 'Post-check failed: expected 2 open SELECT policies for Tier A visibility, found %.', sel_open;
  end if;

  -- 4. The helpers must exist and short-circuit on is_system_admin(), or an
  --    administrator whose profile is not linked to a contact loses access.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'can_manage_project_setup'
  ) then
    raise exception 'Post-check failed: can_manage_project_setup() is missing.';
  end if;

  select count(*) into total
    from pg_policies
   where schemaname = 'public' and tablename in ('projects', 'project_contacts');

  raise notice 'P0.1 applied: % policies across projects/project_contacts; 0 blanket writes; 0 project deletes; Tier A reads open.', total;
end;
$post$;
