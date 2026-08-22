-- ROLLBACK for 20260822000001_archive_transition_fix.sql ONLY.
--
-- Restores report_transition_allowed() to the definition 20260820000005
-- installed. One function, replaced in place. No policy, grant, table, trigger
-- or row is touched, and no report data changes.
--
-- WHAT ROLLING BACK COSTS YOU
--   Archive returns to being reachable from only draft, locked and rejected.
--   The defect that stranded EPR-PSM-00-1-W-2026-32 and -34 comes back. There
--   is no data to unwind — any report archived while the fix was live simply
--   stays archived, which is a legitimate state either way.
--
-- Nothing else in P0 depends on the widened rows, so this is a clean revert.

\set ON_ERROR_STOP on

begin;

create or replace function public.report_transition_allowed(
  p_type text, p_from text, p_to text
)
returns boolean
language sql
immutable
as $fn$
  select exists (
    select 1
      from (values
        -- weekly
        ('weekly','draft','collecting'),
        ('weekly','draft','archived'),
        ('weekly','collecting','under_review'),
        ('weekly','under_review','approved'),
        ('weekly','under_review','returned'),
        ('weekly','under_review','rejected'),
        ('weekly','returned','collecting'),
        ('weekly','approved','finalized'),
        ('weekly','approved','returned'),
        ('weekly','finalized','locked'),
        ('weekly','locked','archived'),
        ('weekly','rejected','archived'),
        -- monthly
        ('monthly','draft','auto_compiled'),
        ('monthly','draft','archived'),
        ('monthly','auto_compiled','department_review'),
        ('monthly','department_review','under_review'),
        ('monthly','department_review','returned'),
        ('monthly','under_review','approved'),
        ('monthly','under_review','returned'),
        ('monthly','under_review','rejected'),
        ('monthly','returned','department_review'),
        ('monthly','approved','finalized'),
        ('monthly','approved','returned'),
        ('monthly','finalized','locked'),
        ('monthly','locked','archived'),
        ('monthly','rejected','archived')
      ) as t(kind, from_status, to_status)
     where t.kind = p_type and t.from_status = p_from and t.to_status = p_to
  );
$fn$;

comment on function public.report_transition_allowed(text, text, text) is
  'Whether from -> to is a legal transition. Mirrors reportWorkflows in src/config/workflows.ts; the two must be changed together.';

commit;

do $verify$
begin
  if public.report_transition_allowed('weekly','collecting','archived') then
    raise exception 'Rollback incomplete: the widened archive rows survive.';
  end if;
  if not public.report_transition_allowed('weekly','draft','archived')
     or not public.report_transition_allowed('weekly','collecting','under_review') then
    raise exception 'Rollback overshot: a pre-fix transition is missing.';
  end if;
  raise notice 'Rolled back to the 20260820000005 transition table.';
end;
$verify$;

-- Then remove the version row so the CLI does not consider it applied:
--
-- delete from supabase_migrations.schema_migrations
--  where version = '20260822000001';
--
-- And revert src/config/workflows.ts to match, or the UI will offer archive
-- transitions the database refuses — the drift this pair exists to prevent.
