-- EPRP Weekly Sprint 1B (final) — identity linkage, admin limits, and
-- project-scoped consolidation roles.
--
-- 1. Links the existing system_admin account to its existing Contact. This is
--    an EXPLICIT, owner-authorised link, not an inferred one: the audit found
--    no email match (personal login address vs corporate contact address) and
--    auto-linking by name similarity is forbidden. The owner identified the
--    person, so the link is recorded here rather than guessed at.
--
--    Login email and Contact email stay separate concepts and neither is
--    modified. `profiles.email` is the credential; `contacts.email` is
--    business directory data.
--
-- 2. Caps active System Administrators at two, in the database, so the limit
--    holds for any client — and refuses to remove the last one.
--
-- 3. Teaches the Weekly predicates that Project Control and Reporting
--    Coordinator are PROJECT-SCOPED and MANY-TO-MANY: several people may hold
--    them on one project, and one person may hold them on several. They are
--    already storable as `project_contacts` rows with those role names, so no
--    new table is introduced — the predicates simply stop reading only the two
--    singular columns on `projects`.
--
-- 4. Documents the NULL scope-item semantic on weekly_submissions.
--
-- No table is created, no column added, no Weekly policy replaced.

/* ------------------- 1. Explicit identity linkage ------------------------- */

do $$
declare
  target_contact uuid;
  admin_profile  uuid;
  matches        integer;
begin
  -- Counted and fetched separately: uuid has no min() aggregate, and the
  -- count is what proves the name is unambiguous before anything is read.
  select count(*) into matches
    from public.contacts
   where lower(btrim(name)) = lower(btrim('Ahmed Morsy Moustafa'));

  select id into target_contact
    from public.contacts
   where lower(btrim(name)) = lower(btrim('Ahmed Morsy Moustafa'))
   limit 1;

  /*
   * P1.0 — replay safety.
   *
   * This step is a ONE-TIME identity linkage for a specific production account.
   * On a fresh environment neither the named Contact nor any profile exists, so
   * there is nothing to link and nothing to get wrong. Skipping is correct
   * there; refusing would only stop the schema from being rebuilt.
   *
   * The ambiguity guard below is NOT relaxed: where the contact does exist, a
   * duplicate name still aborts rather than guessing.
   */
  if matches = 0 and not exists (select 1 from public.profiles) then
    raise notice 'Fresh environment: neither the named Contact nor any profile exists; identity linkage skipped.';
    return;
  end if;

  if matches = 0 then
    raise exception 'Aborting: the named Contact does not exist. No Contact will be created.';
  end if;
  if matches > 1 then
    raise exception 'Aborting: % Contacts share that name — the link would be a guess.', matches;
  end if;

  select id into admin_profile
    from public.profiles
   where role = 'system_admin' and active
   order by created_at
   limit 1;

  if admin_profile is null then
    raise exception 'Aborting: no active system_admin profile to link.';
  end if;

  update public.profiles
     set contact_id = target_contact
   where id = admin_profile
     and contact_id is distinct from target_contact;

  raise notice 'Linked system_admin profile % to contact % (login and contact emails both unchanged).',
    admin_profile, target_contact;
end;
$$;

/* --------------- 2. At most two active System Administrators -------------- */

create or replace function public.profiles_guard_system_admins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  others integer;
  was_admin boolean;
  still_admin boolean;
begin
  if tg_op = 'DELETE' then
    if old.role = 'system_admin' and old.active then
      select count(*) into others
        from public.profiles
       where role = 'system_admin' and active and id <> old.id;
      if others = 0 then
        raise exception
          'Refusing to delete the last active System Administrator. Promote another account first.'
          using errcode = 'check_violation';
      end if;
    end if;
    return old;
  end if;

  still_admin := new.role = 'system_admin' and new.active;

  -- Ceiling: two active administrators platform-wide. No person or address is
  -- privileged here — the rule counts rows, it does not know who they are.
  if still_admin then
    select count(*) into others
      from public.profiles
     where role = 'system_admin' and active and id <> new.id;
    if others >= 2 then
      raise exception
        'A maximum of two active System Administrators is allowed; % already exist. Deactivate or demote one first.',
        others
        using errcode = 'check_violation';
    end if;
  end if;

  -- Floor: never let the last administrator be demoted or deactivated, which
  -- would leave the platform with no recoverable administrative access.
  if tg_op = 'UPDATE' then
    was_admin := old.role = 'system_admin' and old.active;
    if was_admin and not still_admin then
      select count(*) into others
        from public.profiles
       where role = 'system_admin' and active and id <> new.id;
      if others = 0 then
        raise exception
          'Refusing to remove the last active System Administrator. Promote another account first.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.profiles_guard_system_admins() is
  'Keeps active System Administrators between one and two. Enforced on the table so the limit holds for every client, not just the UI. Linking a profile to a contact never affects the role, so it cannot reduce administrative access.';

