-- Phase 13.12 Published Planning Snapshot v2 + Baseline Revisions — RUNTIME
-- verification. LOCAL DATABASE ONLY.
--
-- Proves 20261024090000_baseline_revisions.sql,
-- 20261025090000_published_planning_snapshot_v2.sql and
-- 20261025090100_v2_compatibility_rollup.sql against real PostgreSQL, real
-- RLS and real roles. Everything — fixtures, accounts and every write — runs
-- in ONE transaction that is ROLLED BACK. Nothing persists.
--
-- The §26.5 worked example is seeded as a real Working Plan; BL0 and BL1 are
-- requested and approved through the real functions; the publish payload in
-- the GENERATED block below was produced by the real 13.12 orchestration
-- (13.11 adapter → 13.10 engine) from the same rows and is handed to the real
-- trusted writer. Only the identities the server reads at publish time (the
-- Working Plan fingerprint and the approved baseline ids) are patched in.
--
--   01  Baseline request: server-only, as the user; authority; stale; one pending
--   02  B3 / B8: no self-approval; who decides; first-anchor confirmation; BL0 anchor
--   03  approved baseline immutable; "Superseded by BL0"; reject / withdraw
--   04  publish v2 refusals: legacy publish retired, direct inserts, client
--       call, authority, stale Working Plan, tampered input, baseline changed
--   05  publish v2 §26.5: frozen figures, provenance, nodes, milestone, curve
--   05B the publish context (browser UAT): the fingerprint a dialog prepared
--       against moves on a % complete save and a settings save; the writer
--       refuses a payload carrying it; reopened, the publish succeeds
--   06  immutability of every snapshot row; D-B compatibility roll-up
--   07  re-baseline never changes a published snapshot; new scope needs a re-baseline
--   08  imports never re-baseline; source batch checks
--   09  no formal schedule and archived projects
--   10  legacy snapshots unchanged; Opening Position unchanged
--   11  catalog
--
-- HOW TO RUN (after the migrations are applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/133_runtime_13_12_snapshot_v2.sql

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception 'REFUSING TO RUN: this connection is not local (server address %).',
      host(inet_server_addr());
  end if;
end;
$guard$;

begin;

create temp table r(seq int, area text, item text, verdict text) on commit drop;
grant all on r to authenticated, anon, service_role;
do $g$
begin
  execute format('grant usage on schema %I to authenticated, anon, service_role',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end $g$;

create temp table ids(key text primary key, id uuid, note text) on commit drop;
grant select, insert, update on ids to authenticated, anon, service_role;

-- @@GENERATED-BEGIN@@ (src/features/projects/planning-publish/sql-fixture.mjs — do not edit by hand)
create temp table fx(key text primary key, value jsonb) on commit drop;
grant select on fx to authenticated, anon, service_role;
insert into fx values ('project_id', $fx$"00000000-0000-4000-d265-000000000017"$fx$::jsonb);
insert into fx values ('placeholder_bl0', $fx$"00000000-0000-4000-d265-000000000018"$fx$::jsonb);
insert into fx values ('placeholder_bl1', $fx$"00000000-0000-4000-d265-000000000019"$fx$::jsonb);
insert into fx values ('data_date', $fx$"2026-10-31"$fx$::jsonb);
insert into fx values ('work_items', $fx$[{"id":"00000000-0000-4000-d265-000000000001","parent_work_item_id":null,"code":"RBI","name":"RBI","item_type":"engineering","level":1,"sort_order":0,"local_weight_percent":10,"is_control_account":true},{"id":"00000000-0000-4000-d265-000000000002","parent_work_item_id":"00000000-0000-4000-d265-000000000001","code":"VDU","name":"VDU","item_type":"engineering","level":2,"sort_order":1,"local_weight_percent":40,"is_control_account":false},{"id":"00000000-0000-4000-d265-000000000007","parent_work_item_id":"00000000-0000-4000-d265-000000000001","code":"CDU","name":"CDU","item_type":"engineering","level":2,"sort_order":2,"local_weight_percent":35,"is_control_account":false},{"id":"00000000-0000-4000-d265-000000000010","parent_work_item_id":"00000000-0000-4000-d265-000000000001","code":"UTL","name":"Utilities","item_type":"engineering","level":2,"sort_order":3,"local_weight_percent":25,"is_control_account":false},{"id":"00000000-0000-4000-d265-000000000013","parent_work_item_id":null,"code":"HAZOP","name":"HAZOP","item_type":"engineering","level":1,"sort_order":4,"local_weight_percent":50,"is_control_account":true},{"id":"00000000-0000-4000-d265-000000000015","parent_work_item_id":null,"code":"SIL","name":"SIL","item_type":"engineering","level":1,"sort_order":5,"local_weight_percent":40,"is_control_account":true}]$fx$::jsonb);
insert into fx values ('activities_bl0', $fx$[{"id":"00000000-0000-4000-d265-000000000003","work_item_id":"00000000-0000-4000-d265-000000000002","code":"VDU-A10","name":"Data collection","is_milestone":false,"local_weight_percent":30,"earning_method":"percent_complete","planned_start_date":"2026-09-01","planned_finish_date":"2026-09-30"},{"id":"00000000-0000-4000-d265-000000000004","work_item_id":"00000000-0000-4000-d265-000000000002","code":"VDU-A20","name":"Damage mechanisms & corrosion loops","is_milestone":false,"local_weight_percent":40,"earning_method":"percent_complete","planned_start_date":"2026-10-08","planned_finish_date":"2026-11-04"},{"id":"00000000-0000-4000-d265-000000000005","work_item_id":"00000000-0000-4000-d265-000000000002","code":"VDU-A30","name":"Draft RBI report","is_milestone":false,"local_weight_percent":30,"earning_method":"percent_complete","planned_start_date":"2026-10-26","planned_finish_date":"2026-11-22"},{"id":"00000000-0000-4000-d265-000000000006","work_item_id":"00000000-0000-4000-d265-000000000002","code":"VDU-M10","name":"VDU RBI Final Report Approved","is_milestone":true,"local_weight_percent":0,"earning_method":"milestone","planned_start_date":"2026-12-01","planned_finish_date":"2026-12-01"},{"id":"00000000-0000-4000-d265-000000000008","work_item_id":"00000000-0000-4000-d265-000000000007","code":"CDU-A10","name":"Data collection","is_milestone":false,"local_weight_percent":40,"earning_method":"fifty_fifty","planned_start_date":"2026-09-01","planned_finish_date":"2026-09-30"},{"id":"00000000-0000-4000-d265-000000000009","work_item_id":"00000000-0000-4000-d265-000000000007","code":"CDU-A20","name":"Corrosion assessment","is_milestone":false,"local_weight_percent":60,"earning_method":"percent_complete","planned_start_date":"2026-10-26","planned_finish_date":"2026-11-22"},{"id":"00000000-0000-4000-d265-000000000011","work_item_id":"00000000-0000-4000-d265-000000000010","code":"UTL-A10","name":"Site walkdown","is_milestone":false,"local_weight_percent":20,"earning_method":"zero_hundred","planned_start_date":"2026-10-01","planned_finish_date":"2026-10-15"},{"id":"00000000-0000-4000-d265-000000000012","work_item_id":"00000000-0000-4000-d265-000000000010","code":"UTL-A20","name":"Data collection","is_milestone":false,"local_weight_percent":80,"earning_method":"percent_complete","planned_start_date":"2026-11-01","planned_finish_date":"2026-11-26"},{"id":"00000000-0000-4000-d265-000000000014","work_item_id":"00000000-0000-4000-d265-000000000013","code":"HAZOP-A10","name":"HAZOP sessions","is_milestone":false,"local_weight_percent":100,"earning_method":"percent_complete","planned_start_date":"2026-10-12","planned_finish_date":"2026-11-08"},{"id":"00000000-0000-4000-d265-000000000016","work_item_id":"00000000-0000-4000-d265-000000000015","code":"SIL-A10","name":"SIL assessment","is_milestone":false,"local_weight_percent":100,"earning_method":"percent_complete","planned_start_date":"2026-10-22","planned_finish_date":"2026-11-18"}]$fx$::jsonb);
insert into fx values ('state_bl1', $fx$[{"id":"00000000-0000-4000-d265-000000000003","planned_start_date":"2026-09-01","planned_finish_date":"2026-09-30","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000004","planned_start_date":"2026-10-08","planned_finish_date":"2026-11-04","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000005","planned_start_date":"2026-10-26","planned_finish_date":"2026-11-22","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000006","planned_start_date":"2026-12-15","planned_finish_date":"2026-12-15","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000008","planned_start_date":"2026-09-01","planned_finish_date":"2026-09-30","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000009","planned_start_date":"2026-10-26","planned_finish_date":"2026-11-22","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000011","planned_start_date":"2026-10-01","planned_finish_date":"2026-10-15","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000012","planned_start_date":"2026-11-01","planned_finish_date":"2026-11-26","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000014","planned_start_date":"2026-10-12","planned_finish_date":"2026-11-08","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000016","planned_start_date":"2026-10-22","planned_finish_date":"2026-11-18","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null}]$fx$::jsonb);
insert into fx values ('state_current', $fx$[{"id":"00000000-0000-4000-d265-000000000003","planned_start_date":null,"planned_finish_date":null,"actual_start_date":"2026-09-01","actual_finish_date":"2026-09-30","percent_complete_physical":100},{"id":"00000000-0000-4000-d265-000000000004","planned_start_date":null,"planned_finish_date":"2026-11-12","actual_start_date":"2026-10-08","actual_finish_date":null,"percent_complete_physical":60},{"id":"00000000-0000-4000-d265-000000000005","planned_start_date":"2026-11-01","planned_finish_date":"2026-11-30","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000006","planned_start_date":null,"planned_finish_date":"2026-12-29","actual_start_date":null,"actual_finish_date":null,"percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000008","planned_start_date":null,"planned_finish_date":null,"actual_start_date":"2026-09-01","actual_finish_date":"2026-09-30","percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000009","planned_start_date":null,"planned_finish_date":"2026-11-26","actual_start_date":"2026-10-26","actual_finish_date":null,"percent_complete_physical":15},{"id":"00000000-0000-4000-d265-000000000011","planned_start_date":null,"planned_finish_date":null,"actual_start_date":"2026-10-04","actual_finish_date":"2026-10-14","percent_complete_physical":null},{"id":"00000000-0000-4000-d265-000000000012","planned_start_date":null,"planned_finish_date":"2026-11-26","actual_start_date":"2026-10-28","actual_finish_date":null,"percent_complete_physical":5},{"id":"00000000-0000-4000-d265-000000000014","planned_start_date":null,"planned_finish_date":"2026-11-10","actual_start_date":"2026-10-12","actual_finish_date":null,"percent_complete_physical":66},{"id":"00000000-0000-4000-d265-000000000016","planned_start_date":null,"planned_finish_date":"2026-11-18","actual_start_date":"2026-10-22","actual_finish_date":null,"percent_complete_physical":30}]$fx$::jsonb);
insert into fx values ('curve_bl0', $fx$[{"date":"2026-08-27","value":0},{"date":"2026-09-03","value":0.8636363636363636},{"date":"2026-09-10","value":1.1363636363636365},{"date":"2026-09-17","value":1.4090909090909092},{"date":"2026-09-24","value":1.6818181818181819},{"date":"2026-10-01","value":2.6},{"date":"2026-10-08","value":2.68},{"date":"2026-10-15","value":13.58},{"date":"2026-10-22","value":28.48},{"date":"2026-10-29","value":52.04},{"date":"2026-11-05","value":76.185},{"date":"2026-11-12","value":90.01},{"date":"2026-11-19","value":99.33500000000001},{"date":"2026-11-26","value":100},{"date":"2026-12-03","value":100}]$fx$::jsonb);
insert into fx values ('curve_bl1', $fx$[{"date":"2026-08-27","value":0},{"date":"2026-09-03","value":0.8636363636363636},{"date":"2026-09-10","value":1.1363636363636365},{"date":"2026-09-17","value":1.4090909090909092},{"date":"2026-09-24","value":1.6818181818181819},{"date":"2026-10-01","value":2.6},{"date":"2026-10-08","value":2.68},{"date":"2026-10-15","value":13.58},{"date":"2026-10-22","value":28.48},{"date":"2026-10-29","value":52.04},{"date":"2026-11-05","value":76.185},{"date":"2026-11-12","value":90.01},{"date":"2026-11-19","value":99.33500000000001},{"date":"2026-11-26","value":100},{"date":"2026-12-03","value":100},{"date":"2026-12-10","value":100},{"date":"2026-12-17","value":100}]$fx$::jsonb);
insert into fx values ('engine_version', $fx$"1.0.0"$fx$::jsonb);
insert into fx values ('payload', $fx${"fingerprint":"fp-26-5","data_date":"2026-10-31","source_import_batch_id":null,"label":null,"engine_version":"1.0.0","bl0_baseline_id":"00000000-0000-4000-d265-000000000018","bln_baseline_id":"00000000-0000-4000-d265-000000000019","project":{"pv":52.04,"ev":49.475,"sv":-2.5649999999999977,"spi":0.9507109915449654,"spi_reason":null},"coverage_percent":100,"cross_check_max_difference":0,"advisories":[],"finish":{"bl0_finish":"2026-12-01","bln_finish":"2026-12-15","forecast_finish":"2026-12-29"},"nodes":[{"work_item_id":"00000000-0000-4000-d265-000000000001","parent_id":null,"item_position":0,"depth":1,"is_control_account":true,"local_weight":10,"effective_weight":10,"pv":50.4,"ev":44.75,"sv":-5.649999999999999,"spi":0.8878968253968255,"spi_reason":null,"pv_contribution":5.04,"ev_contribution":4.475,"department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"work_item_id":"00000000-0000-4000-d265-000000000002","parent_id":"00000000-0000-4000-d265-000000000001","item_position":1,"depth":2,"is_control_account":false,"local_weight":40,"effective_weight":4.000000000000001,"pv":68,"ev":54,"sv":-14,"spi":0.7941176470588235,"spi_reason":null,"pv_contribution":2.7200000000000006,"ev_contribution":2.1600000000000006,"department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"work_item_id":"00000000-0000-4000-d265-000000000007","parent_id":"00000000-0000-4000-d265-000000000001","item_position":6,"depth":2,"is_control_account":false,"local_weight":35,"effective_weight":3.4999999999999996,"pv":52,"ev":49,"sv":-3,"spi":0.9423076923076923,"spi_reason":null,"pv_contribution":1.8199999999999996,"ev_contribution":1.7149999999999996,"department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"work_item_id":"00000000-0000-4000-d265-000000000010","parent_id":"00000000-0000-4000-d265-000000000001","item_position":9,"depth":2,"is_control_account":false,"local_weight":25,"effective_weight":2.5,"pv":20,"ev":24,"sv":4,"spi":1.2,"spi_reason":null,"pv_contribution":0.5,"ev_contribution":0.6,"department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"work_item_id":"00000000-0000-4000-d265-000000000013","parent_id":null,"item_position":12,"depth":1,"is_control_account":true,"local_weight":50,"effective_weight":50,"pv":70,"ev":66,"sv":-4,"spi":0.9428571428571428,"spi_reason":null,"pv_contribution":35,"ev_contribution":33,"department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"work_item_id":"00000000-0000-4000-d265-000000000015","parent_id":null,"item_position":14,"depth":1,"is_control_account":true,"local_weight":40,"effective_weight":40,"pv":30,"ev":30,"sv":0,"spi":1,"spi_reason":null,"pv_contribution":12,"ev_contribution":12,"department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null}],"activities":[{"activity_id":"00000000-0000-4000-d265-000000000003","work_item_id":"00000000-0000-4000-d265-000000000002","item_position":2,"earning_method":"percent_complete","local_weight":30,"effective_weight":1.2000000000000002,"pv":100,"ev":100,"sv":0,"pv_contribution":1.2000000000000002,"ev_contribution":1.2000000000000002,"percent_complete":100,"forecast_start":null,"forecast_finish":null,"actual_start":"2026-09-01","actual_finish":"2026-09-30","bln_start":"2026-09-01","bln_finish":"2026-09-30","bl0_start":"2026-09-01","bl0_finish":"2026-09-30","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"activity_id":"00000000-0000-4000-d265-000000000004","work_item_id":"00000000-0000-4000-d265-000000000002","item_position":3,"earning_method":"percent_complete","local_weight":40,"effective_weight":1.6000000000000003,"pv":80,"ev":60,"sv":-20,"pv_contribution":1.2800000000000002,"ev_contribution":0.9600000000000002,"percent_complete":60,"forecast_start":null,"forecast_finish":"2026-11-12","actual_start":"2026-10-08","actual_finish":null,"bln_start":"2026-10-08","bln_finish":"2026-11-04","bl0_start":"2026-10-08","bl0_finish":"2026-11-04","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"activity_id":"00000000-0000-4000-d265-000000000005","work_item_id":"00000000-0000-4000-d265-000000000002","item_position":4,"earning_method":"percent_complete","local_weight":30,"effective_weight":1.2000000000000002,"pv":20,"ev":0,"sv":-20,"pv_contribution":0.24000000000000005,"ev_contribution":0,"percent_complete":null,"forecast_start":"2026-11-01","forecast_finish":"2026-11-30","actual_start":null,"actual_finish":null,"bln_start":"2026-10-26","bln_finish":"2026-11-22","bl0_start":"2026-10-26","bl0_finish":"2026-11-22","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"activity_id":"00000000-0000-4000-d265-000000000006","work_item_id":"00000000-0000-4000-d265-000000000002","item_position":5,"earning_method":"milestone","local_weight":0,"effective_weight":0,"pv":0,"ev":0,"sv":0,"pv_contribution":0,"ev_contribution":0,"percent_complete":null,"forecast_start":null,"forecast_finish":"2026-12-29","actual_start":null,"actual_finish":null,"bln_start":"2026-12-15","bln_finish":"2026-12-15","bl0_start":"2026-12-01","bl0_finish":"2026-12-01","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"activity_id":"00000000-0000-4000-d265-000000000008","work_item_id":"00000000-0000-4000-d265-000000000007","item_position":7,"earning_method":"fifty_fifty","local_weight":40,"effective_weight":1.4,"pv":100,"ev":100,"sv":0,"pv_contribution":1.4,"ev_contribution":1.4,"percent_complete":null,"forecast_start":null,"forecast_finish":null,"actual_start":"2026-09-01","actual_finish":"2026-09-30","bln_start":"2026-09-01","bln_finish":"2026-09-30","bl0_start":"2026-09-01","bl0_finish":"2026-09-30","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"activity_id":"00000000-0000-4000-d265-000000000009","work_item_id":"00000000-0000-4000-d265-000000000007","item_position":8,"earning_method":"percent_complete","local_weight":60,"effective_weight":2.0999999999999996,"pv":20,"ev":15,"sv":-5,"pv_contribution":0.41999999999999993,"ev_contribution":0.31499999999999995,"percent_complete":15,"forecast_start":null,"forecast_finish":"2026-11-26","actual_start":"2026-10-26","actual_finish":null,"bln_start":"2026-10-26","bln_finish":"2026-11-22","bl0_start":"2026-10-26","bl0_finish":"2026-11-22","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"activity_id":"00000000-0000-4000-d265-000000000011","work_item_id":"00000000-0000-4000-d265-000000000010","item_position":10,"earning_method":"zero_hundred","local_weight":20,"effective_weight":0.5000000000000001,"pv":100,"ev":100,"sv":0,"pv_contribution":0.5000000000000001,"ev_contribution":0.5000000000000001,"percent_complete":null,"forecast_start":null,"forecast_finish":null,"actual_start":"2026-10-04","actual_finish":"2026-10-14","bln_start":"2026-10-01","bln_finish":"2026-10-15","bl0_start":"2026-10-01","bl0_finish":"2026-10-15","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"activity_id":"00000000-0000-4000-d265-000000000012","work_item_id":"00000000-0000-4000-d265-000000000010","item_position":11,"earning_method":"percent_complete","local_weight":80,"effective_weight":2.0000000000000004,"pv":0,"ev":5,"sv":5,"pv_contribution":0,"ev_contribution":0.10000000000000002,"percent_complete":5,"forecast_start":null,"forecast_finish":"2026-11-26","actual_start":"2026-10-28","actual_finish":null,"bln_start":"2026-11-01","bln_finish":"2026-11-26","bl0_start":"2026-11-01","bl0_finish":"2026-11-26","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"activity_id":"00000000-0000-4000-d265-000000000014","work_item_id":"00000000-0000-4000-d265-000000000013","item_position":13,"earning_method":"percent_complete","local_weight":100,"effective_weight":50,"pv":70,"ev":66,"sv":-4,"pv_contribution":35,"ev_contribution":33,"percent_complete":66,"forecast_start":null,"forecast_finish":"2026-11-10","actual_start":"2026-10-12","actual_finish":null,"bln_start":"2026-10-12","bln_finish":"2026-11-08","bl0_start":"2026-10-12","bl0_finish":"2026-11-08","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null},{"activity_id":"00000000-0000-4000-d265-000000000016","work_item_id":"00000000-0000-4000-d265-000000000015","item_position":15,"earning_method":"percent_complete","local_weight":100,"effective_weight":40,"pv":30,"ev":30,"sv":0,"pv_contribution":12,"ev_contribution":12,"percent_complete":30,"forecast_start":null,"forecast_finish":"2026-11-18","actual_start":"2026-10-22","actual_finish":null,"bln_start":"2026-10-22","bln_finish":"2026-11-18","bl0_start":"2026-10-22","bl0_finish":"2026-11-18","department_id":null,"system_id":null,"discipline_id":null,"structure_node_id":null}],"milestones":[{"activity_id":"00000000-0000-4000-d265-000000000006","is_key":false,"bl0_date":"2026-12-01","bln_date":"2026-12-15","forecast_date":"2026-12-29","actual_date":null,"status":"upcoming","slip_vs_bln":14,"slip_vs_bln_reason":null,"slip_vs_bl0":28,"slip_vs_bl0_reason":null,"due":false}],"forecast_curve":[{"date":"2026-10-31","value":49.475},{"date":"2026-11-05","value":71.56982142857143},{"date":"2026-11-12","value":89.47178571428572},{"date":"2026-11-19","value":98.67875000000001},{"date":"2026-11-26","value":99.88571428571429},{"date":"2026-12-03","value":100},{"date":"2026-12-10","value":100},{"date":"2026-12-17","value":100},{"date":"2026-12-24","value":100},{"date":"2026-12-31","value":100}],"forecast_curve_reason":null}$fx$::jsonb);
-- @@GENERATED-END@@

create or replace function pg_temp.chk(
  p_seq int, p_area text, p_item text, p_ok boolean, p_detail text default ''
) returns void language plpgsql as $$
begin
  insert into r values (p_seq, p_area, p_item,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end ||
    case when p_detail = '' then '' else ' — ' || p_detail end);
end $$;

create or replace function pg_temp.must_fail(
  p_seq int, p_area text, p_item text, p_sql text, p_expect text default null
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was ACCEPTED');
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item,
    p_expect is null or position(p_expect in sqlerrm) > 0 or sqlstate = p_expect,
    'refused [' || sqlstate || ']: ' || left(sqlerrm, 110));
end $$;

create or replace function pg_temp.must_pass(
  p_seq int, p_area text, p_item text, p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, true);
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, false, '[' || sqlstate || '] ' || left(sqlerrm, 120));
end $$;

create or replace function pg_temp.act(p_profile uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
end $$;
-- The server's service-role client: no user in the token.
create or replace function pg_temp.svc() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create or replace function pg_temp.owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.fx(p_key text) returns jsonb language sql as $$ select value from fx where key = p_key $$;
create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select id from public.projects where code = p_code $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp join public.projects p on p.id = pp.project_id
                    where p.code = p_code and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.id(p_key text) returns uuid
language sql as $$ select id from ids where key = p_key $$;

-- The Working Plan fingerprint as the server reads it (as that user).
create or replace function pg_temp.fp(p_actor uuid, p_project uuid) returns text language plpgsql as $$
declare
  v text;
  v_role text := current_setting('role');
  v_claims text := current_setting('request.jwt.claims', true);
begin
  perform pg_temp.act(p_actor);
  v := public.planning_working_plan_fingerprint(p_project);
  perform set_config('role', v_role, true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v;
end $$;

create or replace function pg_temp.req(p_actor uuid, p_project uuid, p_curve text, p_fp text default null)
returns text language sql as $$
  select format('select public.request_planning_baseline(%L::uuid, %L::uuid, %L, %L, %L::jsonb, %L)',
    p_actor, p_project, 'ZZ 13.12 baseline reason', coalesce(p_fp, pg_temp.fp(p_actor, p_project)),
    pg_temp.fx(p_curve)::text, pg_temp.fx('engine_version') #>> '{}')
$$;
create or replace function pg_temp.decide(p_baseline uuid, p_decision text, p_comment text default null, p_confirm boolean default false)
returns text language sql as $$
  select format('select public.decide_planning_baseline(%L::uuid, %L, %L, %L::boolean)', p_baseline, p_decision, p_comment, p_confirm)
$$;
create or replace function pg_temp.pending(p_project uuid) returns uuid language sql as $$
  select id from public.planning_baselines where project_id = p_project and revision_status = 'requested'
$$;
create or replace function pg_temp.approved(p_project uuid, p_number int) returns uuid language sql as $$
  select id from public.planning_baselines where project_id = p_project and revision_status = 'approved' and revision_number = p_number
$$;
-- The generated payload with the identities the server reads at publish time.
create or replace function pg_temp.live_payload(p_actor uuid, p_project uuid) returns jsonb language plpgsql as $$
declare
  v_bln uuid := (select id from public.planning_baselines where project_id = p_project and revision_status = 'approved'
                  order by revision_number desc limit 1);
begin
  return jsonb_set(jsonb_set(jsonb_set(pg_temp.fx('payload'),
           '{fingerprint}', to_jsonb(pg_temp.fp(p_actor, p_project))),
           '{bl0_baseline_id}', to_jsonb(pg_temp.approved(p_project, 0))),
           '{bln_baseline_id}', to_jsonb(v_bln));
end $$;
create or replace function pg_temp.pub(p_actor uuid, p_project uuid, p_payload jsonb, p_confirm boolean default false)
returns text language sql as $$
  select format('insert into ids(key, id) values (%L, public.publish_planning_snapshot_v2(%L::uuid, %L::uuid, %L::jsonb, %L::boolean)) on conflict (key) do update set id = excluded.id',
    'SNAP', p_actor, p_project, p_payload::text, p_confirm)
$$;
create or replace function pg_temp.stage(p_key text) returns void language sql as $$
  update public.planning_activities a
     set planned_start_date = s.planned_start_date, planned_finish_date = s.planned_finish_date,
         actual_start_date = s.actual_start_date, actual_finish_date = s.actual_finish_date,
         percent_complete_physical = s.percent_complete_physical
    from jsonb_to_recordset(pg_temp.fx(p_key)) as s(id uuid, planned_start_date date, planned_finish_date date,
         actual_start_date date, actual_finish_date date, percent_complete_physical numeric)
   where a.id = s.id;
$$;
-- A content hash of one snapshot and every row it owns.
create or replace function pg_temp.snapshot_hash(p_snapshot uuid) returns text language sql as $$
  select md5(concat_ws('|',
    (select to_jsonb(s)::text from public.planning_snapshots s where s.id = p_snapshot),
    (select string_agg(to_jsonb(a)::text, ',' order by a.id) from public.planning_snapshot_activities a where a.snapshot_id = p_snapshot),
    (select string_agg(to_jsonb(n)::text, ',' order by n.source_work_item_id) from public.planning_snapshot_nodes n where n.snapshot_id = p_snapshot),
    (select string_agg(to_jsonb(m)::text, ',' order by m.source_activity_id) from public.planning_snapshot_milestones m where m.snapshot_id = p_snapshot),
    (select string_agg(to_jsonb(c)::text, ',' order by c.point_date) from public.planning_snapshot_curve_points c where c.snapshot_id = p_snapshot)))
$$;

-- Every snapshot and baseline that existed before this suite (legacy history).
create temp table legacy_before on commit drop as
  select 'S' as t, s.id, md5(to_jsonb(s)::text) as h from public.planning_snapshots s
  union all select 'A', a.id, md5(to_jsonb(a)::text) from public.planning_snapshot_activities a
  union all select 'B', b.id, md5(to_jsonb(b)::text) from public.planning_baselines b;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  v_project uuid := (pg_temp.fx('project_id') #>> '{}')::uuid;
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regprocedure('public.publish_planning_snapshot_v2(uuid,uuid,jsonb,boolean)') is null then
    raise exception 'publish_planning_snapshot_v2() not found — apply the 13.12 migrations first.';
  end if;
  if (select count(*) from fx) = 0 then
    raise exception 'The GENERATED fixture block is empty — run scripts/p0-validation/gen_133_fixture.mjs.';
  end if;

  insert into public.projects (id, code, name, client_id, planned_start_date, planned_finish_date, status, structure_family,
                               working_week, weekly_reporting_day)
  select case v.s when '265' then v_project else gen_random_uuid() end,
         'ZZ-1312-' || v.s, 'ZZ 13.12 ' || v.s, p.client_id, '2026-08-01', '2027-06-30', 'active', 'psm',
         'Sun – Thu', 'thursday'
    from public.projects p, (values ('265'), ('NF'), ('EXIST')) v(s)
   where p.id = v_template;

  -- X = assigned Project Control; Y = Reporting Coordinator; PCA = Project
  -- Control Admin; SA = an existing System Administrator.
  insert into public.contacts (name, email, active)
  select 'ZZ 1312 ' || s, 'zz.1312.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('Y'), ('PCA')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-c000-0000001312' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.1312.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('Y', '02'), ('PCA', '04')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-c000-0000001312' || v.n)::uuid, 'zz.1312.' || lower(v.s) || '@example.invalid',
         'ZZ 1312 ' || v.s, v.role, pg_temp.person('ZZ 1312 ' || v.s), true
    from (values ('X', '01', 'viewer'), ('Y', '02', 'viewer'), ('PCA', '04', 'project_control_admin')) v(s, n, role);
  insert into ids(key, id) values
    ('X', '00000000-0000-4000-c000-000000131201'), ('Y', '00000000-0000-4000-c000-000000131202'),
    ('PCA', '00000000-0000-4000-c000-000000131204'),
    ('SA', (select id from public.profiles where role = 'system_admin' and active and contact_id is not null
             order by created_at limit 1)),
    ('P', v_project), ('NF', pg_temp.project('ZZ-1312-NF')), ('EXIST', pg_temp.project('ZZ-1312-EXIST'));
  if pg_temp.id('SA') is null then
    raise exception 'No active System Administrator with a contact exists in the local dataset.';
  end if;

  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-1312-' || p.s), pg_temp.person('ZZ 1312 ' || m.s), pg_temp.party('ZZ-1312-' || p.s, 'eprom'), m.role
    from (values ('265'), ('NF'), ('EXIST')) p(s),
         (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-1312-' || p.s), pg_temp.person('ZZ 1312 ' || m.s), m.role
    from (values ('265'), ('NF'), ('EXIST')) p(s),
         (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects
     set project_control_manager_id = pg_temp.person('ZZ 1312 X'), reporting_coordinator_id = pg_temp.person('ZZ 1312 Y')
   where code like 'ZZ-1312-%';

  insert into public.project_planning_settings (project_id, onboarding_mode, default_earning_method)
  values (v_project, 'new_project', 'percent_complete'),
         (pg_temp.project('ZZ-1312-NF'), 'no_formal_schedule', null),
         (pg_temp.project('ZZ-1312-EXIST'), 'existing_active_project', null);
end;
$fix$;

-- The §26.5 Working Plan at the "bl0" stage, entered by the assigned Project Control.
do $seed$
begin
  perform pg_temp.act(pg_temp.id('X'));
  insert into public.planning_work_items (id, project_id, parent_work_item_id, code, name, item_type, level, sort_order,
                                          local_weight_percent, is_control_account, source, active)
  select x.id, pg_temp.id('P'), x.parent_work_item_id, x.code, x.name, x.item_type, x.level, x.sort_order,
         x.local_weight_percent, x.is_control_account, 'manual', true
    from jsonb_to_recordset(pg_temp.fx('work_items')) as x(id uuid, parent_work_item_id uuid, code text, name text,
         item_type text, level int, sort_order int, local_weight_percent numeric, is_control_account boolean)
   where x.parent_work_item_id is null;
  insert into public.planning_work_items (id, project_id, parent_work_item_id, code, name, item_type, level, sort_order,
                                          local_weight_percent, is_control_account, source, active)
  select x.id, pg_temp.id('P'), x.parent_work_item_id, x.code, x.name, x.item_type, x.level, x.sort_order,
         x.local_weight_percent, x.is_control_account, 'manual', true
    from jsonb_to_recordset(pg_temp.fx('work_items')) as x(id uuid, parent_work_item_id uuid, code text, name text,
         item_type text, level int, sort_order int, local_weight_percent numeric, is_control_account boolean)
   where x.parent_work_item_id is not null;
  insert into public.planning_activities (id, project_id, work_item_id, code, name, is_milestone, local_weight_percent,
                                          earning_method, planned_start_date, planned_finish_date, source, active)
  select x.id, pg_temp.id('P'), x.work_item_id, x.code, x.name, x.is_milestone, x.local_weight_percent,
         x.earning_method, x.planned_start_date, x.planned_finish_date, 'manual', true
    from jsonb_to_recordset(pg_temp.fx('activities_bl0')) as x(id uuid, work_item_id uuid, code text, name text,
         is_milestone boolean, local_weight_percent numeric, earning_method text, planned_start_date date, planned_finish_date date);
  perform pg_temp.owner();
end;
$seed$;

/* ===================== 01. Baseline request (server-only) ================== */

do $s01$
begin
  perform pg_temp.chk(1, '01 REQUEST', 'fixture: 6 nodes and 10 activities seeded',
    (select count(*) from public.planning_work_items where project_id = pg_temp.id('P')) = 6
    and (select count(*) from public.planning_activities where project_id = pg_temp.id('P')) = 10);

  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.must_fail(1, '01 REQUEST', 'a client cannot call the request writer (server-only)',
    pg_temp.req(pg_temp.id('X'), pg_temp.id('P'), 'curve_bl0'), '42501');
  perform pg_temp.must_fail(1, '01 REQUEST', 'a client cannot insert a baseline directly',
    format('insert into public.planning_baselines (project_id, name, baseline_date) values (%L, %L, current_date)',
           pg_temp.id('P'), 'forged'), '42501');

  perform pg_temp.svc();
  perform pg_temp.must_fail(1, '01 REQUEST', 'the Reporting Coordinator cannot request a baseline (authority is the user''s)',
    pg_temp.req(pg_temp.id('Y'), pg_temp.id('P'), 'curve_bl0'), 'NOT_AUTHORIZED');
  perform pg_temp.must_fail(1, '01 REQUEST', 'no user named → refused (the service role alone has no authority)',
    format('select public.request_planning_baseline(null, %L::uuid, %L, %L, %L::jsonb, %L)', pg_temp.id('P'), 'r', 'x',
           pg_temp.fx('curve_bl0')::text, '1.0.0'), 'NOT_AUTHORIZED');
  perform pg_temp.must_fail(1, '01 REQUEST', 'a stale Working Plan fingerprint is refused (PT409)',
    pg_temp.req(pg_temp.id('X'), pg_temp.id('P'), 'curve_bl0', 'not-the-current-fingerprint'), 'STALE_WORKING_PLAN');
  perform pg_temp.must_fail(1, '01 REQUEST', 'a reason is required',
    format('select public.request_planning_baseline(%L::uuid, %L::uuid, %L, %L, %L::jsonb, %L)', pg_temp.id('PCA'), pg_temp.id('P'),
           '  ', pg_temp.fp(pg_temp.id('PCA'), pg_temp.id('P')), pg_temp.fx('curve_bl0')::text, '1.0.0'), 'REASON_REQUIRED');
  perform pg_temp.must_fail(1, '01 REQUEST', 'an incomplete curve is refused',
    format('select public.request_planning_baseline(%L::uuid, %L::uuid, %L, %L, %L::jsonb, %L)', pg_temp.id('PCA'), pg_temp.id('P'),
           'r', pg_temp.fp(pg_temp.id('PCA'), pg_temp.id('P')), '[{"date":"2026-09-03","value":40}]', '1.0.0'), 'INVALID_BASELINE');

  -- BL0 requested by the Project Control Admin (to prove B3 below).
  perform pg_temp.must_pass(1, '01 REQUEST', 'Project Control Admin requests BL0 (server action path)',
    pg_temp.req(pg_temp.id('PCA'), pg_temp.id('P'), 'curve_bl0'));
  perform pg_temp.owner();
  insert into ids(key, id) values ('REQ0', pg_temp.pending(pg_temp.id('P')));
  perform pg_temp.chk(1, '01 REQUEST', 'captured at request: 6 nodes, 10 activities, their dates and weights; curve frozen',
    (select jsonb_array_length(capture -> 'nodes') = 6 and jsonb_array_length(capture -> 'activities') = 10
            and requested_by_user_id = pg_temp.id('PCA') and revision_number is null and revision_kind is null
       from public.planning_baselines where id = pg_temp.id('REQ0'))
    and (select count(*) from public.planning_baseline_curve_points where baseline_id = pg_temp.id('REQ0'))
        = jsonb_array_length(pg_temp.fx('curve_bl0'))
    and (select (c ->> 'finish') from public.planning_baselines b, jsonb_array_elements(b.capture -> 'activities') c
          where b.id = pg_temp.id('REQ0') and c ->> 'code' = 'VDU-M10') = '2026-12-01');

  perform pg_temp.svc();
  perform pg_temp.must_fail(1, '01 REQUEST', 'one request awaiting a decision per project',
    pg_temp.req(pg_temp.id('X'), pg_temp.id('P'), 'curve_bl0'), 'BASELINE_REQUEST_PENDING');
  perform pg_temp.chk(1, '01 REQUEST', 'the caller identity applies to the call only (claim restored)',
    coalesce(current_setting('request.jwt.claim.sub', true), '') = '');
  perform pg_temp.owner();
end;
$s01$;

/* ================== 02. B3 / B8 — who decides; BL0 anchor ================== */

do $s02$
begin
  perform pg_temp.act(pg_temp.id('PCA'));
  perform pg_temp.must_fail(2, '02 DECIDE', 'B3/B8: the requester (a Project Control Admin) cannot approve their own BL0',
    pg_temp.decide(pg_temp.id('REQ0'), 'approve', null, true), 'SELF_APPROVAL');
  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.must_fail(2, '02 DECIDE', 'the assigned Project Control does not decide (by assignment alone)',
    pg_temp.decide(pg_temp.id('REQ0'), 'approve', null, true), 'NOT_AUTHORIZED');
  perform pg_temp.act(pg_temp.id('Y'));
  perform pg_temp.must_fail(2, '02 DECIDE', 'the Reporting Coordinator does not decide',
    pg_temp.decide(pg_temp.id('REQ0'), 'approve', null, true), 'NOT_AUTHORIZED');
  perform pg_temp.act(pg_temp.id('SA'));
  perform pg_temp.must_fail(2, '02 DECIDE', 'the first BL0 needs the setup-control confirmation',
    pg_temp.decide(pg_temp.id('REQ0'), 'approve', null, false), 'SETUP_CONTROL_CONFIRMATION_REQUIRED');
  perform pg_temp.must_pass(2, '02 DECIDE', 'another authority (System Administrator) approves BL0 with the confirmation',
    pg_temp.decide(pg_temp.id('REQ0'), 'approve', 'Contract schedule', true));
  perform pg_temp.owner();
  perform pg_temp.chk(2, '02 DECIDE', 'approved as BL0 — revision 0, original, decided by the System Administrator',
    (select revision_status = 'approved' and revision_number = 0 and revision_kind = 'original' and name = 'BL0'
            and decided_by_user_id = pg_temp.id('SA')
       from public.planning_baselines where id = pg_temp.id('REQ0')));
  perform pg_temp.chk(2, '02 DECIDE', 'the approved BL0 is a governance anchor: Project Setup is Controlled since its approval',
    public.project_setup_controlled_since(pg_temp.id('P'))
      = (select decided_at from public.planning_baselines where id = pg_temp.id('REQ0')));
  perform pg_temp.act(pg_temp.id('SA'));
  perform pg_temp.must_fail(2, '02 DECIDE', 'a decided request cannot be decided again',
    pg_temp.decide(pg_temp.id('REQ0'), 'reject', 'again'), 'BASELINE_NOT_PENDING');
  perform pg_temp.owner();
end;
$s02$;

/* ========= 03. Immutability; Superseded by BL0; reject / withdraw; BL1 ===== */

do $s03$
begin
  -- Even the table owner cannot change an approved baseline or its curve.
  perform pg_temp.must_fail(3, '03 BASELINES', 'an approved baseline never changes',
    format('update public.planning_baselines set reason = %L where id = %L', 'rewritten', pg_temp.id('REQ0')), 'BASELINE_IMMUTABLE');
  perform pg_temp.must_fail(3, '03 BASELINES', 'an approved baseline is never deleted',
    format('delete from public.planning_baselines where id = %L', pg_temp.id('REQ0')), 'BASELINE_IMMUTABLE');
  perform pg_temp.must_fail(3, '03 BASELINES', 'a baseline curve point never changes',
    format('update public.planning_baseline_curve_points set value = 1 where baseline_id = %L', pg_temp.id('REQ0')), 'BASELINE_IMMUTABLE');
  perform pg_temp.must_fail(3, '03 BASELINES', 'no curve point is added outside a request',
    format('insert into public.planning_baseline_curve_points (baseline_id, point_date, value) values (%L, %L, 1)',
           pg_temp.id('REQ0'), '2030-01-02'), 'BASELINE_IMMUTABLE');

  -- Superseded by BL0: Planned Start / Finish change for nobody.
  perform pg_temp.act(pg_temp.id('PCA'));
  perform pg_temp.must_fail(3, '03 BASELINES', 'Superseded by BL0: Planned Finish cannot be edited, even by a Project Control Admin',
    format('update public.projects set planned_finish_date = %L where id = %L', '2027-12-31', pg_temp.id('P')), 'SETUP_FIELD_SUPERSEDED');
  perform pg_temp.must_fail(3, '03 BASELINES', 'Superseded by BL0: Planned Start cannot be amended either',
    format('select public.request_project_setup_amendment(%L::uuid, %L, %L::jsonb, %L::jsonb, %L)', pg_temp.id('P'),
           'planned_start_date', '{"planned_start_date":"2026-08-01"}', '{"planned_start_date":"2026-09-01"}', 'r'),
    'SETUP_FIELD_SUPERSEDED');
  perform pg_temp.owner();
  perform pg_temp.chk(3, '03 BASELINES', 'the effective class of Planned Start is now superseded',
    public.project_setup_effective_field_class(pg_temp.id('P'), 'planned_start_date') = 'superseded');

  -- A re-baseline request rejected (comment required), then one withdrawn by its requester.
  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.stage('state_bl1');
  perform pg_temp.svc();
  perform pg_temp.must_pass(3, '03 BASELINES', 'the assigned Project Control requests a re-baseline',
    pg_temp.req(pg_temp.id('X'), pg_temp.id('P'), 'curve_bl1'));
  perform pg_temp.owner();
  insert into ids(key, id) values ('REQ1', pg_temp.pending(pg_temp.id('P')));
  perform pg_temp.act(pg_temp.id('PCA'));
  perform pg_temp.must_fail(3, '03 BASELINES', 'a rejection needs a comment',
    pg_temp.decide(pg_temp.id('REQ1'), 'reject'), 'COMMENT_REQUIRED');
  perform pg_temp.must_pass(3, '03 BASELINES', 'a Project Control Admin rejects it with a comment',
    pg_temp.decide(pg_temp.id('REQ1'), 'reject', 'Wrong period'));
  perform pg_temp.owner();
  perform pg_temp.svc();
  perform pg_temp.must_pass(3, '03 BASELINES', 'requested again', pg_temp.req(pg_temp.id('X'), pg_temp.id('P'), 'curve_bl1'));
  perform pg_temp.owner();
  insert into ids(key, id) values ('REQ2', pg_temp.pending(pg_temp.id('P')));
  perform pg_temp.act(pg_temp.id('PCA'));
  perform pg_temp.must_fail(3, '03 BASELINES', 'only the requester withdraws',
    format('select public.withdraw_planning_baseline(%L::uuid)', pg_temp.id('REQ2')), 'NOT_AUTHORIZED');
  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.must_pass(3, '03 BASELINES', 'the requester withdraws',
    format('select public.withdraw_planning_baseline(%L::uuid)', pg_temp.id('REQ2')));
  perform pg_temp.owner();
  perform pg_temp.chk(3, '03 BASELINES', 'rejected and withdrawn requests are kept, unnumbered',
    (select count(*) from public.planning_baselines where id in (pg_temp.id('REQ1'), pg_temp.id('REQ2'))
        and revision_status in ('rejected', 'withdrawn') and revision_number is null) = 2);

  -- BL1: requested by X, approved by the Project Control Admin (not the requester).
  perform pg_temp.svc();
  perform pg_temp.must_pass(3, '03 BASELINES', 'the re-baseline is requested once more',
    pg_temp.req(pg_temp.id('X'), pg_temp.id('P'), 'curve_bl1'));
  perform pg_temp.owner();
  insert into ids(key, id) values ('REQ3', pg_temp.pending(pg_temp.id('P')));
  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.must_fail(3, '03 BASELINES', 'B3: the preparer cannot approve the re-baseline',
    pg_temp.decide(pg_temp.id('REQ3'), 'approve'), 'SELF_APPROVAL');
  perform pg_temp.act(pg_temp.id('PCA'));
  perform pg_temp.must_pass(3, '03 BASELINES', 'another Project Control Admin approves it (no confirmation needed once Controlled)',
    pg_temp.decide(pg_temp.id('REQ3'), 'approve'));
  perform pg_temp.owner();
  perform pg_temp.chk(3, '03 BASELINES', 'approved as BL1 — a re-baseline; BLn is derived as the latest approved',
    (select revision_number = 1 and revision_kind = 'rebaseline' and name = 'BL1' from public.planning_baselines where id = pg_temp.id('REQ3'))
    and (select id from public.planning_baselines where project_id = pg_temp.id('P') and revision_status = 'approved'
          order by revision_number desc limit 1) = pg_temp.id('REQ3'));
end;
$s03$;

/* ===================== 04. Publish v2 — refusals =========================== */

do $s04$
declare
  v_payload jsonb;
begin
  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.stage('state_current');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'D-D: the legacy (non-engine) publish is retired for a normal publish',
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)',
           pg_temp.id('P'), '2026-10-31'), 'V2_PUBLISH_REQUIRED');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'a client cannot insert a snapshot directly',
    format('insert into public.planning_snapshots (project_id, version, snapshot_data) values (%L, 99, %L::jsonb)',
           pg_temp.id('P'), '{}'), '42501');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'a client cannot call the trusted writer (server-only)',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), pg_temp.fx('payload')), '42501');
  perform pg_temp.owner();

  v_payload := pg_temp.live_payload(pg_temp.id('X'), pg_temp.id('P'));
  perform pg_temp.svc();
  perform pg_temp.must_fail(4, '04 PUBLISH', 'the writer evaluates authority as the user: the Reporting Coordinator is refused',
    pg_temp.pub(pg_temp.id('Y'), pg_temp.id('P'), v_payload), 'Project Control authority');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'a stale Working Plan (fingerprint) is refused',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), jsonb_set(v_payload, '{fingerprint}', '"stale"')), 'STALE_WORKING_PLAN');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'the approved baselines must be the current BL0 / BLn',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), jsonb_set(v_payload, '{bln_baseline_id}', to_jsonb(pg_temp.approved(pg_temp.id('P'), 0)))),
    'BASELINE_CHANGED');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'a Data Date is required',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), v_payload - 'data_date'), 'Data Date is required');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'a tampered engine input (an activity weight) is refused',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'),
      jsonb_set(v_payload, '{activities,0,local_weight}', '99')), 'STALE_WORKING_PLAN');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'a tampered BLn date is refused',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'),
      jsonb_set(v_payload, '{activities,1,bln_finish}', '"2027-01-01"')), 'STALE_WORKING_PLAN');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'an out-of-range figure is refused',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), jsonb_set(v_payload, '{project,pv}', '140')), 'INVALID_SNAPSHOT');
  perform pg_temp.must_fail(4, '04 PUBLISH', 'a calculation without an engine version is refused',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), v_payload - 'engine_version'), 'INVALID_SNAPSHOT');
  perform pg_temp.owner();
  perform pg_temp.chk(4, '04 PUBLISH', 'nothing was published by any refused call',
    not exists (select 1 from public.planning_snapshots where project_id = pg_temp.id('P')));
