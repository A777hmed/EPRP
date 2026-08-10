-- EPRP — carry project_contacts scope through a Program/Study move.
--
-- WHY
--   `project_contacts` rows with role 'team_member' store the scope the member
--   was assigned under: department_id + system_id + discipline_id, written
--   together by the Project Setup Contacts step. (Responsibility-role rows —
--   project manager and friends — carry all three as NULL and are untouched
--   by anything here.) When the master Program/Study moved to another System,
--   those rows kept the old System: the same staleness already fixed for
--   project_disciplines, one table over.
--
-- AUDIT AT TIME OF WRITING
--   6 project_contacts rows; 1 references a Program/Study
--   (PSM-00-1 / Ahmed Morsy Moustafa / Non-Operating Procedure) and its
--   system_id is NULL. Zero conflicting rows, zero rows holding a System
--   without a Program/Study. Nothing needed repair — this prevents the
--   inconsistency rather than cleaning one up.
--
-- RULES (unchanged from the previous version except where contacts appear)
--   * system_id = the System being moved away from  -> follows the move
--   * system_id = the target System already          -> left alone
--   * system_id IS NULL                              -> preserved as NULL;
--     the column is nullable and an unscoped assignment is legitimate
--   * system_id = some THIRD System                  -> never guessed at.
--     The whole move is blocked and every offending row is named.
--
-- Affected projects are now the UNION of those reached through
-- project_disciplines and those reached only through project_contacts, so a
-- contact assignment cannot be moved into a System its project never took on.
--
-- Still one transaction: master + project_disciplines + project_contacts all
-- commit together or not at all. No deletes, no cascades, every id preserved.

create or replace function public.move_discipline_system(
  p_discipline_id uuid,
  p_department_id uuid,
  p_system_id     uuid,
  p_fields        jsonb default '{}'::jsonb
)
returns public.disciplines
language plpgsql
as $$
declare
  rec        public.disciplines;
  sys        public.systems;
  dept_name  text;
  sys_name   text;
  old_sys    uuid;
  old_dept   uuid;
  old_sysnm  text;
  moving     boolean;
  conflicts  text[] := '{}';
  fields     jsonb  := coalesce(p_fields, '{}'::jsonb);
  new_name   text;
  new_code   text;
  r          record;
  n          integer;
begin
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

  old_dept := rec.department_id;
  old_sys  := rec.system_id;
  moving   := old_dept is distinct from p_department_id
              or old_sys is distinct from p_system_id;

  /* ---------- Scalar half of the payload --------------------------------- */

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

  if exists (select 1 from public.disciplines d
              where d.id <> p_discipline_id
                and lower(btrim(d.name)) = lower(new_name)) then
    raise exception 'This name already exists' using errcode = 'unique_violation';
  end if;

  if exists (select 1 from public.disciplines d
              where d.id <> p_discipline_id
                and d.code is not null
                and lower(btrim(d.code)) = lower(new_code)) then
    raise exception 'This code already exists' using errcode = 'unique_violation';
  end if;

  /* ---------- Hierarchy half --------------------------------------------- */

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
  select name into old_sysnm from public.systems where id = old_sys;

  if sys.department_id is distinct from p_department_id then
    raise exception
      'System "%" does not belong to Department "%". Choose a System owned by that Department, or move the System first.',
      sys_name, dept_name
      using errcode = 'check_violation';
  end if;

  if moving then
    /* -- Contacts holding a THIRD System: never guessed at, always blocked - */
    for r in
      select coalesce(p.code, left(pc.project_id::text, 8)) as project_code,
             coalesce(p.short_name, p.name, '(unnamed project)') as project_name,
             coalesce(c.name, '(unknown contact)') as contact_name,
             coalesce(s.name, '(unknown System)') as held_system
        from public.project_contacts pc
        left join public.projects p on p.id = pc.project_id
        left join public.contacts c on c.id = pc.contact_id
        left join public.systems  s on s.id = pc.system_id
       where pc.discipline_id = p_discipline_id
         and pc.system_id is not null
         and pc.system_id is distinct from p_system_id
         and pc.system_id is distinct from old_sys
       order by 1, 3
    loop
      conflicts := conflicts || format(
        '%s (%s): contact "%s" is scoped to System "%s", which is neither the current System "%s" nor the target "%s" — reassign that contact in Project Setup first',
        r.project_code, r.project_name, r.contact_name, r.held_system,
        coalesce(old_sysnm, '(none)'), sys_name);
    end loop;

    /* -- Every affected project must accept the target ---------------------- */
    -- Union: a contact assignment can exist on a project that has no scope
    -- link, and it must not be moved into a System that project never took on.
    for r in
      select affected.project_id,
             coalesce(p.code, left(affected.project_id::text, 8)) as project_code,
             coalesce(p.short_name, p.name, '(unnamed project)') as project_name
        from (
          select project_id from public.project_disciplines
           where discipline_id = p_discipline_id
          union
          select project_id from public.project_contacts
           where discipline_id = p_discipline_id
             and system_id is not null
             and system_id is not distinct from old_sys
        ) affected
        left join public.projects p on p.id = affected.project_id
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
      raise exception 'Cannot move to System "%": % problem(s) block it. %  Nothing was changed. Resolve these in Project Setup, then move again.',
        sys_name,
        array_length(conflicts, 1),
        array_to_string(conflicts, ' | ')
        using errcode = 'check_violation';
    end if;
  end if;

  /* ---------- Validated: write the whole edit at once -------------------- */

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

  -- Only rows that were scoped to the System being left. A NULL scope stays
  -- NULL, and a row already on the target is not rewritten.
  update public.project_contacts
     set department_id = p_department_id,
         system_id     = p_system_id
   where discipline_id = p_discipline_id
     and system_id is not null
     and system_id is not distinct from old_sys;

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

  -- Every contact row for this record must now be either unscoped or on the
  -- target System. Anything else means a stale scope survived.
  select count(*) into n
    from public.project_contacts
   where discipline_id = p_discipline_id
     and system_id is not null
     and system_id is distinct from p_system_id;
  if n > 0 then
    raise exception 'Post-move check failed: % contact assignment(s) still hold a different System.', n;
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

  return rec;
end;
$$;

comment on function public.move_discipline_system(uuid, uuid, uuid, jsonb) is
  'Applies a complete Program & Study / Discipline edit — name, code, description, Department, System — and synchronizes every project_disciplines link AND every project_contacts assignment scoped to the System being left, in ONE transaction. Contact rows already on the target are untouched, NULL scopes are preserved, and a row holding a third System blocks the whole move with the project and contact named. Never deletes or cascades; all ids, roles and contact/weekly history are preserved.';
