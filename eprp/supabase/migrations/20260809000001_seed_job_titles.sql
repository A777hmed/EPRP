-- EPRP — seed the Managed Job Title master data.
--
-- ROOT CAUSE this addresses:
--   The Managed Job Title dropdown was never hardcoded. It reads
--   `job_titles` through the shared reference selector, filtered to active
--   records. The table had simply never been seeded — no migration inserted
--   a row, and the mock seed is an empty array — so it rendered the single
--   hand-created row and looked static.
--
-- SAFETY
--   * INSERT-only. No update, no delete, no schema change.
--   * Guarded: a title is inserted only when no row already matches on
--     lower(btrim(name)), so re-running adds nothing and an existing row —
--     including an ARCHIVED one — is never duplicated or resurrected.
--   * Existing contacts and their job_title_id references are untouched.
--   * Matching mirrors the `job_titles_name_unique` index exactly, so this
--     can never trip that constraint.
--
-- These eight are a starting set, not a fixed list: Administration →
-- Job Titles remains the source of truth and can add, edit, archive and
-- delete freely. Nothing in the UI hardcodes them.

do $$
declare
  seed_titles text[] := array[
    'Project Manager',
    'Project Control Manager',
    'Asset Integrity Manager',
    'Process Safety Manager',
    'Asset Integrity Engineer',
    'Process Safety Engineer',
    'Inspection Engineer',
    'Reliability Engineer'
  ];
  title    text;
  added    integer := 0;
  skipped  integer := 0;
begin
  foreach title in array seed_titles loop
    if exists (
      select 1 from public.job_titles
       where lower(btrim(name)) = lower(btrim(title))
    ) then
      skipped := skipped + 1;
      raise notice 'Job title already present, left as-is: %', title;
    else
      insert into public.job_titles (name, active) values (title, true);
      added := added + 1;
      raise notice 'Seeded job title: %', title;
    end if;
  end loop;

  raise notice 'Job titles seeded: %, already present: %.', added, skipped;
end;
$$;