end;
$s04$;

/* ===================== 05. Publish v2 — §26.5 through the real path ======== */

do $s05$
declare
  v_snapshot uuid;
begin
  perform pg_temp.svc();
  perform pg_temp.must_pass(5, '05 PUBLISH §26.5', 'the assigned Project Control publishes v2 through the trusted writer',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), (select pg_temp.live_payload(pg_temp.id('X'), pg_temp.id('P')))));
  perform pg_temp.owner();
  v_snapshot := pg_temp.id('SNAP');
  insert into ids(key, id) values ('SNAP1', v_snapshot);

  perform pg_temp.chk(5, '05 PUBLISH §26.5', 'project figures frozen exactly: PV 52.04 · EV 49.475 · SV −2.565 · SPI 0.95',
    (select project_pv = 52.04 and project_ev = 49.475 and project_sv = -2.565 and abs(project_spi - 0.9507) < 0.001
            and project_spi_reason is null and coverage_percent = 100
       from public.planning_snapshots where id = v_snapshot));
  perform pg_temp.chk(5, '05 PUBLISH §26.5', 'provenance frozen: engine version, Data Date, BL0, BLn, publisher, Working Plan identity',
    (select engine_version = (pg_temp.fx('engine_version') #>> '{}') and data_date = '2026-10-31'
            and bl0_baseline_id = pg_temp.approved(pg_temp.id('P'), 0) and bln_baseline_id = pg_temp.approved(pg_temp.id('P'), 1)
            and published_by_user_id = pg_temp.id('X') and published_by_contact_id = pg_temp.person('ZZ 1312 X')
            and source_kind = 'manual' and working_plan_fingerprint is not null and edits_high_water_at is not null
            and version = 1 and not is_opening_snapshot
       from public.planning_snapshots where id = v_snapshot));
  perform pg_temp.chk(5, '05 PUBLISH §26.5', 'D-C: schedule condition "not evaluated" (thresholds pending B4); its inputs frozen',
    (select schedule_condition = 'not_evaluated' and bln_finish_date = '2026-12-15' and bl0_finish_date = '2026-12-01'
            and forecast_finish_date = '2026-12-29'
       from public.planning_snapshots where id = v_snapshot)
    and not exists (select 1 from public.planning_snapshot_nodes where snapshot_id = v_snapshot and schedule_condition <> 'not_evaluated'));
  perform pg_temp.chk(5, '05 PUBLISH §26.5', 'frozen WBS roll-up: RBI PV 50.40 / EV 44.75, contribution 5.04; VDU weight 4%',
    (select pv = 50.4 and ev = 44.75 and abs(pv_contribution - 5.04) < 1e-6 and is_control_account and depth = 1
       from public.planning_snapshot_nodes where snapshot_id = v_snapshot and code = 'RBI')
    and (select abs(effective_weight - 4) < 1e-9 and depth = 2 from public.planning_snapshot_nodes
          where snapshot_id = v_snapshot and code = 'VDU')
    and (select count(*) from public.planning_snapshot_nodes where snapshot_id = v_snapshot) = 6);
  perform pg_temp.chk(5, '05 PUBLISH §26.5', 'frozen activities: engine figures, method, BL0 / BLn / forecast / actual dates',
    (select pv = 80 and ev = 60 and earning_method = 'percent_complete' and bln_start_date = '2026-10-08'
            and bln_finish_date = '2026-11-04' and planned_finish_date = '2026-11-12' and actual_start_date = '2026-10-08'
            and percent_complete_physical = 60
       from public.planning_snapshot_activities where snapshot_id = v_snapshot and code = 'VDU-A20')
    and (select count(*) from public.planning_snapshot_activities where snapshot_id = v_snapshot and pv is not null) = 10);
  perform pg_temp.chk(5, '05 PUBLISH §26.5', 'the milestone: +14 days vs BLn, +28 vs BL0, never blended',
    (select slip_vs_bln = 14 and slip_vs_bl0 = 28 and bln_date = '2026-12-15' and bl0_date = '2026-12-01'
            and forecast_date = '2026-12-29' and status = 'upcoming' and not is_key
       from public.planning_snapshot_milestones where snapshot_id = v_snapshot));
  perform pg_temp.chk(5, '05 PUBLISH §26.5', 'forecast curve frozen; it opens at the earned point (EV at the Data Date)',
    (select value = 49.475 from public.planning_snapshot_curve_points
      where snapshot_id = v_snapshot and point_date = '2026-10-31')
    and (select count(*) from public.planning_snapshot_curve_points where snapshot_id = v_snapshot) > 2);
  perform pg_temp.chk(5, '05 PUBLISH §26.5', 'the Working Plan archive the legacy publish keeps is kept too',
    (select jsonb_array_length(snapshot_data -> 'activities') = 10 from public.planning_snapshots where id = v_snapshot));
end;
$s05$;

/* ====== 05B. The publish context (13.12 browser UAT: a stale dialog) ======= */

-- The Publish dialog prepares against the Working Plan fingerprint; the
-- server refuses a submit whose fresh read differs, and hands the writer only
-- the prepared identity. This proves the database half: the fingerprint moves
-- on exactly the saves of the UAT path, and a payload prepared before them is
-- refused by the writer, even when the values are back where they were.
--
-- The whole suite is one transaction, so now() — and so every updated_at — is
-- constant. The fixture rows are back-dated first (triggers off for that one
-- statement) so a later save moves updated_at, as it does across real
-- requests. Everything here runs in a subtransaction that is rolled back, so
-- the later sections see the state §05 left.

do $s05b$
declare
  v_activity uuid := '00000000-0000-4000-d265-000000000004';  -- 60 % complete at the Data Date
  v_fp0 text; v_fp1 text; v_fp2 text; v_fp3 text; v_fp4 text;
  v_prepared jsonb;
  v_stale_error text;
  v_fresh_error text := 'not run';
  v_settings_error text;
  v_values_back boolean;
begin
  begin
    perform pg_temp.owner();
    alter table public.planning_activities disable trigger set_updated_at;
    alter table public.project_planning_settings disable trigger set_updated_at;
    update public.planning_activities set updated_at = now() - interval '1 hour' where project_id = pg_temp.id('P');
    update public.project_planning_settings set updated_at = now() - interval '1 hour' where project_id = pg_temp.id('P');
    alter table public.planning_activities enable trigger set_updated_at;
    alter table public.project_planning_settings enable trigger set_updated_at;

    -- Tab A opens Publish: the context (fingerprint) and the payload it would send.
    v_fp0 := pg_temp.fp(pg_temp.id('X'), pg_temp.id('P'));
    v_prepared := pg_temp.live_payload(pg_temp.id('X'), pg_temp.id('P'));

    -- Tab B saves "Confirmed physical % complete" 60 → 61.
    perform pg_temp.act(pg_temp.id('X'));
    update public.planning_activities set percent_complete_physical = 61 where id = v_activity;
    perform pg_temp.owner();
    v_fp1 := pg_temp.fp(pg_temp.id('X'), pg_temp.id('P'));

    -- …and back to 60: the same values, a later Working Plan.
    perform pg_temp.act(pg_temp.id('X'));
    update public.planning_activities set percent_complete_physical = 60 where id = v_activity;
    perform pg_temp.owner();
    v_fp2 := pg_temp.fp(pg_temp.id('X'), pg_temp.id('P'));
    v_values_back := (select percent_complete_physical = 60 from public.planning_activities where id = v_activity);

    -- Tab A publishes what it prepared: refused by the writer itself.
    perform pg_temp.svc();
    begin
      execute pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), v_prepared);
      v_stale_error := null;
    exception when others then
      v_stale_error := sqlerrm;
    end;
    -- Reopened: prepared against the latest plan, it publishes.
    begin
      execute pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), pg_temp.live_payload(pg_temp.id('X'), pg_temp.id('P')));
      v_fresh_error := null;
    exception when others then
      v_fresh_error := sqlerrm;
    end;
    perform pg_temp.owner();

    -- Planning configuration: a settings save moves the fingerprint too.
    v_fp3 := pg_temp.fp(pg_temp.id('X'), pg_temp.id('P'));
    begin
      update public.project_planning_settings set default_earning_method = default_earning_method
       where project_id = pg_temp.id('P');
      v_settings_error := null;
    exception when others then
      v_settings_error := sqlerrm;
    end;
    v_fp4 := pg_temp.fp(pg_temp.id('X'), pg_temp.id('P'));

    raise exception using errcode = 'ZZ05B', message = 'roll back 05B';
  exception when sqlstate 'ZZ05B' then
    null;
  end;
  perform pg_temp.owner();

  perform pg_temp.chk(5, '05B CONTEXT', 'UAT path: a % complete save after the dialog was prepared moves the fingerprint',
    v_fp0 is not null and v_fp1 is distinct from v_fp0);
  perform pg_temp.chk(5, '05B CONTEXT', 'a later save restoring the same value is still a later Working Plan',
    v_values_back and v_fp2 is distinct from v_fp0);
  perform pg_temp.chk(5, '05B CONTEXT', 'the writer refuses the payload prepared before the save ([STALE_WORKING_PLAN])',
    position('STALE_WORKING_PLAN' in coalesce(v_stale_error, '')) > 0, coalesce(left(v_stale_error, 110), 'ACCEPTED'));
  perform pg_temp.chk(5, '05B CONTEXT', 'reopened against the latest plan, the publish succeeds',
    v_fresh_error is null, coalesce(left(v_fresh_error, 110), ''));
  perform pg_temp.chk(5, '05B CONTEXT', 'a planning configuration save moves the fingerprint',
    v_settings_error is null and v_fp4 is distinct from v_fp3, coalesce(left(v_settings_error, 110), ''));
  perform pg_temp.chk(5, '05B CONTEXT', 'the fingerprint covers the calendar and the approved revisions by value',
    (select prosrc from pg_proc where proname = 'planning_working_plan_fingerprint') ~ 'p\.working_week, p\.weekly_reporting_day'
    and (select prosrc from pg_proc where proname = 'planning_working_plan_fingerprint') ~ 'revision_status = ''approved''');
  perform pg_temp.chk(5, '05B CONTEXT', 'rolled back: §05 state and its single snapshot are untouched for the later sections',
    (select count(*) from public.planning_snapshots where project_id = pg_temp.id('P')) = 1
    and (select percent_complete_physical = 60 from public.planning_activities where id = v_activity));
