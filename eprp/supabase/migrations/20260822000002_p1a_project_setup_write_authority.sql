-- EPRP P1-A — close the remaining critical write-authority gaps on the
-- project-scoped setup tables.
--
-- SCOPE, DELIBERATELY NARROW
--   project_delegations · project_disciplines · weekly_lifecycle_corrections
--   plus the project_departments authority asymmetry (architecture 22 row 2d).
--
--   NOT touched: the eight master-data tables, the organization-chart tables,
--   Master Milestones, Master Deliverables, Weekly, Monthly, Executive, and
--   every SELECT policy in the schema. This wave is WRITE authority only.
--
-- WHY THESE THREE, AND WHY NOW
--
--   project_delegations — the one genuine escalation risk left. It grants no
--     authority today because no RLS predicate reads it, so a blanket write
--     policy is currently harmless. That changes the moment delegation
--     authority is implemented: an open table would let any authenticated
--     account insert itself as a delegate and acquire submit rights. Locking it
--     BEFORE that work removes the window entirely rather than racing it.
--
--   project_disciplines — project structure, and the odd one out. Its two
--     siblings, project_departments and project_contacts, were closed in P0;
--     this one was left blanket-writable, so any account could rewire any
--     project's scope links.
--
--   weekly_lifecycle_corrections — a one-time repair audit table from
--     20260806000005. NOTHING in the application reads or writes it. Its write
--     policy protects nothing and can only be misused.
--
-- THE ASYMMETRY THIS ALSO FIXES (architecture 22 row 2d)
--   can_manage_project_setup() admits the project_control_admin platform role,
--   which architecture 8.1 scopes to ALL projects. project_departments is gated
--   on the narrower weekly_can_manage_project(), so a Project Control Admin who
--   is not named on a project can write its record and its assignments but not
--   its department scope — a setup wizard that half-completes.
--
--   Aligning project_departments with the same predicate the other setup tables
--   now use is what makes Project Setup consistent. It is a WIDENING for that
--   one role on that one table, and the pre-check below names anyone affected.
--
-- ATOMICITY — the reason INSERT and DELETE must move together
--   replaceDisciplineLinks() and replaceDelegations() are delete-then-insert
--   within one save. A policy that admitted the DELETE but refused the INSERT
--   would destroy a project's scope links and leave them destroyed. Every
--   command on both tables therefore uses ONE predicate, granted together.
--
-- SELECT IS NOT TOUCHED
--   All three tables keep the read access they have today. Architecture 24.2
--   settled visibility; this migration must not move it.

/* --------------------------- Lockout pre-check ---------------------------- */

do $pre$
declare
  admins integer;
  widened integer;
  r record;
begin
  select count(*) into admins from public.profiles
   where role = 'system_admin' and active;

  if admins = 0 and exists (select 1 from public.profiles) then
    raise exception
      'Refusing to restrict project setup writes: no active system_admin profile exists.';
  end if;
  if not exists (select 1 from public.profiles) then
    raise notice 'Fresh environment: no profiles exist yet; lockout check not applicable.';
  end if;
  raise notice 'Lockout pre-check passed: % active system_admin profile(s).', admins;

  -- Who GAINS project_departments write from the asymmetry fix: accounts
  -- holding project_control_admin that are not consolidators on some project.
  select count(*) into widened
    from public.profiles
   where role = 'project_control_admin' and active;

  if widened = 0 then
    raise notice 'Asymmetry fix: 0 project_control_admin accounts exist, so this widens nothing today.';
  else
    raise notice 'Asymmetry fix: % project_control_admin account(s) gain project_departments write on projects they do not personally manage:', widened;
    for r in select full_name, email from public.profiles
              where role = 'project_control_admin' and active order by full_name
    loop
      raise notice '  GAINS: % (%)', r.full_name, r.email;
    end loop;
  end if;
end;
$pre$;

/* ---------------------------- project_delegations ------------------------- */

drop policy if exists project_delegations_authenticated_all on public.project_delegations;
drop policy if exists project_delegations_select on public.project_delegations;
drop policy if exists project_delegations_insert on public.project_delegations;
drop policy if exists project_delegations_update on public.project_delegations;
drop policy if exists project_delegations_delete on public.project_delegations;

-- Read unchanged: a delegation is project structure, Tier A per 24.2.1.
create policy project_delegations_select on public.project_delegations
  for select to authenticated
  using (true);

create policy project_delegations_insert on public.project_delegations
  for insert to authenticated
  with check (public.can_manage_project_setup(project_id));

create policy project_delegations_update on public.project_delegations
  for update to authenticated
  using (public.can_manage_project_setup(project_id))
  with check (public.can_manage_project_setup(project_id));

-- DELETE is required: replaceDelegations() clears before inserting.
create policy project_delegations_delete on public.project_delegations
  for delete to authenticated
  using (public.can_manage_project_setup(project_id));

/* ---------------------------- project_disciplines ------------------------- */

drop policy if exists project_disciplines_authenticated_all on public.project_disciplines;
drop policy if exists project_disciplines_select on public.project_disciplines;
drop policy if exists project_disciplines_insert on public.project_disciplines;
drop policy if exists project_disciplines_update on public.project_disciplines;
drop policy if exists project_disciplines_delete on public.project_disciplines;

create policy project_disciplines_select on public.project_disciplines
  for select to authenticated
  using (true);

create policy project_disciplines_insert on public.project_disciplines
  for insert to authenticated
  with check (public.can_manage_project_setup(project_id));

create policy project_disciplines_update on public.project_disciplines
  for update to authenticated
  using (public.can_manage_project_setup(project_id))
  with check (public.can_manage_project_setup(project_id));

