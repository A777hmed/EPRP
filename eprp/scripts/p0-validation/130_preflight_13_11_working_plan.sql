-- Phase 13.11 Working Plan hardening — PREFLIGHT AUDIT. READ-ONLY. LOCAL ONLY.
--
-- Run BEFORE 20261022090000_working_plan_hardening.sql. Changes nothing (the
-- whole script runs in a transaction that is rolled back). It reports what
-- the migration will meet in existing data, so nothing is "repaired" blind:
--
--   1  projects whose nodes / activities carry a RECORDED weight
--      (weight_percent). 13.11 never reinterprets these as local weights; each
--      project is reviewed into the local model by an explicit decision.
--   2  activities NOT attached to a node in projects that have a planning
--      hierarchy (H3) — the Master Plan lists them for attachment.
--   3  nodes still classified "milestone" / flagged is_milestone (H5) —
--      deprecated, stay readable, cannot be newly set.
--   4  existing reporting-unit mappings that the new guard would refuse IF
--      they were written again (PSM columns on an Other project; a
--      department / Program & Study outside the project; a system outside its
--      department). Existing rows are not rewritten and stay valid.
--   5  true milestone activities whose stored dates are not zero-duration.
--   6  planning_confirmations rows the widened constraints must accept.
--
-- HOW TO RUN (from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/130_preflight_13_11_working_plan.sql

\set ON_ERROR_STOP on
\pset pager off

begin read only;

\echo '--- 1. recorded weights (never reinterpreted; reviewed into local weights by decision)'
select p.code,
       count(*) filter (where w.weight_percent is not null) as nodes_with_recorded_weight,
       (select count(*) from public.planning_activities a
         where a.project_id = p.id and a.active and a.weight_percent is not null) as activities_with_recorded_weight,
       p.status
  from public.projects p
  join public.planning_work_items w on w.project_id = p.id and w.active
 group by p.id, p.code, p.status
 order by p.code;

\echo '--- 2. activities not attached to a node in a project with a hierarchy (H3)'
select p.code, count(*) as unattached_activities
  from public.planning_activities a
  join public.projects p on p.id = a.project_id
 where a.active
   and (a.work_item_id is null
        or not exists (select 1 from public.planning_work_items w where w.id = a.work_item_id and w.active))
   and exists (select 1 from public.planning_work_items w where w.project_id = a.project_id and w.active)
 group by p.code order by p.code;

\echo '--- 3. nodes still classified or flagged as milestones (H5, deprecated)'
select p.code, w.code as node, w.item_type, w.is_milestone
  from public.planning_work_items w
  join public.projects p on p.id = w.project_id
 where w.active and (w.item_type = 'milestone' or w.is_milestone)
 order by p.code, w.code;

\echo '--- 4. existing mappings the new guard would refuse if written again (not rewritten)'
select * from (
select p.code, w.code as node,
       case
         when p.structure_family = 'other' and (w.department_id is not null or w.system_id is not null or w.discipline_id is not null)
           then 'PSM mapping on an Other project'
         when (w.system_id is not null or w.discipline_id is not null) and w.department_id is null
           then 'system / Program & Study without department'
         when w.department_id is not null and not exists (select 1 from public.project_departments d
                where d.project_id = w.project_id and d.department_id = w.department_id)
           then 'department not in project'
         when w.system_id is not null and (select s.department_id from public.systems s where s.id = w.system_id) is distinct from w.department_id
           then 'system outside its department'
         when w.discipline_id is not null and not exists (select 1 from public.project_disciplines pd
                where pd.project_id = w.project_id and pd.discipline_id = w.discipline_id)
           then 'Program & Study not in project'
       end as finding
  from public.planning_work_items w
  join public.projects p on p.id = w.project_id
 where w.department_id is not null or w.system_id is not null or w.discipline_id is not null
) mapped where finding is not null
 order by code, node;

\echo '--- 5. true milestone activities that are not zero-duration'
select p.code, a.code as activity, a.planned_start_date, a.planned_finish_date,
       a.baseline_start_date, a.baseline_finish_date
  from public.planning_activities a
  join public.projects p on p.id = a.project_id
 where a.active and a.is_milestone
   and ((a.planned_start_date is not null and a.planned_finish_date is not null and a.planned_start_date <> a.planned_finish_date)
     or (a.baseline_start_date is not null and a.baseline_finish_date is not null and a.baseline_start_date <> a.baseline_finish_date))
 order by p.code, a.code;

\echo '--- 6. Planning Decision log: actions and reasons the widened constraints must accept'
select action, count(*) as rows, count(*) filter (where reason is null or btrim(reason) = '') as blank_reasons
  from public.planning_confirmations group by action order by action;

\echo '--- 7. planning settings rows (Planning Configuration starts empty on each)'
select s.onboarding_mode, count(*) from public.project_planning_settings s group by s.onboarding_mode order by 1;

rollback;