drop trigger if exists trg_profiles_guard_system_admins on public.profiles;
create trigger trg_profiles_guard_system_admins
  before insert or update or delete on public.profiles
  for each row execute function public.profiles_guard_system_admins();

do $$
declare admins integer;
begin
  select count(*) into admins from public.profiles where role='system_admin' and active;
  if admins > 2 then
    raise exception 'Existing data already has % active System Administrators; resolve before enforcing the cap.', admins;
  end if;
  raise notice 'Admin cap active. Current active System Administrators: %.', admins;
end;
$$;

/* ------- 3. Project Control / Reporting Coordinator are many-to-many ------ */

-- Both are already storable as project_contacts rows carrying those role
-- names — the same rows the Project Setup responsibility step writes. Reading
-- them here means one person can hold the role on several projects and
-- several people can hold it on one, with no new table and no duplicated
-- responsibility logic. The two singular columns on `projects` remain
-- authoritative for the primary holder and are still honoured.

create or replace function public.is_project_consolidator(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_contact_id() is not null
    and (
      exists (
        select 1 from public.projects pr
         where pr.id = p_project
           and (pr.project_control_manager_id = public.current_contact_id()
             or pr.reporting_coordinator_id  = public.current_contact_id())
      )
      or exists (
        select 1 from public.project_contacts pc
         where pc.project_id = p_project
           and pc.contact_id = public.current_contact_id()
           and pc.role in ('project_control_manager', 'reporting_coordinator')
      )
    );
$$;

comment on function public.is_project_consolidator(uuid) is
  'Whether the caller holds Project Control or Reporting Coordinator on THIS project. Project-scoped and many-to-many: several holders per project, several projects per holder. Grants nothing on projects they are not assigned to.';

create or replace function public.weekly_can_access_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_system_admin()
    or public.is_project_consolidator(p_project)
    or (
      public.current_contact_id() is not null
      and exists (
        select 1 from public.project_contacts pc
         where pc.project_id = p_project
           and pc.contact_id = public.current_contact_id()
      )
    );
$$;

create or replace function public.weekly_can_access_scope(
  p_project    uuid,
  p_department uuid,
  p_discipline uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_system_admin()
    or public.is_project_consolidator(p_project)
    or (
      public.current_contact_id() is not null
      and p_department is not null
      -- Business rule 1: the department must belong to the project.
      and exists (
        select 1 from public.project_departments pd
         where pd.project_id = p_project
           and pd.department_id = p_department
      )
      and (
        -- Department Manager: the whole department, whatever the scope item,
        -- and however few items they personally hold.
        exists (
          select 1 from public.project_contacts pc
           where pc.project_id      = p_project
             and pc.contact_id      = public.current_contact_id()
             and pc.department_id   = p_department
             and pc.assignment_role = 'department_manager'
        )
        -- Scoped member: their own items. A NULL scope item is the
        -- department's general input, reachable by anyone assigned there.
        or exists (
          select 1 from public.project_contacts pc
           where pc.project_id    = p_project
             and pc.contact_id    = public.current_contact_id()
             and pc.department_id = p_department
             and (p_discipline is null or pc.discipline_id = p_discipline)
        )
      )
    );
$$;

/* ----------------- 4. The NULL scope-item semantic, recorded -------------- */

comment on column public.weekly_submissions.discipline_id is
  'NULL means a general DEPARTMENT-LEVEL Weekly input: the department''s shared entry for the week, legitimate and reachable by anyone assigned to that department. NOT NULL scopes the submission to one item below the System — a Program & Study on PSM/PSAIM projects, a Discipline on every other project type. The two are different grains, never interchangeable.';

comment on column public.weekly_reports.discipline_ids is
  'The Weekly report''s DECLARED scope for the period, chosen on the report header. Distinct from weekly_submissions.discipline_id, which records the actual per-item input. Kept deliberately: the header form reads and writes it. Do not conflate the two.';

comment on column public.profiles.email is
  'Login credential address. Any valid provider is acceptable — Gmail, Outlook, corporate or otherwise. Authorization derives from profile -> contact -> project assignments and NEVER from the email domain. Deliberately independent of contacts.email, which is business directory data.';