-- DELETE is required: replaceDisciplineLinks() clears before inserting.
create policy project_disciplines_delete on public.project_disciplines
  for delete to authenticated
  using (public.can_manage_project_setup(project_id));

/* ------------------- project_departments — asymmetry fix ------------------ */
-- SELECT is left exactly as P0.2 set it. Only the three write policies move
-- from weekly_can_manage_project() to can_manage_project_setup(), so all four
-- project setup tables now answer to one predicate.

drop policy if exists project_departments_insert on public.project_departments;
drop policy if exists project_departments_update on public.project_departments;
drop policy if exists project_departments_delete on public.project_departments;

create policy project_departments_insert on public.project_departments
  for insert to authenticated
  with check (public.can_manage_project_setup(project_id));

create policy project_departments_update on public.project_departments
  for update to authenticated
  using (public.can_manage_project_setup(project_id))
  with check (public.can_manage_project_setup(project_id));

create policy project_departments_delete on public.project_departments
  for delete to authenticated
  using (public.can_manage_project_setup(project_id));

/* --------------------- weekly_lifecycle_corrections ----------------------- */
-- A one-time repair audit record. Nothing in the application touches it, and a
-- correction that has been made is history: it should not be rewritable.
--
-- Read stays open so the record remains inspectable. NO write policy is
-- created, which under RLS means every INSERT, UPDATE and DELETE is refused for
-- every non-owner role. This matches the master_milestones / master_deliverables
-- precedent, where append-only history is enforced by the ABSENCE of a policy
-- rather than by a rule someone could later relax.

drop policy if exists weekly_lifecycle_corrections_authenticated_all
  on public.weekly_lifecycle_corrections;
drop policy if exists weekly_lifecycle_corrections_select
  on public.weekly_lifecycle_corrections;

create policy weekly_lifecycle_corrections_select
  on public.weekly_lifecycle_corrections
  for select to authenticated
  using (true);

/* ----------------------- Fresh-environment grants ------------------------- */
-- KNOWN_LIMITATIONS 3.10, scoped to THIS wave's tables only.
--
-- The migration set contains no GRANT statements; the hosted platform supplies
-- them, which is why production works and a database built from migrations
-- alone does not. Production pre-flight confirmed `authenticated` already holds
-- full DML here, so on the hosted project these statements are a NO-OP that
-- changes nothing.
--
-- They exist so a fresh environment reproduces the same grant shape. This does
-- NOT widen anything: RLS is the gate, and the policies above are what now
-- decides who may write. Granting the door does not unlock it.
--
-- The other tables named in 3.10 are deliberately left alone — this wave's
-- scope is these four.

grant select, insert, update, delete on public.project_delegations
  to anon, authenticated, service_role;
grant select, insert, update, delete on public.project_disciplines
  to anon, authenticated, service_role;
grant select, insert, update, delete on public.project_departments
  to anon, authenticated, service_role;
grant select, insert, update, delete on public.weekly_lifecycle_corrections
  to anon, authenticated, service_role;

/* -------------------------- Post-condition checks ------------------------- */

do $post$
declare
  blanket integer;
  wlc_writes integer;
  setup_pred integer;
  sel_open integer;
begin
  -- 1. No blanket write policy may survive on any of the four.
  select count(*) into blanket
    from pg_policies
   where schemaname = 'public'
     and tablename in ('project_delegations','project_disciplines',
                       'project_departments','weekly_lifecycle_corrections')
     and cmd <> 'SELECT'
     and (qual = 'true' or with_check = 'true');

  if blanket > 0 then
    raise exception 'Post-check failed: % blanket write policy/policies survive.', blanket;
  end if;

  -- 2. weekly_lifecycle_corrections must have NO write policy at all.
  select count(*) into wlc_writes
    from pg_policies
   where schemaname = 'public' and tablename = 'weekly_lifecycle_corrections'
     and cmd <> 'SELECT';

  if wlc_writes > 0 then
    raise exception 'Post-check failed: weekly_lifecycle_corrections has % write policy/policies; it must have none.', wlc_writes;
  end if;

  -- 3. All three setup tables answer to ONE predicate — the asymmetry is gone.
  select count(*) into setup_pred
    from pg_policies
   where schemaname = 'public'
     and tablename in ('project_delegations','project_disciplines','project_departments')
     and cmd <> 'SELECT'
     and coalesce(qual, with_check) like '%can_manage_project_setup%';

  if setup_pred <> 9 then
    raise exception 'Post-check failed: expected 9 setup write policies on can_manage_project_setup(), found %.', setup_pred;
  end if;

  -- 4. SELECT visibility preserved on all four.
  select count(*) into sel_open
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and qual = 'true'
     and tablename in ('project_delegations','project_disciplines',
                       'project_departments','weekly_lifecycle_corrections');

  if sel_open <> 4 then
    raise exception 'Post-check failed: expected 4 open SELECT policies, found %. Read visibility must not change.', sel_open;
  end if;

  -- 5. Both replace flows need INSERT and DELETE together, or a save destroys
  --    scope links and cannot restore them.
  if not exists (select 1 from pg_policies where schemaname='public'
                  and tablename='project_disciplines' and cmd='INSERT')
     or not exists (select 1 from pg_policies where schemaname='public'
                  and tablename='project_disciplines' and cmd='DELETE')
     or not exists (select 1 from pg_policies where schemaname='public'
                  and tablename='project_delegations' and cmd='INSERT')
     or not exists (select 1 from pg_policies where schemaname='public'
                  and tablename='project_delegations' and cmd='DELETE') then
    raise exception 'Post-check failed: a replace flow is missing INSERT or DELETE.';
  end if;

  raise notice 'P1-A applied: 3 tables locked to project setup authority, weekly_lifecycle_corrections is read-only, setup asymmetry resolved, SELECT unchanged.';
end;
$post$;
