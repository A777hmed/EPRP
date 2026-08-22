-- EPRP — Weekly Report signatory SNAPSHOT.
--
-- WHY A NEW COLUMN IS REQUIRED
--   `weekly_reports` already carries three sign-off columns:
--
--     prepared_by_contact_id  uuid references public.contacts(id)
--     reviewed_by_contact_id  uuid references public.contacts(id)
--     approved_by_contact_id  uuid references public.contacts(id)
--
--   Those satisfy "pick a Contact for each role" and nothing more. Three
--   requirements cannot be met by a foreign key to `contacts`:
--
--     * a signatory who is NOT in Contacts — a client representative or a
--       visiting authority signing one week's report. A uuid FK has nowhere to
--       put a free-typed name and job title.
--     * more than one person in a role, where the business genuinely has two
--       preparers. One column is one slot.
--     * a name and job title that DO NOT CHANGE when the Contact record is
--       later edited. Ids re-resolve on every read, so correcting somebody's
--       job title in Contacts today silently rewrites the signature block of a
--       Weekly report that was approved months ago. A signed document must say
--       what it said when it was signed.
--
--   This is the same problem `executive_reports.signatories` solved in
--   20260812000005, and this column is deliberately the SAME shape so both
--   report tiers share one model, one parser and one editor rather than two.
--
-- SHAPE
--   {
--     "prepared": [{ "id": "...", "name": "...", "title": "...",
--                    "contactId": "..." }],
--     "reviewed": [...],
--     "approved": [...]
--   }
--
--   `contactId` is provenance only — a note of where the name was picked from.
--   It is NOT a foreign key and is never re-resolved on read, so a Contact may
--   be renamed, archived or deleted without altering an issued Weekly report.
--
-- ADDITIVE ONLY
--   Nothing is dropped, rewritten or backfilled. The three existing columns
--   stay in place and are still honoured for reports saved before this column
--   existed, so applying this migration changes no existing Weekly report and
--   no existing query. Weekly lifecycle, RLS and submission logic are untouched.

alter table public.weekly_reports
  add column if not exists signatories jsonb not null default '{}'::jsonb;

comment on column public.weekly_reports.signatories is
  'Report-level SNAPSHOT of Prepared/Reviewed/Approved signatories: name and job title copied at save time. Holds no foreign key and is never re-resolved from Contacts, so editing or deleting a Contact cannot alter an issued Weekly report. The prepared_by/reviewed_by/approved_by contact columns remain for records saved before this column existed.';

/* --------------------------- Shape is enforced ----------------------------- */

/**
 * Reject anything that is not the documented object-of-arrays shape.
 *
 * The column is written from the browser through PostgREST, so the check lives
 * in the database rather than only in TypeScript: a malformed write would
 * otherwise surface much later as a broken signature block on a printed report.
 */
create or replace function public.weekly_signatories_valid(value jsonb)
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

alter table public.weekly_reports
  drop constraint if exists weekly_reports_signatories_shape;

alter table public.weekly_reports
  add constraint weekly_reports_signatories_shape
  check (public.weekly_signatories_valid(signatories));

/* -------------------------- Post-condition check --------------------------- */

do $$
declare
  col_count integer;
  legacy_count integer;
begin
  -- The new column exists.
  select count(*) into col_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'weekly_reports'
     and column_name = 'signatories';

  if col_count <> 1 then
    raise exception 'Post-check failed: weekly_reports.signatories was not created.';
  end if;

  -- The three original sign-off columns must SURVIVE. This migration is
  -- additive; if any of them disappeared, reports saved before today would
  -- lose their preparer.
  select count(*) into legacy_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'weekly_reports'
     and column_name in (
       'prepared_by_contact_id', 'reviewed_by_contact_id', 'approved_by_contact_id'
     );

  if legacy_count <> 3 then
    raise exception
      'Post-check failed: expected the 3 original sign-off columns to remain, found %.',
      legacy_count;
  end if;

  raise notice 'weekly_reports.signatories added; 3 legacy sign-off columns intact.';
end;
$$;
