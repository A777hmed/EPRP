-- EPRP — retire misclassified master data so it cannot appear in active
-- selectors.
--
-- ROOT CAUSE of the remaining contamination:
--   Migration 20260806000003 tried to DELETE the misclassified department rows
--   and, by design, SKIPPED any that still had references. "Process Safety
--   Studies" had references, so it survived — still `active = true` — and every
--   Department selector therefore kept offering it. The selectors were never
--   broken: they filter on `active`, and the row was genuinely active.
--
--   Deleting is the wrong instrument for a referenced record. Archiving is the
--   right one: the row keeps its references intact and history stays readable,
--   while `active = false` removes it from every active selector at once,
--   because they all read the same filtered source.
--
-- Scope, all by exact case-insensitive trimmed name:
--   departments  "Asset Integrity System", "Process Safety Studies"  → archive
--   job_titles   "Process Safety", "Asset Integrity"                 → a
--                Department name is not a job title; delete when unused,
--                archive when referenced.
--
-- Nothing is deleted while referenced. Nothing legitimate is touched:
-- "Asset Integrity" and "Process Safety" DEPARTMENTS are untouched, and the
-- Systems of the same names are untouched.

/* ------------- A. Archive misclassified DEPARTMENT records ---------------- */

do $$
declare
  misclassified text[] := array['asset integrity system', 'process safety studies'];
  r             record;
  n             integer := 0;
begin
  for r in
    select id, name, active from public.departments
     where lower(btrim(name)) = any (misclassified)
  loop
    if r.active then
      update public.departments
         set active      = false,
             archived_at = coalesce(archived_at, now()),
             -- A retired department must not keep presenting a lead.
             lead_contact_id = null
       where id = r.id;
      n := n + 1;
      raise notice 'Archived misclassified department "%" — it is a System, not a Department.', r.name;
    end if;
  end loop;
  raise notice 'Misclassified departments archived: %.', n;
end;
$$;

/* --------------- B. Remove Department names from Job Titles --------------- */

do $$
declare
  not_job_titles text[] := array['process safety', 'asset integrity'];
  r              record;
  refs           integer;
begin
  for r in
    select id, name, active from public.job_titles
     where lower(btrim(name)) = any (not_job_titles)
  loop
    select count(*) into refs
      from public.contacts c where c.job_title_id = r.id;

    if refs = 0 then
      delete from public.job_titles where id = r.id;
      raise notice 'Deleted job title "%" — a Department name, unused.', r.name;
    elsif r.active then
      update public.job_titles
         set active = false, archived_at = coalesce(archived_at, now())
       where id = r.id;
      raise notice 'Archived job title "%" — a Department name, but % contact(s) still reference it.', r.name, refs;
    end if;
  end loop;
end;
$$;

/* --------------------------- C. Contamination report ---------------------- */

do $$
declare
  r record;
begin
  raise notice '--- ACTIVE DEPARTMENTS AFTER CLEANUP ---';
  for r in select name from public.departments where active order by name loop
    raise notice '  %', r.name;
  end loop;

  raise notice '--- ACTIVE JOB TITLES AFTER CLEANUP ---';
  for r in select name from public.job_titles where active order by name loop
    raise notice '  %', r.name;
  end loop;
end;
$$;