end;
$s05b$;

/* ============ 06. Immutability of snapshot rows; D-B compatibility ========= */

do $s06$
declare
  v_snapshot uuid := pg_temp.id('SNAP1');
  v_row record;
begin
  perform pg_temp.must_fail(6, '06 IMMUTABLE', 'a frozen project figure never changes (even for the owner)',
    format('update public.planning_snapshots set project_pv = 1 where id = %L', v_snapshot), 'SNAPSHOT_IMMUTABLE');
  perform pg_temp.must_fail(6, '06 IMMUTABLE', 'a frozen activity figure never changes',
    format('update public.planning_snapshot_activities set pv = 1 where snapshot_id = %L', v_snapshot), 'SNAPSHOT_IMMUTABLE');
  perform pg_temp.must_fail(6, '06 IMMUTABLE', 'a frozen node never changes',
    format('update public.planning_snapshot_nodes set pv = 1 where snapshot_id = %L', v_snapshot), 'SNAPSHOT_IMMUTABLE');
  perform pg_temp.must_fail(6, '06 IMMUTABLE', 'a frozen node is never deleted',
    format('delete from public.planning_snapshot_nodes where snapshot_id = %L', v_snapshot), 'SNAPSHOT_IMMUTABLE');
  perform pg_temp.must_fail(6, '06 IMMUTABLE', 'no snapshot row is added outside the trusted writer',
    format('insert into public.planning_snapshot_curve_points (snapshot_id, curve_kind, point_date, value) values (%L, %L, %L, 1)',
           v_snapshot, 'forecast', '2030-01-02'), 'SNAPSHOT_IMMUTABLE');

  perform pg_temp.act(pg_temp.id('X'));
  select * into v_row from public.dashboard_planning_rollups() d where d.project_id = pg_temp.id('P');
  perform pg_temp.chk(6, '06 COMPATIBILITY', 'D-B: the Dashboard roll-up of a v2 snapshot is its frozen engine figures',
    v_row.calculation = 'engine' and v_row.planned_progress = 52.04 and v_row.actual_progress = 49.475
    and v_row.variance = -2.565 and abs(v_row.spi - 0.9507) < 0.001 and v_row.coverage_percent = 100
    and v_row.planned_value is null and v_row.engine_version is not null,
    format('%s / %s / %s', v_row.calculation, v_row.planned_progress, v_row.actual_progress));
  perform pg_temp.chk(6, '06 COMPATIBILITY', 'the frozen rows are readable as the project''s Project Control',
    (select count(*) from public.planning_snapshot_nodes where snapshot_id = v_snapshot) = 6
    and (select count(*) from public.planning_snapshot_milestones where snapshot_id = v_snapshot) = 1);
  perform pg_temp.owner();
