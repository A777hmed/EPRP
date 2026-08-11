-- EPRP — separate what a Weekly entry IS from what it is ABOUT.
--
-- `weekly_entries` has carried two columns that were quietly answering the
-- same question. `entry_type` said comment | risk | issue | action, while
-- `category` offered 'risk' and 'issue' alongside real business areas — so a
-- Risk could be filed under category Risk, and the old form defaulted it that
-- way. 'escalation' was doing a third job: standing in for "management has to
-- decide this", which is a KIND of item, not a business area.
--
-- After this migration:
--
--   entry_type = what the item IS
--     comment | risk | issue | action | decision
--
--   category   = what business area it RELATES TO
--     progress | technical | hse | quality | financial | client_contractual
--     | general
--
-- Only `decision` is new to entry_type; `technical` and `client_contractual`
-- are new to category.
--
-- NOTHING IS REMOVED. 'risk', 'issue' and 'escalation' stay legal categories
-- so that no stored row can be invalidated by this change and no historical
-- value is rewritten. They are simply no longer offered in the UI, and the
-- application labels them as legacy where it meets them. At the time of
-- writing `weekly_entries` holds zero rows, so nothing is affected in
-- practice — the widened constraint is insurance for any environment that
-- does hold data.
--
-- Additive and reversible: two CHECK constraints are replaced by wider ones.
-- No table is created, no column is dropped, no row is touched, and no RLS
-- policy is involved.

alter table public.weekly_entries
  drop constraint if exists weekly_entries_entry_type_valid;

alter table public.weekly_entries
  add constraint weekly_entries_entry_type_valid
    check (
      entry_type in ('comment', 'risk', 'issue', 'action', 'decision')
    );

alter table public.weekly_entries
  drop constraint if exists weekly_entries_category_valid;

alter table public.weekly_entries
  add constraint weekly_entries_category_valid
    check (
      category in (
        -- Offered by the application.
        'progress',
        'technical',
        'hse',
        'quality',
        'financial',
        'client_contractual',
        'general',
        -- Retained so historical rows stay valid. Not offered.
        'risk',
        'issue',
        'escalation'
      )
    );

comment on column public.weekly_entries.entry_type is
  'What the item IS: comment | risk | issue | action | decision. '
  'decision means management support or a decision is required — the job '
  'category ''escalation'' used to do.';

comment on column public.weekly_entries.category is
  'What business area the item RELATES TO. Offered: progress, technical, '
  'hse, quality, financial, client_contractual, general. The values risk, '
  'issue and escalation are retained for historical rows only — risk and '
  'issue are entry types, not categories.';
