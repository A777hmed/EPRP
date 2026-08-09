-- EPRP — correct master-data misclassification and remove confirmed junk.
--
-- PART A — hierarchy contamination
--   "Asset Integrity System" and "Process Safety Studies" are Systems, not
--   Departments. Both already exist correctly in public.systems, so no data
--   needs creating — only the incorrect DEPARTMENT rows are retired.
--
--   Target structure:
--     Department "Asset Integrity"  → systems: Asset Integrity Management
--                                     System, Asset Integrity Studies
--     Department "Process Safety"   → systems: Process Safety System,
--                                     Process Safety Studies
--
-- PART B — confirmed junk records, named explicitly by the owner:
--   contacts    fghfgdh, chbm
--   departments dsfds
--   disciplines sfgh
--
-- SAFETY
--   * Nothing is deleted while referenced. Each removal counts every
--     referencing column first and SKIPS (with a notice) rather than
--     cascading, so a live relationship can never be destroyed.
--   * Records are matched by exact trimmed, case-insensitive name — never by
--     "unusual spelling".
--   * Idempotent: re-running is a no-op.
--   * Legitimate departments, systems and project links are untouched.

/* ============================ PART A ================================== */

do $$
declare
  misclassified text[] := array['asset integrity system', 'process safety studies'];
  target        record;
  refs          integer;
begin
  for target in
    select id, name from public.departments
    where lower(btrim(name)) = any (misclassified)
  loop
    -- A department-lead pointer is presentation, not a business relationship:
    -- clearing it is safe and is required before the row can be retired.
    update public.departments set lead_contact_id = null where id = target.id;

    select
      (select count(*) from public.systems               where department_id = target.id) +
      (select count(*) from public.disciplines           where department_id = target.id) +
      (select count(*) from public.contacts              where department_id = target.id) +
      (select count(*) from public.project_departments   where department_id = target.id) +
      (select count(*) from public.project_disciplines   where department_id = target.id) +
      (select count(*) from public.project_contacts      where department_id = target.id) +
      (select count(*) from public.weekly_submissions    where department_id = target.id) +
      (select count(*) from public.project_delegations   where department_id = target.id) +
      (select count(*) from public.organization_positions where department_id = target.id)
    into refs;

    if refs > 0 then
      raise notice 'KEPT department "%" — % live reference(s). Repoint them to the correct department, then re-run.', target.name, refs;
    else
      delete from public.departments where id = target.id;
      raise notice 'Removed misclassified department "%" (it exists correctly as a System).', target.name;
    end if;
  end loop;
end;
$$;

/* ============================ PART B ================================== */

do $$
declare
  junk_contacts    text[] := array['fghfgdh', 'chbm'];
  junk_departments text[] := array['dsfds'];
  junk_disciplines text[] := array['sfgh'];
  target           record;
  refs             integer;
begin
  /* -- contacts -- */
  for target in
    select id, name from public.contacts where lower(btrim(name)) = any (junk_contacts)
  loop
    select
      (select count(*) from public.project_contacts where contact_id = target.id) +
      (select count(*) from public.project_contacts where reports_to_contact_id = target.id) +
      (select count(*) from public.departments      where lead_contact_id = target.id) +
      (select count(*) from public.projects where project_manager_id = target.id
             or project_control_manager_id = target.id or client_representative_id = target.id
             or reporting_coordinator_id = target.id or project_sponsor_id = target.id) +
      (select count(*) from public.weekly_reports where prepared_by_contact_id = target.id
             or reviewed_by_contact_id = target.id or approved_by_contact_id = target.id) +
      (select count(*) from public.weekly_submissions     where submitted_by_contact_id = target.id) +
      (select count(*) from public.weekly_activities      where owner_contact_id = target.id) +
      (select count(*) from public.organization_positions where contact_id = target.id) +
      (select count(*) from public.project_delegations    where delegate_contact_id = target.id) +
      (select count(*) from public.position_assignment_history where contact_id = target.id
             or previous_contact_id = target.id)
    into refs;

    if refs > 0 then
      raise notice 'KEPT contact "%" — % reference(s) found.', target.name, refs;
    else
      delete from public.contacts where id = target.id;
      raise notice 'Removed junk contact "%".', target.name;
    end if;
  end loop;

  /* -- departments -- */
  for target in
    select id, name from public.departments where lower(btrim(name)) = any (junk_departments)
  loop
    select
      (select count(*) from public.systems             where department_id = target.id) +
      (select count(*) from public.disciplines         where department_id = target.id) +
      (select count(*) from public.contacts            where department_id = target.id) +
      (select count(*) from public.project_departments where department_id = target.id) +
      (select count(*) from public.project_disciplines where department_id = target.id) +
      (select count(*) from public.project_contacts    where department_id = target.id) +
      (select count(*) from public.weekly_submissions  where department_id = target.id) +
      (select count(*) from public.project_delegations where department_id = target.id) +
      (select count(*) from public.organization_positions where department_id = target.id)
    into refs;

    if refs > 0 then
      raise notice 'KEPT department "%" — % reference(s) found.', target.name, refs;
    else
      delete from public.departments where id = target.id;
      raise notice 'Removed junk department "%".', target.name;
    end if;
  end loop;

  /* -- disciplines (Programs & Studies) -- */
  for target in
    select id, name from public.disciplines where lower(btrim(name)) = any (junk_disciplines)
  loop
    select
      (select count(*) from public.project_disciplines where discipline_id = target.id) +
      (select count(*) from public.project_contacts    where discipline_id = target.id) +
      (select count(*) from public.weekly_submissions  where discipline_id = target.id) +
      (select count(*) from public.weekly_activities   where discipline_id = target.id) +
      (select count(*) from public.organization_positions where discipline_id = target.id)
    into refs;

    if refs > 0 then
      raise notice 'KEPT discipline "%" — % reference(s) found.', target.name, refs;
    else
      delete from public.disciplines where id = target.id;
      raise notice 'Removed junk discipline "%".', target.name;
    end if;
  end loop;
end;
$$;