end;
$s06$;


/* ======= 07. Re-baseline never changes a snapshot; new scope needs one ===== */

do $s07$
declare
  v_hash text := pg_temp.snapshot_hash(pg_temp.id('SNAP1'));
  v_payload jsonb;
  v_fp text;
begin
  -- Completed work keeps its dates, so the whole plan can be baselined again.
  perform pg_temp.act(pg_temp.id('X'));
  update public.planning_activities
     set planned_start_date = coalesce(planned_start_date, actual_start_date, '2026-09-01'),
         planned_finish_date = coalesce(planned_finish_date, actual_finish_date, '2026-09-30')
   where project_id = pg_temp.id('P') and not is_milestone and (planned_start_date is null or planned_finish_date is null);
  perform pg_temp.svc();
  perform pg_temp.must_pass(7, '07 RE-BASELINE', 'BL2 requested after the publish',
    pg_temp.req(pg_temp.id('X'), pg_temp.id('P'), 'curve_bl1'));
  perform pg_temp.owner();
  insert into ids(key, id) values ('REQ4', pg_temp.pending(pg_temp.id('P')));
  v_fp := pg_temp.fp(pg_temp.id('X'), pg_temp.id('P'));
  perform pg_temp.act(pg_temp.id('SA'));
  perform pg_temp.must_pass(7, '07 RE-BASELINE', 'BL2 approved by another authority', pg_temp.decide(pg_temp.id('REQ4'), 'approve'));
  perform pg_temp.owner();
  perform pg_temp.chk(7, '07 RE-BASELINE', 'a baseline approved after a Publish dialog was prepared moves its fingerprint (13.12 UAT)',
    pg_temp.fp(pg_temp.id('X'), pg_temp.id('P')) is distinct from v_fp);
  perform pg_temp.chk(7, '07 RE-BASELINE', 'the re-baseline never changes the published snapshot (content hash, BLn reference)',
    pg_temp.snapshot_hash(pg_temp.id('SNAP1')) = v_hash
    and (select bln_baseline_id from public.planning_snapshots where id = pg_temp.id('SNAP1')) = pg_temp.id('REQ3')
    and pg_temp.approved(pg_temp.id('P'), 2) = pg_temp.id('REQ4'));

  -- New scope after BLn: refused until an approved re-baseline captures it.
  perform pg_temp.act(pg_temp.id('X'));
  insert into public.planning_activities (project_id, work_item_id, code, name, is_milestone, local_weight_percent,
                                          earning_method, planned_start_date, planned_finish_date, source, active)
  select pg_temp.id('P'), w.id, 'VDU-A40', 'New scope', false, 0, 'percent_complete', '2026-11-01', '2026-11-20', 'manual', true
    from public.planning_work_items w where w.project_id = pg_temp.id('P') and w.code = 'VDU';
  perform pg_temp.owner();
  v_payload := pg_temp.live_payload(pg_temp.id('X'), pg_temp.id('P'));
  perform pg_temp.svc();
  perform pg_temp.must_fail(7, '07 RE-BASELINE', 'new scope reaches PV only through an approved re-baseline (never an artificial 0)',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), v_payload), 'NEW_SCOPE_NOT_BASELINED');
  perform pg_temp.owner();
