-- Phase 13.12 Published Planning Snapshot v2 — PREFLIGHT. READ-ONLY. LOCAL ONLY.
--
-- What exists before (and after) the 13.12 migrations, so nothing historical
-- is reinterpreted: legacy snapshots, Opening Position snapshots, legacy
-- named baseline captures, and the write paths that must be closed.
-- Runs entirely in a READ ONLY transaction that is rolled back.
--
-- HOW TO RUN (from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/132_preflight_13_12_snapshot_v2.sql

\set ON_ERROR_STOP on
\pset pager off

begin transaction read only;

select 'snapshots' as what,
       count(*) as total,
       count(*) filter (where is_opening_snapshot) as opening_position,
       count(*) filter (where not is_opening_snapshot) as normal,
       count(*) filter (where data_date is null) as without_data_date
  from public.planning_snapshots;

select 'baselines' as what, count(*) as total from public.planning_baselines;

-- After the migrations: nothing pre-existing is v2, every baseline reads as legacy.
select 'v2 snapshots (expected 0 before any v2 publish)' as what,
       case when to_regclass('public.planning_snapshot_nodes') is null then null
            else (select count(*) from public.planning_snapshots s
                   where (to_jsonb(s) ->> 'engine_version') is not null) end as total;
select 'non-legacy baselines (expected 0 before any request)' as what,
       (select count(*) from public.planning_baselines b
         where coalesce(to_jsonb(b) ->> 'revision_status', 'legacy') <> 'legacy') as total;

-- Client write paths on the snapshot / baseline tables (expected: none after the migrations).
select tablename, policyname, cmd from pg_policies
 where tablename in ('planning_snapshots', 'planning_snapshot_activities', 'planning_baselines')
 order by tablename, cmd;

-- Projects whose next normal publish needs an approved BL0 (D-D).
select p.code, coalesce(s.onboarding_mode, '(not chosen)') as onboarding_mode,
       (select count(*) from public.planning_snapshots ps where ps.project_id = p.id) as snapshots,
       (select count(*) from public.planning_activities a where a.project_id = p.id and a.active) as activities
  from public.projects p
  left join public.project_planning_settings s on s.project_id = p.id
 where exists (select 1 from public.planning_activities a where a.project_id = p.id)
 order by p.code;

rollback;
