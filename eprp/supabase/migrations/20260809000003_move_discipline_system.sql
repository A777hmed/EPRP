-- EPRP — atomic "move a Program/Study to another System".
--
-- PROBLEM THIS FIXES
--   `project_disciplines` carries its own `department_id` and `system_id`
--   alongside `discipline_id`. Changing the System on the MASTER record wrote
--   one row in `disciplines` and left every project link pointing at the old
--   System. The master moved, the project links did not, and the hierarchy
--   silently disagreed with itself.
--
--   The client cannot fix this by issuing two PostgREST updates: they are two
--   separate statements over HTTP, so a failure between them leaves exactly
--   the half-applied state the move is supposed to prevent. The write has to
--   happen inside one database transaction, which is what this function is.
--
-- GUARANTEES
--   * Atomic. A function body is a single transaction: the validation raises
--     before any write, and any later failure rolls the whole call back.
--     There is no partial master/link state.
--   * Validating, not destructive. Nothing is deleted, nothing is cascaded,
--     no link is dropped to make the move fit. A move that cannot be applied
--     cleanly is refused.
--   * Every conflict is reported, not just the first, so the admin sees the
--     full picture in one attempt instead of fixing projects one at a time.
--   * Ids are preserved throughout — this is an UPDATE, never a
--     delete-and-recreate. Project assignments, contacts, weekly history and
--     organization positions reference `discipline_id`, which never changes.
--   * Idempotent: re-running with the same target is a no-op.
--
-- No business names, placements or mappings are encoded here. The function
-- moves whatever record the admin selected to whatever System they chose; it
-- only enforces that the resulting hierarchy is internally consistent.

create or replace function public.move_discipline_system(
  p_discipline_id uuid,
  p_department_id uuid,
  p_system_id     uuid
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
  r          record;
  n          integer;
begin
  -- Lock the master row for the duration of the transaction so a concurrent
  -- move cannot interleave between validation and write.
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

  -- Already where it is being sent: nothing to do, and nothing to validate.
  if rec.department_id is not distinct from p_department_id
     and rec.system_id is not distinct from p_system_id then
    return rec;
  end if;

  /* ---------- 2a. The target System must belong to the target Department --- */

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

  /* ---------- 2b/2c. Every affected project must accept the target --------- */

  for r in
    select distinct pd.project_id,
           coalesce(p.code, left(pd.project_id::text, 8)) as project_code,
           coalesce(p.short_name, p.name, '(unnamed project)') as project_name
      from public.project_disciplines pd
      left join public.projects p on p.id = pd.project_id
     where pd.discipline_id = p_discipline_id
     order by 2
  loop
    -- The target Department must be in the project's scope. Writing a link
    -- for a department the project never selected would invent scope.
    if not exists (
      select 1 from public.project_departments
       where project_id = r.project_id and department_id = p_department_id
    ) then
      conflicts := conflicts || format(
        '%s (%s): Department "%s" is not part of this project''s scope',
        r.project_code, r.project_name, dept_name);
      continue;
    end if;

    -- The target System must be one the project assigned to that Department.
    -- Per-project System scope is the `systems` jsonb on project_departments.
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

    -- The move must not collide with another link for the same project.
    -- One link per (project, program) is already enforced by index, so this
    -- can only fire if that index is ever removed — it is kept as a backstop
    -- because the alternative failure mode is silent data duplication.
    select count(*) into n
      from public.project_disciplines
     where project_id     = r.project_id
       and discipline_id  = p_discipline_id;
    if n > 1 then
      conflicts := conflicts || format(
        '%s (%s): the project already has %s links to this record; the move would merge them into a duplicate',
        r.project_code, r.project_name, n);
    end if;
  end loop;

  /* ---------- 3. Refuse as a whole, or apply as a whole ------------------- */

  if array_length(conflicts, 1) > 0 then
    raise exception 'Cannot move to System "%": % project(s) cannot accept it. %  Nothing was changed. Resolve these in Project Setup, then move again.',
      sys_name,
      array_length(conflicts, 1),
      array_to_string(conflicts, ' | ')
      using errcode = 'check_violation';
  end if;

  -- Master first: trg_disciplines_system_department re-validates the pair, so
  -- an inconsistent move fails here even if the checks above were bypassed.
  update public.disciplines
     set department_id = p_department_id,
         system_id     = p_system_id
   where id = p_discipline_id
   returning * into rec;

  -- Then every project link for the same master record. discipline_id is
  -- untouched, so nothing that references it is affected.
  update public.project_disciplines
     set department_id = p_department_id,
         system_id     = p_system_id
   where discipline_id = p_discipline_id
     and (department_id is distinct from p_department_id
          or system_id is distinct from p_system_id);

  /* ---------- 7. Verify before committing --------------------------------- */

  if rec.system_id is distinct from p_system_id
     or rec.department_id is distinct from p_department_id then
    raise exception 'Post-move check failed: the master record did not take the target hierarchy.';
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

comment on function public.move_discipline_system(uuid, uuid, uuid) is
  'Atomically moves a Program & Study / Discipline to another Department + System and synchronizes every project_disciplines link. Validates the System belongs to the Department and that every affected project has both in scope; refuses the whole move and reports each conflicting project if not. Never deletes or cascades. Ids are preserved, so project assignments, contacts and weekly history are unaffected.';

grant execute on function public.move_discipline_system(uuid, uuid, uuid) to authenticated;