end;
$s07$;

/* ============================ 08. Imports ================================== */

do $s08$
declare
  v_before integer := (select count(*) from public.planning_baselines where project_id = pg_temp.id('P'));
  v_writers text[];
begin
  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.must_pass(8, '08 IMPORT', 'an import batch is recorded (validated, Data Date 30 Oct)',
    format('with b as (insert into public.planning_import_batches (project_id, source_type, status, row_count, data_date) values (%2$L, %3$L, %4$L, 0, %5$L) returning id) insert into ids(key, id) select %1$L, id from b',
           'BATCH', pg_temp.id('P'), 'eprp_excel', 'validated', '2026-10-30'));
  perform pg_temp.owner();
  perform pg_temp.chk(8, '08 IMPORT', 'an import never creates or changes a baseline',
    (select count(*) from public.planning_baselines where project_id = pg_temp.id('P')) = v_before);
  select array_agg(p.proname::text order by p.proname) into v_writers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.prosrc ~* 'insert\s+into\s+public\.planning_baselines\M' or p.prosrc ~* 'update\s+public\.planning_baselines\M');
  perform pg_temp.chk(8, '08 IMPORT', 'only the request / decide / withdraw functions write a baseline',
    v_writers = array['decide_planning_baseline', 'request_planning_baseline', 'withdraw_planning_baseline'],
    array_to_string(v_writers, ', '));
  perform pg_temp.svc();
  perform pg_temp.must_fail(8, '08 IMPORT', 'a source batch must carry the snapshot''s own Data Date',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'),
      jsonb_set(pg_temp.live_payload(pg_temp.id('X'), pg_temp.id('P')), '{source_import_batch_id}', to_jsonb(pg_temp.id('BATCH')))),
    'INVALID_SOURCE');
  perform pg_temp.owner();
