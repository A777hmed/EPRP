-- EPRP — remove accidental duplicate contact records.
--
-- Two people were each created twice by a double-submit. The Mohamed Aziz
-- pair was created 2.2 seconds apart; the Mohamed Shehata pair is an exact
-- duplicate of the same name in the same department. Neither duplicate has a
-- single reference anywhere in the schema, so no merge of references is
-- required — only the later row is removed.
--
-- Canonical record = the EARLIEST created row of each pair. The later row is
-- deleted.
--
--   Mohamed Aziz     keep f1da7db4… (06:35:48)  delete d41047ac… (06:35:50)
--   Mohamed Shehata  keep b10b59fb… (15:16:54)  delete 807ac907… (15:21:17)
--
-- Safety:
--   * Every delete is guarded by NOT EXISTS across every table that can
--     reference a contact. If any reference has appeared since this migration
--     was written, that row is left untouched rather than cascading.
--   * Idempotent — re-running deletes nothing once the rows are gone.
--   * No other contact, project, department or assignment is touched.

do $$
declare
  duplicate_ids uuid[] := array[
    'd41047ac-31b4-4c7f-89c1-963de0e18a56',  -- Mohamed Aziz (later)
    '807ac907-3e0e-4edc-bc01-c3e65444afe8'   -- Mohamed Shehata (later)
  ];
  target uuid;
  removed integer := 0;
begin
  foreach target in array duplicate_ids loop
    delete from public.contacts c
    where c.id = target
      and not exists (select 1 from public.project_contacts       t where t.contact_id = target)
      and not exists (select 1 from public.project_contacts       t where t.reports_to_contact_id = target)
      and not exists (select 1 from public.departments            t where t.lead_contact_id = target)
      and not exists (select 1 from public.projects               t where t.project_manager_id = target)
      and not exists (select 1 from public.projects               t where t.project_control_manager_id = target)
      and not exists (select 1 from public.projects               t where t.client_representative_id = target)
      and not exists (select 1 from public.projects               t where t.reporting_coordinator_id = target)
      and not exists (select 1 from public.projects               t where t.project_sponsor_id = target)
      and not exists (select 1 from public.weekly_reports         t where t.prepared_by_contact_id = target)
      and not exists (select 1 from public.weekly_reports         t where t.reviewed_by_contact_id = target)
      and not exists (select 1 from public.weekly_reports         t where t.approved_by_contact_id = target)
      and not exists (select 1 from public.weekly_submissions     t where t.submitted_by_contact_id = target)
      and not exists (select 1 from public.weekly_activities      t where t.owner_contact_id = target)
      and not exists (select 1 from public.organization_positions t where t.contact_id = target)
      and not exists (select 1 from public.project_delegations    t where t.delegate_contact_id = target)
      and not exists (select 1 from public.position_assignment_history t where t.contact_id = target)
      and not exists (select 1 from public.position_assignment_history t where t.previous_contact_id = target);

    if found then
      removed := removed + 1;
    else
      raise notice 'Contact % not removed: already absent, or a reference exists.', target;
    end if;
  end loop;

  raise notice 'Duplicate contacts removed: %', removed;
end;
$$;

/* ------------------------- Prevent recurrence ----------------------------- */

-- Contacts had no uniqueness at all, so a double-submit inserted the same
-- person twice. Name alone is not identity — two real people can share a name
-- — so uniqueness is scoped to the identifying attribute when present, and to
-- name within a department otherwise.
--
-- Partial index so rows without a department are unconstrained.

create unique index if not exists contacts_name_department_unique
  on public.contacts (lower(btrim(name)), department_id)
  where department_id is not null;

comment on index public.contacts_name_department_unique is
  'Stops the same name being created twice in one department by a double-submit. Two genuinely different people with the same name must differ by department or carry an email.';

-- DEFERRED — unique index on email.
--
-- A unique index on lower(btrim(email)) is the strongest identity guard and
-- was attempted here, but it cannot be created yet: two rows share
-- mikhatab@eprom.com.eg —
--
--   7a6acedf…  "Mohamed Khattab"  lead of department "Asset Integrity"
--   fcccb56f…  "Mohamed Khatab"   lead of department "Asset Integrity System"
--
-- The shared email proves these are one person, but each is the lead of a
-- DIFFERENT department, so merging them decides which department keeps a lead
-- — and "Asset Integrity System" is itself a misclassified record that should
-- be a System, not a Department. That is a business decision, not a
-- deterministic cleanup, so it is left for manual review rather than resolved
-- by silently deleting a real person.
--
-- Once that pair is resolved, add:
--   create unique index contacts_email_unique
--     on public.contacts (lower(btrim(email)))
--     where email is not null and btrim(email) <> '';
