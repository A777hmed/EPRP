-- Phase 13.12 — the Dashboard's compatibility roll-up reads a v2 snapshot's
-- FROZEN engine figures (docs/02 §26.25 D-B).
--
-- `dashboard_planning_rollups()` recomputes the legacy flat roll-up in SQL
-- for each project's latest snapshot. For a v2 snapshot that would be a
-- second, competing figure next to the engine's. This adds one branch:
--
--   * v2 snapshot (engine_version set): the frozen project PV / EV / SV /
--     SPI / coverage, read as published — nothing recomputed;
--   * legacy snapshot: the legacy aggregate, copied VERBATIM (the SQL ↔
--     TypeScript parity of src/lib/planning-rollup-sql-parity.test.mjs still
--     holds);
--   * Opening Position: unchanged.
--
-- Two columns are added so the caller can say which reading it shows:
-- `calculation` (engine · legacy · declared) and `engine_version`. The
-- return type changes, so the function is dropped and recreated with the
-- same grants. No screen is rewired; no row is written.

drop function public.dashboard_planning_rollups();

create function public.dashboard_planning_rollups()
returns table (
  project_id uuid, snapshot_id uuid, snapshot_version integer, data_date date,
  planned_progress numeric, actual_progress numeric, variance numeric,
  planned_value numeric, earned_value numeric, spi numeric, coverage_percent numeric,
  calculation text, engine_version text
)
language sql stable security definer set search_path = '' as $function$
  with latest_snapshot as (
    select distinct on (ps.project_id)
           ps.id, ps.project_id, ps.version, ps.data_date, ps.source_opening_position_id,
           ps.engine_version, ps.project_pv, ps.project_ev, ps.project_sv, ps.project_spi, ps.coverage_percent
      from public.planning_snapshots ps
      join public.projects p on p.id = ps.project_id
     where p.status <> 'archived'
     order by ps.project_id, ps.version desc
  ),
  activity_rollup as (
    select
      ls.project_id,
      ls.id as snapshot_id,
      ls.version as snapshot_version,
      ls.data_date,
      case
        when sum(a.weight_percent) filter (
               where a.weight_percent > 0 and a.percent_complete_planned is not null
             ) > 0
        then sum(a.weight_percent * a.percent_complete_planned) filter (
               where a.weight_percent > 0 and a.percent_complete_planned is not null
             )
             / sum(a.weight_percent) filter (
               where a.weight_percent > 0 and a.percent_complete_planned is not null
             )
        else null
      end as planned_progress,
      case
        when sum(a.weight_percent) filter (
               where a.weight_percent > 0 and a.percent_complete_physical is not null
             ) > 0
        then sum(a.weight_percent * a.percent_complete_physical) filter (
               where a.weight_percent > 0 and a.percent_complete_physical is not null
             )
             / sum(a.weight_percent) filter (
               where a.weight_percent > 0 and a.percent_complete_physical is not null
             )
        else null
      end as actual_progress,
      sum(a.planned_value) as planned_value,
      sum(a.earned_value) as earned_value,
      case
        when sum(a.weight_percent) filter (where a.weight_percent > 0) > 0
        then (
          sum(a.weight_percent) filter (
            where a.weight_percent > 0
              and a.percent_complete_planned is not null
              and a.percent_complete_physical is not null
          )
          / sum(a.weight_percent) filter (where a.weight_percent > 0)
        ) * 100
        else 0
      end as coverage_percent
      from latest_snapshot ls
      left join public.planning_snapshot_activities a on a.snapshot_id = ls.id
     where ls.source_opening_position_id is null and ls.engine_version is null
     group by ls.project_id, ls.id, ls.version, ls.data_date
  ),
  opening_rollup as (
    select
      ls.project_id,
      ls.id as snapshot_id,
      ls.version as snapshot_version,
      ls.data_date,
      op.planned_progress_percent as planned_progress,
      op.actual_progress_percent as actual_progress,
      null::numeric as planned_value,
      null::numeric as earned_value,
      case
        when op.planned_progress_percent is not null and op.actual_progress_percent is not null
        then 100
        else 0
      end as coverage_percent
      from latest_snapshot ls
      join public.planning_opening_positions op on op.id = ls.source_opening_position_id
     where ls.source_opening_position_id is not null
  ),
  legacy_or_declared as (
    select c.project_id, c.snapshot_id, c.snapshot_version, c.data_date,
           c.planned_progress, c.actual_progress,
           case
             when c.planned_progress is not null and c.actual_progress is not null
             then c.actual_progress - c.planned_progress
             else null
           end as variance,
           c.planned_value, c.earned_value,
           case
             when c.planned_value is not null and c.earned_value is not null and c.planned_value > 0
             then c.earned_value / c.planned_value
             else null
           end as spi,
           c.coverage_percent,
           c.calculation,
           null::text as engine_version
      from (select ar.*, 'legacy'::text as calculation from activity_rollup ar
            union all
            select orr.*, 'declared'::text as calculation from opening_rollup orr) c
  ),
  -- 13.12: a v2 snapshot answers with its frozen engine figures.
  engine_frozen as (
    select ls.project_id, ls.id as snapshot_id, ls.version as snapshot_version, ls.data_date,
           ls.project_pv as planned_progress, ls.project_ev as actual_progress, ls.project_sv as variance,
           null::numeric as planned_value, null::numeric as earned_value,
           ls.project_spi as spi, ls.coverage_percent,
           'engine'::text as calculation, ls.engine_version
      from latest_snapshot ls
     where ls.engine_version is not null
  )
  select * from (
    select * from legacy_or_declared
    union all
    select * from engine_frozen
  ) rollups
   where (select auth.uid()) is not null;
$function$;

revoke execute on function public.dashboard_planning_rollups() from public, anon;
grant execute on function public.dashboard_planning_rollups() to authenticated, service_role;
comment on function public.dashboard_planning_rollups() is
  'Every active project''s latest Published Planning Snapshot roll-up. 13.12: a v2 snapshot returns its frozen engine figures (calculation = engine); a legacy snapshot keeps the legacy formula (calculation = legacy); an Opening Position its declared position (calculation = declared).';