end;
$s08$;

/* ===================== 09. No formal schedule · archived =================== */

do $s09$
begin
  perform pg_temp.svc();
  perform pg_temp.must_fail(9, '09 NO FORMAL', 'no baseline for a no-formal-schedule project',
    pg_temp.req(pg_temp.id('X'), pg_temp.id('NF'), 'curve_bl0'), 'NOT_PLANNING_GOVERNED');
  perform pg_temp.must_fail(9, '09 NO FORMAL', 'no v2 publish for a no-formal-schedule project',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('NF'), pg_temp.fx('payload')), 'NO_FORMAL_SCHEDULE');

  -- A request pending when the project is archived stays frozen.
  perform pg_temp.must_pass(9, '09 ARCHIVED', 'a re-baseline including the new scope is requested',
    pg_temp.req(pg_temp.id('X'), pg_temp.id('P'), 'curve_bl1'));
  perform pg_temp.owner();
  insert into ids(key, id) values ('REQ5', pg_temp.pending(pg_temp.id('P')));
  update public.projects set status = 'archived', active = false, archived_at = now() where id = pg_temp.id('P');

  perform pg_temp.svc();
  perform pg_temp.must_fail(9, '09 ARCHIVED', 'archived: no baseline request',
    pg_temp.req(pg_temp.id('X'), pg_temp.id('P'), 'curve_bl1'), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(9, '09 ARCHIVED', 'archived: no publish',
    pg_temp.pub(pg_temp.id('X'), pg_temp.id('P'), pg_temp.live_payload(pg_temp.id('X'), pg_temp.id('P'))), 'PROJECT_ARCHIVED');
  perform pg_temp.act(pg_temp.id('SA'));
  perform pg_temp.must_fail(9, '09 ARCHIVED', 'archived: no decision, for any role',
    pg_temp.decide(pg_temp.id('REQ5'), 'approve'), 'PROJECT_ARCHIVED');
  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.must_fail(9, '09 ARCHIVED', 'archived: no withdrawal',
    format('select public.withdraw_planning_baseline(%L::uuid)', pg_temp.id('REQ5')), 'PROJECT_ARCHIVED');
  perform pg_temp.chk(9, '09 ARCHIVED', 'archived: history stays readable (snapshot, roll-up, baselines)',
    (select count(*) from public.planning_snapshot_nodes where snapshot_id = pg_temp.id('SNAP1')) = 6
    and (select count(*) from public.planning_baselines where project_id = pg_temp.id('P') and revision_status = 'approved') = 3);
  perform pg_temp.owner();
  perform pg_temp.chk(9, '09 ARCHIVED', 'the pending request was not altered by the archive',
    (select revision_status from public.planning_baselines where id = pg_temp.id('REQ5')) = 'requested');
end;
$s09$;

/* ================== 10. Legacy snapshots · Opening Position ================ */

do $s10$
begin
  perform pg_temp.chk(10, '10 LEGACY', 'every snapshot, snapshot activity and baseline that existed before is unchanged',
    not exists (
      select 1 from legacy_before lb
       where lb.h is distinct from case lb.t
         when 'S' then (select md5(to_jsonb(s)::text) from public.planning_snapshots s where s.id = lb.id)
         when 'A' then (select md5(to_jsonb(a)::text) from public.planning_snapshot_activities a where a.id = lb.id)
         else (select md5(to_jsonb(b)::text) from public.planning_baselines b where b.id = lb.id) end));
  -- Pre-13.12 = created before the 13.12 migrations (2026-10-24); rows made since
  -- by real 13.12 use (a UAT baseline request, a v2 snapshot) are not legacy.
  perform pg_temp.chk(10, '10 LEGACY', 'pre-13.12 snapshots read as legacy (no engine version); pre-13.12 baselines as legacy captures',
    not exists (select 1 from legacy_before lb join public.planning_snapshots s on s.id = lb.id
                 where s.engine_version is not null and s.published_at < '2026-10-24')
    and not exists (select 1 from legacy_before lb join public.planning_baselines b on b.id = lb.id
                     where b.revision_status <> 'legacy' and b.created_at < '2026-10-24'));

  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.must_pass(10, '10 OPENING', 'an Opening Position is declared as before',
    format('with o as (insert into public.planning_opening_positions (project_id, data_date, planned_progress_percent, actual_progress_percent, source) values (%2$L, %3$L, 40, 35, %4$L) returning id) insert into ids(key, id) select %1$L, id from o',
           'OP', pg_temp.id('EXIST'), '2026-10-15', 'ZZ declared position'));
  perform pg_temp.must_pass(10, '10 OPENING', 'and promoted as Snapshot V1 through the unchanged path (with the first-anchor confirmation)',
    format('insert into ids(key, id) values (%L, public.publish_planning_snapshot(p_project_id => %L::uuid, p_opening_position_id => %L::uuid, p_confirm_setup_control => true))',
           'OPSNAP', pg_temp.id('EXIST'), pg_temp.id('OP')));
  perform pg_temp.owner();
  perform pg_temp.chk(10, '10 OPENING', 'the Opening Position snapshot is declared — no engine version, no baselines',
    (select is_opening_snapshot and version = 1 and engine_version is null and bl0_baseline_id is null
            and source_opening_position_id = pg_temp.id('OP')
       from public.planning_snapshots where id = pg_temp.id('OPSNAP')));
  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.must_fail(10, '10 OPENING', 'after it, a normal publish is v2 only',
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date)', pg_temp.id('EXIST'), '2026-10-31'),
    'V2_PUBLISH_REQUIRED');
  perform pg_temp.owner();
