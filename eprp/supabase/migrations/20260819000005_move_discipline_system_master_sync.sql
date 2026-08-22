-- EPRP Phase 13.3 — M5: teach move_discipline_system about the master registers.
--
-- THE DEFECT THIS CLOSES
--   move_discipline_system() synchronises every project_disciplines link when a
--   Program & Study moves to a new Department/System, so no project is left
--   pointing at scope it does not hold. master_milestones (13.2) and
--   master_deliverables (13.3) carry the same three scope columns and the
--   function has never heard of them. A perfectly legal move therefore left
--   every milestone and deliverable on that Discipline holding a department_id
--   and system_id that no longer match it — silently, with nothing to detect it.
--
--   This is a live defect introduced by 13.2, not a new feature. It is fixed
--   here because 13.3 is where the second affected table lands, and fixing one
--   without the other would leave the same hole open.
--
-- WHY IN THE SAME TRANSACTION
--   Synchronising afterwards from the client would reopen exactly the partial-
--   save problem migration 20260809000004 exists to close: the move could
--   commit and the sync could then fail, leaving the registers stale with no
--   way to tell. One transaction, or nothing.
--
-- WHAT IS NOT CHANGED
--   Every existing validation, conflict message, post-move check and the
--   signature are preserved verbatim. The only additions are two UPDATE
--   statements and their post-move verification, all inside the existing
--   "hierarchy actually changed" path. A pure rename still writes nothing to
--   the registers, because a rename cannot invalidate scope.
--
--   The rows themselves are never moved between projects, archived, or
--   deleted; only the two denormalized scope columns are re-pointed. Ids,
--   codes, baselines, owners and every update stream are untouched.

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
  moved      boolean;
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

  -- Recorded before the write, because the UPDATE below changes the values the
  -- test reads. Every register sync is gated on this: a pure rename cannot
  -- invalidate scope and must not touch the registers.
  moved := rec.department_id is distinct from p_department_id
        or rec.system_id     is distinct from p_system_id;

  -- Only when the hierarchy is actually changing do the affected projects
  -- need to be re-validated; a pure rename cannot invalidate their scope.
  if moved then

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

  /*
   * M5 — the master registers follow the same move, in this transaction.
   *
   * Both tables denormalize department_id and system_id alongside
   * discipline_id, so a Discipline that moves leaves them stale. They are
   * re-pointed here rather than by a caller, for the same reason the project
   * links are: a second statement could fail after this one commits.
   *
   * Rows already holding the target scope are excluded, so a re-run writes
   * nothing and updated_at is not churned. Archived rows are included
   * deliberately — history must stay consistent with the hierarchy it is read
   * against, and an archived record can be restored.
   */
  if moved then
    update public.master_milestones
       set department_id = p_department_id,
           system_id     = p_system_id
     where discipline_id = p_discipline_id
       and (department_id is distinct from p_department_id
            or system_id is distinct from p_system_id);

    update public.master_deliverables
       set department_id = p_department_id,
           system_id     = p_system_id
     where discipline_id = p_discipline_id
       and (department_id is distinct from p_department_id
            or system_id is distinct from p_system_id);
  end if;

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

  -- M5: the registers are verified on the same terms as the project links. A
  -- stale row here is the defect this migration exists to close, so it must
  -- roll the whole move back rather than be discovered later.
  select count(*) into n
    from public.master_milestones
   where discipline_id = p_discipline_id
     and (department_id is distinct from p_department_id
          or system_id is distinct from p_system_id);
  if n > 0 then
    raise exception 'Post-move check failed: % milestone(s) still hold the old scope.', n;
  end if;

  select count(*) into n
    from public.master_deliverables
   where discipline_id = p_discipline_id
     and (department_id is distinct from p_department_id
          or system_id is distinct from p_system_id);
  if n > 0 then
    raise exception 'Post-move check failed: % deliverable(s) still hold the old scope.', n;
  end if;

  return rec;
end;
$$;

comment on function public.move_discipline_system(uuid, uuid, uuid, jsonb) is
  'Applies a complete Program & Study / Discipline edit — name, code, description, Department and System — plus the synchronization of every project_disciplines link AND of master_milestones / master_deliverables scope, in ONE transaction. Validates uniqueness, that the System belongs to the Department, and that every affected project has both in scope; refuses the whole Save and names each conflicting project if not. Nothing is written until every check passes, so a refusal leaves the record exactly as it was. Never deletes or cascades; ids are preserved, so project assignments, contacts, weekly history and every master update stream are unaffected.';

grant execute on function public.move_discipline_system(uuid, uuid, uuid, jsonb) to authenticated;
