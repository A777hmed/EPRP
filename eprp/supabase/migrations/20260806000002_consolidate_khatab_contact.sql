-- EPRP — consolidate the duplicate "Mohamed Khatab" person record.
--
-- Two contact rows share mikhatab@eprom.com.eg and are therefore one person:
--
--   7a6acedf…  "Mohamed Khattab"  lead of department "Asset Integrity"
--   fcccb56f…  "Mohamed Khatab"   lead of department "Asset Integrity System"
--
-- Owner decision:
--   * "Mohamed Khatab" is the canonical spelling and the surviving person.
--   * The valid assignment is  Asset Integrity → Mohamed Khatab.
--   * "Asset Integrity System" is NOT a department — it is a System under
--     Asset Integrity — so the department-lead assignment created through that
--     misclassified record is not preserved.
--
-- Steps, in order:
--   1. Move the Asset Integrity department lead onto the surviving record.
--   2. Clear the lead on the misclassified "Asset Integrity System" record.
--   3. Repoint any other reference from the duplicate to the survivor.
--   4. Delete the duplicate once it is provably unreferenced.
--   5. Enforce email uniqueness, now that the collision is gone.
--
-- Idempotent and guarded: every step is a no-op if already applied, and the
-- delete refuses if any reference remains rather than cascading.
-- The "Asset Integrity System" record itself is NOT reclassified or deleted
-- here — that is separate hierarchy work and would risk valid data.

do $$
declare
  survivor  uuid := 'fcccb56f-644b-4e2d-9aaf-898709287492';  -- Mohamed Khatab
  duplicate uuid := '7a6acedf-061a-4e4a-8326-3b74a6cb6298';  -- Mohamed Khattab
  refs      integer;
begin
  -- Only proceed if both rows are still present.
  if not exists (select 1 from public.contacts where id = survivor) then
    raise notice 'Survivor % absent — nothing to consolidate.', survivor;
    return;
  end if;
  if not exists (select 1 from public.contacts where id = duplicate) then
    raise notice 'Duplicate % already removed.', duplicate;
    return;
  end if;

  /* 1. The valid assignment: Asset Integrity is led by the survivor. */
  update public.departments
     set lead_contact_id = survivor
   where lead_contact_id = duplicate;

  /* 2. Drop the lead created through the misclassified "Asset Integrity
        System" record. The department row itself is left untouched. */
  update public.departments
     set lead_contact_id = null
   where lower(btrim(name)) = 'asset integrity system'
     and lead_contact_id = survivor;

  /* 3. Repoint every other reference the duplicate could hold. */
  update public.project_contacts       set contact_id            = survivor where contact_id            = duplicate;
  update public.project_contacts       set reports_to_contact_id = survivor where reports_to_contact_id = duplicate;
  update public.projects               set project_manager_id         = survivor where project_manager_id         = duplicate;
  update public.projects               set project_control_manager_id = survivor where project_control_manager_id = duplicate;
  update public.projects               set client_representative_id   = survivor where client_representative_id   = duplicate;
  update public.projects               set reporting_coordinator_id   = survivor where reporting_coordinator_id   = duplicate;
  update public.projects               set project_sponsor_id         = survivor where project_sponsor_id         = duplicate;
  update public.weekly_reports         set prepared_by_contact_id = survivor where prepared_by_contact_id = duplicate;
  update public.weekly_reports         set reviewed_by_contact_id = survivor where reviewed_by_contact_id = duplicate;
  update public.weekly_reports         set approved_by_contact_id = survivor where approved_by_contact_id = duplicate;
  update public.weekly_submissions     set submitted_by_contact_id = survivor where submitted_by_contact_id = duplicate;
  update public.weekly_activities      set owner_contact_id  = survivor where owner_contact_id  = duplicate;
  update public.organization_positions set contact_id        = survivor where contact_id        = duplicate;
  update public.project_delegations    set delegate_contact_id = survivor where delegate_contact_id = duplicate;
  update public.position_assignment_history set contact_id          = survivor where contact_id          = duplicate;
  update public.position_assignment_history set previous_contact_id = survivor where previous_contact_id = duplicate;

  /* 4. Delete only once provably unreferenced. */
  select
    (select count(*) from public.project_contacts       where contact_id            = duplicate) +
    (select count(*) from public.project_contacts       where reports_to_contact_id = duplicate) +
    (select count(*) from public.departments            where lead_contact_id       = duplicate) +
    (select count(*) from public.projects               where project_manager_id = duplicate
                                                           or project_control_manager_id = duplicate
                                                           or client_representative_id  = duplicate
                                                           or reporting_coordinator_id  = duplicate
                                                           or project_sponsor_id        = duplicate) +
    (select count(*) from public.weekly_reports         where prepared_by_contact_id = duplicate
                                                           or reviewed_by_contact_id = duplicate
                                                           or approved_by_contact_id = duplicate) +
    (select count(*) from public.weekly_submissions     where submitted_by_contact_id = duplicate) +
    (select count(*) from public.weekly_activities      where owner_contact_id = duplicate) +
    (select count(*) from public.organization_positions where contact_id = duplicate) +
    (select count(*) from public.project_delegations    where delegate_contact_id = duplicate) +
    (select count(*) from public.position_assignment_history where contact_id = duplicate
                                                                or previous_contact_id = duplicate)
  into refs;

  if refs > 0 then
    raise exception 'Refusing to delete %: % reference(s) still point at it.', duplicate, refs;
  end if;

  delete from public.contacts where id = duplicate;
  raise notice 'Consolidated % into % (canonical: Mohamed Khatab).', duplicate, survivor;
end;
$$;

/* --------------------- Enforce email uniqueness --------------------------- */

-- Safe now that the only colliding pair has been consolidated. Email is the
-- strongest identity signal for a person; a partial index leaves rows without
-- an email unconstrained.
create unique index if not exists contacts_email_unique
  on public.contacts (lower(btrim(email)))
  where email is not null and btrim(email) <> '';

comment on index public.contacts_email_unique is
  'One person, one email. Case-insensitive and whitespace-trimmed; rows without an email are unconstrained.';
