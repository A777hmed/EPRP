-- EPRP — make the whole Program/Study edit atomic, not just the hierarchy move.
--
-- WHAT WAS STILL WRONG
--   The first version of move_discipline_system() moved the hierarchy
--   atomically, but the client wrote name / code / description as a separate
--   PostgREST statement *before* calling it. A Save that renamed the record
--   AND moved it was therefore two transactions: the rename could commit and
--   the move could then be refused, leaving the record renamed but not moved.
--   That is a partial save, and the admin has no way to tell which half
--   landed.
--
-- THE FIX
--   The function now takes the complete edit payload. Scalar fields and the
--   hierarchy are written in the same transaction as the project-link
--   synchronization, after validation. Either the entire Save lands or none
--   of it does.
--
--   Scalars arrive as jsonb rather than as separate parameters so that
--   "field absent" and "field set to null" stay distinguishable — the same
--   key-presence rule the services use. Only known columns are read from it;
--   anything else in the object is ignored, so the payload cannot be used to
--   write a column the form does not own.
--
-- Ordering inside the transaction matters: nothing is written until every
-- validation has passed, so a refusal cannot leave a half-applied row.

drop function if exists public.move_discipline_system(uuid, uuid, uuid);

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

  /* ---------- Validate the scalar half of the payload -------------------- */

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

  -- Case-insensitive, matching the service-layer check, so the same rename is
  -- refused the same way whichever path reaches the database.
  if exists (
    select 1 from public.disciplines d
     where d.id <> p_discipline_id
       and lower(btrim(d.name)) = lower(new_name)
  ) then
    raise exception 'This name already exists' using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from public.disciplines d
     where d.id <> p_discipline_id
       and d.code is not null
       and lower(btrim(d.code)) = lower(new_code)
  ) then
    raise exception 'This code already exists' using errcode = 'unique_violation';
  end if;

  /* ---------- Validate the hierarchy half -------------------------------- */

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

  if sys.department_id is distinct from p_department_id then
    raise exception
      'System "%" does not belong to Department "%". Choose a System owned by that Department, or move the System first.',
      sys_name, dept_name
      using errcode = 'check_violation';
  end if;

  -- Only when the hierarchy is actually changing do the affected projects
  -- need to be re-validated; a pure rename cannot invalidate their scope.
  if rec.department_id is distinct from p_department_id
     or rec.system_id is distinct from p_system_id then

    for r in
      select distinct pd.project_id,
             coalesce(p.code, left(pd.project_id::text, 8)) as project_code,
             coalesce(p.short_name, p.name, '(unnamed project)') as project_name
        from public.project_disciplines pd
        left join public.projects p on p.id = pd.project_id
       where pd.discipline_id = p_discipline_id
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
      raise exception 'Cannot move to System "%": % project(s) cannot accept it. %  Nothing was changed. Resolve these in Project Setup, then move again.',
        sys_name,
        array_length(conflicts, 1),
        array_to_string(conflicts, ' | ')
        using errcode = 'check_violation';
    end if;
  end if;

  /* ---------- Everything validated: write the whole edit at once --------- */

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
  'Applies a complete Program & Study / Discipline edit — name, code, description, Department and System — plus the synchronization of every project_disciplines link, in ONE transaction. Validates uniqueness, that the System belongs to the Department, and that every affected project has both in scope; refuses the whole Save and names each conflicting project if not. Nothing is written until every check passes, so a refusal leaves the record exactly as it was. Never deletes or cascades; ids are preserved, so project assignments, contacts and weekly history are unaffected.';

grant execute on function public.move_discipline_system(uuid, uuid, uuid, jsonb) to authenticated;
