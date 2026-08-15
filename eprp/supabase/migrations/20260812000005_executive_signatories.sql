-- EPRP Phase 10 — Executive Report signatory SNAPSHOT.
--
-- WHY A NEW COLUMN IS UNAVOIDABLE
--   `executive_reports.prepared_by_contact_ids` stores ids only, and only for
--   one of the three roles. That cannot satisfy the closing requirement:
--
--     * three roles — Prepared By, Reviewed By, Approved By
--     * a signatory who is NOT in Contacts (free-typed name and job title)
--     * a name and job title that DO NOT CHANGE when the Contact record is
--       later edited or its position is corrected
--
--   The third point is the important one. Storing ids re-resolves the name on
--   every read, so correcting somebody's job title in Contacts would silently
--   rewrite the signature block of an Executive Report that was approved months
--   earlier. A signed document must say what it said when it was signed.
--
-- SHAPE
--   {
--     "prepared": [{ "id": "...", "name": "...", "title": "...",
--                    "contactId": "...", "projects": ["..."] }],
--     "reviewed": [...],
--     "approved": [...]
--   }
--
--   `contactId` is provenance only — a note of where the name was picked from.
--   It is NOT a foreign key and is never re-resolved on read, so a Contact may
--   be renamed, archived or deleted without touching an issued report.
--
-- ADDITIVE ONLY
--   Nothing is dropped or rewritten. `prepared_by_contact_ids` is left in place
--   and still honoured for records saved before this column existed, so no
--   existing Executive Report changes when this migration is applied.

alter table public.executive_reports
  add column if not exists signatories jsonb not null default '{}'::jsonb;

comment on column public.executive_reports.signatories is
  'Report-level SNAPSHOT of Prepared/Reviewed/Approved signatories: name and job title copied at save time. Holds no foreign key and is never re-resolved from Contacts, so editing or deleting a Contact cannot alter an issued report.';

/* --------------------------- Shape is enforced ----------------------------- */

/**
 * Reject anything that is not the documented object-of-arrays shape.
 *
 * The column is written from the browser through PostgREST, so the check lives
 * in the database rather than only in TypeScript: a malformed write would
 * otherwise surface much later as a broken signature block on a printed report.
 */
create or replace function public.executive_signatories_valid(value jsonb)
returns boolean language sql immutable as $$
  select
    jsonb_typeof(value) = 'object'
    and not exists (
      select 1
        from jsonb_each(value) as entry(key, val)
       where entry.key not in ('prepared', 'reviewed', 'approved')
          or jsonb_typeof(entry.val) <> 'array'
          or exists (
            select 1
              from jsonb_array_elements(entry.val) as person
             where jsonb_typeof(person) <> 'object'
                or coalesce(person->>'name', '') = ''
          )
    );
$$;

alter table public.executive_reports
  add constraint executive_reports_signatories_shape
  check (public.executive_signatories_valid(signatories));

/* -------------------------- Post-condition check --------------------------- */

do $$
declare fk_count integer;
begin
  -- The safety claim of the original table must still hold: no foreign key
  -- onto source data, so deleting an Executive Report still cannot reach a
  -- project, a Weekly row, a Monthly row or a contact.
  select count(*) into fk_count
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
   where tc.table_name = 'executive_reports'
     and tc.constraint_type = 'FOREIGN KEY'
     and ccu.table_name in (
       'projects', 'weekly_reports', 'weekly_submissions', 'weekly_entries',
       'monthly_reports', 'monthly_comments', 'monthly_plan_items', 'contacts'
     );

  if fk_count > 0 then
    raise exception
      'Post-check failed: executive_reports gained % foreign key(s) onto source data.',
      fk_count;
  end if;

  raise notice 'executive_reports.signatories added; snapshot holds no foreign keys.';
end;
$$;