end;
$s10$;

/* ============================== 11. Catalog ================================ */

do $s11$
begin
  perform pg_temp.chk(11, '11 CATALOG', 'the trusted writers are executable by the service role only',
    not has_function_privilege('authenticated', 'public.publish_planning_snapshot_v2(uuid, uuid, jsonb, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.publish_planning_snapshot_v2(uuid, uuid, jsonb, boolean)', 'execute')
    and has_function_privilege('service_role', 'public.publish_planning_snapshot_v2(uuid, uuid, jsonb, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.request_planning_baseline(uuid, uuid, text, text, jsonb, text)', 'execute')
    and has_function_privilege('service_role', 'public.request_planning_baseline(uuid, uuid, text, text, jsonb, text)', 'execute'));
  perform pg_temp.chk(11, '11 CATALOG', 'decide / withdraw / the read bundle are ordinary authenticated calls',
    has_function_privilege('authenticated', 'public.decide_planning_baseline(uuid, text, text, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.withdraw_planning_baseline(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.planning_publish_inputs(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.planning_publish_inputs(uuid)', 'execute'));
  perform pg_temp.chk(11, '11 CATALOG', 'no client write policy on any snapshot or baseline table; RLS on every new table',
    not exists (select 1 from pg_policies
                 where tablename in ('planning_snapshots', 'planning_snapshot_activities', 'planning_snapshot_nodes',
                                     'planning_snapshot_milestones', 'planning_snapshot_curve_points',
                                     'planning_baselines', 'planning_baseline_curve_points')
                   and cmd <> 'SELECT')
    and (select bool_and(relrowsecurity) from pg_class
          where oid in ('public.planning_snapshot_nodes'::regclass, 'public.planning_snapshot_milestones'::regclass,
                        'public.planning_snapshot_curve_points'::regclass, 'public.planning_baseline_curve_points'::regclass)));
  perform pg_temp.chk(11, '11 CATALOG', 'the governance anchor includes the approved BL0',
    (select prosrc from pg_proc where proname = 'project_setup_controlled_since') ~ 'revision_number = 0');
end;
$s11$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;
