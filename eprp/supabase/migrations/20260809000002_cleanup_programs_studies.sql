-- EPRP — approved Systems / Programs & Studies cleanup.
--
-- Owner-approved actions A, B, D, E, F. Actions C (keep "Asset Integrity
-- Study" and "Inspection") and the LOPA remap are deliberately NOT performed.
--
-- SAFETY
--   * No cascade deletion anywhere.
--   * The only master record deleted is the approved "SIL study" duplicate,
--     and only after every reference has been repointed and the count is zero.
--   * IDs preserved throughout; renames and remaps are UPDATEs, never
--     delete-and-recreate.
--   * Every step is guarded and idempotent.
--   * Before/after counts are raised as notices.
--   * Contacts, Job Titles, Weekly, Monthly and Executive data untouched.

do $$
declare
  ps_dept      uuid;   -- Department "Process Safety"
  ps_studies   uuid;   -- System     "Process Safety Studies"
  sil_keep     uuid;   -- canonical  "SIL"
  sil_dupe     uuid;   -- duplicate  "SIL study"
  n            integer;
  before_links integer;
  after_links  integer;
  refs         integer;
begin
  select count(*) into before_links from public.project_disciplines;
  raise notice 'BEFORE: project_disciplines = %', before_links;

  select id into ps_dept   from public.departments
   where lower(btrim(name)) = 'process safety' and active limit 1;
  select id into ps_studies from public.systems
   where lower(btrim(name)) = 'process safety studies' limit 1;

  if ps_dept is null or ps_studies is null then
    raise exception 'Aborting: could not resolve Process Safety department (%) or Process Safety Studies system (%).', ps_dept, ps_studies;
  end if;

  /* ---- B: remap HAZOP and Bow-Tie onto the correct hierarchy ---- */
  -- Department must be set first: the system/department agreement trigger
  -- validates the pair on every write.
  update public.disciplines
     set department_id = ps_dept, system_id = ps_studies
   where lower(btrim(name)) in ('hazop', 'bow-tie');
  get diagnostics n = row_count;
  raise notice 'B: remapped % Programs & Studies (HAZOP, Bow-Tie) to Process Safety / Process Safety Studies', n;

  /* ---- E: fix the spelling, preserving id, code and every reference ---- */
  update public.disciplines
     set name = 'Non-Operating Procedure'
   where lower(btrim(name)) = 'non-operating proceure';
  get diagnostics n = row_count;
  raise notice 'E: renamed % record to "Non-Operating Procedure"', n;

  /* ---- D: merge "SIL study" into canonical "SIL" ---- */
  select id into sil_keep from public.disciplines
   where lower(btrim(name)) = 'sil' limit 1;
  select id into sil_dupe from public.disciplines
   where lower(btrim(name)) = 'sil study' limit 1;

  if sil_keep is not null and sil_dupe is not null then
    -- Canonical hierarchy for the surviving record.
    update public.disciplines
       set department_id = ps_dept, system_id = ps_studies
     where id = sil_keep;

    -- Repoint links, skipping any that would collide with an existing link
    -- for the same project (the duplicate is removed instead of merged).
    delete from public.project_disciplines dup
     where dup.discipline_id = sil_dupe
       and exists (
         select 1 from public.project_disciplines keep
          where keep.discipline_id = sil_keep
            and keep.project_id    = dup.project_id
       );
    get diagnostics n = row_count;
    raise notice 'D: dropped % colliding SIL-study link(s)', n;

    update public.project_disciplines set discipline_id = sil_keep where discipline_id = sil_dupe;
    get diagnostics n = row_count;
    raise notice 'D: repointed % project link(s) to canonical SIL', n;

    update public.project_contacts    set discipline_id = sil_keep where discipline_id = sil_dupe;
    update public.weekly_submissions  set discipline_id = sil_keep where discipline_id = sil_dupe;
    update public.weekly_activities   set discipline_id = sil_keep where discipline_id = sil_dupe;
    update public.organization_positions set discipline_id = sil_keep where discipline_id = sil_dupe;

    select
      (select count(*) from public.project_disciplines    where discipline_id = sil_dupe) +
      (select count(*) from public.project_contacts       where discipline_id = sil_dupe) +
      (select count(*) from public.weekly_submissions     where discipline_id = sil_dupe) +
      (select count(*) from public.weekly_activities      where discipline_id = sil_dupe) +
      (select count(*) from public.organization_positions where discipline_id = sil_dupe)
    into refs;

    if refs = 0 then
      delete from public.disciplines where id = sil_dupe;
      raise notice 'D: deleted duplicate "SIL study" — reference count reached 0';
    else
      raise notice 'D: KEPT "SIL study" — % reference(s) remain; nothing deleted', refs;
    end if;
  else
    raise notice 'D: SIL merge skipped (keep=%, dupe=%) — already done or not found', sil_keep, sil_dupe;
  end if;

  /* ---- A: drop obsolete unmapped links that have a mapped twin ---- */
  delete from public.project_disciplines legacy
   where legacy.system_id is null
     and exists (
       select 1 from public.project_disciplines mapped
        where mapped.project_id    = legacy.project_id
          and mapped.discipline_id = legacy.discipline_id
          and mapped.system_id is not null
     );
  get diagnostics n = row_count;
  raise notice 'A: deleted % obsolete unmapped project link(s)', n;

  select count(*) into after_links from public.project_disciplines;
  raise notice 'AFTER: project_disciplines = % (was %)', after_links, before_links;
end;
$$;

/* ---- F: uniqueness guard — one master Program & Study per project ---- */

-- Scoped to (project_id, discipline_id) only: a program may appear once per
-- project, and the same program may still appear in any number of DIFFERENT
-- projects. Created after the cleanup above so it cannot fail on the rows it
-- was designed to prevent.
create unique index if not exists project_disciplines_project_program_unique
  on public.project_disciplines (project_id, discipline_id);

comment on index public.project_disciplines_project_program_unique is
  'One master Program & Study may be linked to a project only once. The System is canonical on the master record, so a per-system duplicate is not a valid distinction. Does not constrain the same program across different projects.';

/* ---- Post-run verification ---- */

do $$
declare r record; n integer;
begin
  select count(*) into n from (
    select project_id, discipline_id from public.project_disciplines
     group by 1,2 having count(*) > 1) x;
  raise notice 'VERIFY duplicate project links remaining: %', n;

  select count(*) into n from public.project_disciplines pd
   where not exists (select 1 from public.disciplines d where d.id = pd.discipline_id);
  raise notice 'VERIFY orphan project_disciplines rows: %', n;

  select count(*) into n from public.disciplines where lower(btrim(name)) like 'sil%';
  raise notice 'VERIFY records matching SIL*: %', n;

  for r in
    select d.name, coalesce(dep.name,'-') dept, coalesce(s.name,'(NO SYSTEM)') sys
      from public.disciplines d
      left join public.departments dep on dep.id = d.department_id
      left join public.systems s on s.id = d.system_id
     where lower(btrim(d.name)) in ('hazop','bow-tie','sil','lopa','non-operating procedure')
     order by d.name
  loop
    raise notice 'VERIFY %  ->  % / %', r.name, r.dept, r.sys;
  end loop;
end;
$$;
