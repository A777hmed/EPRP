-- OC-6: chart review lifecycle and locking.
--
-- `status` previously did two jobs at once: where a chart sits in review, and
-- which chart is live for the project. Those are separate questions — an
-- approved chart is still the live one — so this migration splits them.
--
--   status     draft → in_progress → under_review → approved → locked
--              (plus archived, the retired end state)
--   is_current the project's live chart, at most one at a time
--
-- Approved and locked charts are read-only. That is enforced here by a
-- trigger, not only in the interface, so a direct write is refused too.

begin;

/* ------------------------------ New columns ------------------------------- */

alter table public.organization_charts
  add column if not exists is_current boolean not null default false,
  add column if not exists supersedes_chart_id uuid
    references public.organization_charts(id) on delete set null;

comment on column public.organization_charts.is_current is
  'The project''s live chart. Independent of review status.';
comment on column public.organization_charts.supersedes_chart_id is
  'The chart this one was revised from, if any.';

/* --------------------------- Migrate existing data ------------------------ */

-- Charts that were `active` were the live ones, and were still being worked
-- on rather than reviewed — carry them over as in-progress and current.
update public.organization_charts
   set is_current = true
 where status = 'active'
   and active;

update public.organization_charts
   set status = 'in_progress'
 where status = 'active';

/* ---------------------------- Status constraint --------------------------- */

alter table public.organization_charts
  drop constraint if exists organization_charts_status_valid;

alter table public.organization_charts
  add constraint organization_charts_status_valid
    check (
      status in (
        'draft',
        'in_progress',
        'under_review',
        'approved',
        'locked',
        'archived'
      )
    );

/* ------------------------- One live chart per project --------------------- */

-- The old index keyed off status = 'active', which no longer exists.
drop index if exists organization_charts_one_active_per_project;

create unique index if not exists organization_charts_one_current_per_project
  on public.organization_charts(project_id)
  where is_current and active;

create index if not exists idx_organization_charts_supersedes
  on public.organization_charts(supersedes_chart_id)
  where supersedes_chart_id is not null;

/* ------------------------------ Locking rules ----------------------------- */

create or replace function public.organization_chart_is_editable(p_chart_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select status in ('draft', 'in_progress', 'under_review')
       from public.organization_charts
      where id = p_chart_id),
    false
  );
$$;

comment on function public.organization_chart_is_editable(uuid) is
  'True while a chart is still in a working state. Approved, locked and archived charts are read-only.';

-- Positions cannot be created, changed or removed on a settled chart. The
-- check covers the row's chart both before and after an update, so a position
-- cannot be moved out of a locked chart either.
create or replace function public.enforce_organization_chart_editable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_chart uuid;
begin
  target_chart := case when tg_op = 'DELETE' then old.chart_id else new.chart_id end;

  if not public.organization_chart_is_editable(target_chart) then
    raise exception
      'Organization chart % is read-only. Create a new revision to make changes.',
      target_chart
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and old.chart_id is distinct from new.chart_id then
    if not public.organization_chart_is_editable(old.chart_id) then
      raise exception
        'Organization chart % is read-only. Create a new revision to make changes.',
        old.chart_id
        using errcode = 'check_violation';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_organization_positions_editable
  on public.organization_positions;

create trigger trg_organization_positions_editable
  before insert or update or delete on public.organization_positions
  for each row
  execute function public.enforce_organization_chart_editable();

/* -------------------------------- Comments -------------------------------- */

comment on table public.organization_charts is
  'Project organization charts. One chart per project may be current; approved and locked charts are read-only.';

comment on column public.organization_charts.status is
  'Review lifecycle: draft, in_progress, under_review, approved, locked, archived.';

commit;
