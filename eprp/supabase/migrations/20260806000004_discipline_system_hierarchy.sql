-- EPRP — canonical Programs & Studies hierarchy.
--
--   Project → Department → System → Program & Study
--
-- The master table (legacy name: disciplines) carried department_id but no
-- system_id, so a Program & Study had no canonical System. Project-level rows
-- in project_disciplines already carry system_id, so the master record was the
-- only gap.
--
-- Legacy table/column names are retained deliberately: renaming them is
-- migration risk with no user-visible benefit. The UI says "Programs &
-- Studies".
--
-- BACKFILL POLICY — deterministic only.
--   A master record is backfilled ONLY when every project_disciplines row for
--   it points at exactly ONE system, and that system belongs to the same
--   department. Anything ambiguous (0 or 2+ distinct systems, or a system in a
--   different department) is LEFT NULL and reported for manual mapping.
--   Nothing is guessed.
--
-- system_id stays nullable: existing records must keep working, and general
-- engineering projects may not use the System level at all. The Department ↔
-- System agreement is enforced by CHECK-equivalent trigger below plus the
-- application layer.

alter table public.disciplines
  add column if not exists system_id uuid
    references public.systems(id) on delete set null;

create index if not exists idx_disciplines_system_id
  on public.disciplines(system_id);

comment on column public.disciplines.system_id is
  'Canonical System this Program & Study belongs to. Must belong to the same department as the record. Nullable: not every project type uses the System level.';

/* ------------------------------ Backfill ---------------------------------- */

do $$
declare
  filled    integer := 0;
  ambiguous integer := 0;
  r         record;
begin
  for r in
    select d.id,
           d.name,
           d.department_id,
           (select count(distinct pd.system_id)
              from public.project_disciplines pd
             where pd.discipline_id = d.id
               and pd.system_id is not null)            as system_count,
           -- No min()/max() aggregate exists for uuid; take the single row.
           (select pd.system_id
              from public.project_disciplines pd
             where pd.discipline_id = d.id
               and pd.system_id is not null
             limit 1)                                   as only_system
      from public.disciplines d
     where d.system_id is null
  loop
    if r.system_count = 1
       and exists (
         select 1 from public.systems s
          where s.id = r.only_system
            and s.department_id is not distinct from r.department_id
       )
    then
      update public.disciplines set system_id = r.only_system where id = r.id;
      filled := filled + 1;
    elsif r.system_count > 1 then
      ambiguous := ambiguous + 1;
      raise notice 'MANUAL MAPPING — "%" maps to % different systems.', r.name, r.system_count;
    elsif r.system_count = 1 then
      ambiguous := ambiguous + 1;
      raise notice 'MANUAL MAPPING — "%" maps to a system in a different department.', r.name;
    else
      ambiguous := ambiguous + 1;
      raise notice 'MANUAL MAPPING — "%" has no project-level system to infer from.', r.name;
    end if;
  end loop;

  raise notice 'Programs & Studies backfilled deterministically: %. Needing manual mapping: %.', filled, ambiguous;
end;
$$;

/* --------------------- Department / System agreement ---------------------- */

-- A CHECK constraint cannot reach another table, so the invariant is enforced
-- by trigger. NULL system_id is always allowed.
create or replace function public.disciplines_system_matches_department()
returns trigger
language plpgsql
as $$
declare
  system_department uuid;
begin
  if new.system_id is null then
    return new;
  end if;

  select s.department_id into system_department
    from public.systems s where s.id = new.system_id;

  if system_department is distinct from new.department_id then
    raise exception
      'System does not belong to this department: a Program & Study must sit under a System of its own Department.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_disciplines_system_department on public.disciplines;
create trigger trg_disciplines_system_department
  before insert or update of system_id, department_id on public.disciplines
  for each row execute function public.disciplines_system_matches_department();

comment on function public.disciplines_system_matches_department() is
  'Rejects a Program & Study whose System belongs to a different Department. Enforced in the database so no client can bypass it.';
