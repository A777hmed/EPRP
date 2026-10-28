-- Phase 13.12 (browser UAT) — Baseline Revision notifications — RUNTIME
-- verification. LOCAL DATABASE ONLY.
--
-- Proves 20261025090200_baseline_notifications.sql against real PostgreSQL,
-- real RLS and real roles, on the existing user_notifications rows. Everything
-- runs in ONE transaction that is ROLLED BACK. Nothing persists.
--
--   01  a BL0 request notifies every active approver, never the requester
--   02  a re-baseline request (BLn) too; requested by an approver, they are excluded
--   03  one row per approver: reconcile and duplicates add nothing
--   04  visibility: approvers see it; the requester and non-approvers do not
--   05  approval → the requester is told; the approvers' rows stop being actionable
--   06  rejection → the requester is told
--   07  withdrawal → no notification; no stale actionable row; Clear history clears it
--   08  archived project: a pending request leaves approvers' inboxes
--   09  catalog: client write paths, trigger function, source shape
--
-- HOW TO RUN (after the migration is applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/134_runtime_13_12_baseline_notifications.sql

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception 'REFUSING TO RUN: this connection is not local (server address %).', host(inet_server_addr());
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
create temp table ids(key text primary key, id uuid) on commit drop;
grant select, insert, update on ids to authenticated, anon, service_role;

create or replace function pg_temp.chk(p_seq int, p_area text, p_item text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into r values (p_seq, p_area, p_item,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end || case when p_detail = '' then '' else ' — ' || p_detail end);
end $$;
create or replace function pg_temp.must_pass(p_seq int, p_area text, p_item text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, true);
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, false, '[' || sqlstate || '] ' || left(sqlerrm, 120));
end $$;
create or replace function pg_temp.must_fail(p_seq int, p_area text, p_item text, p_sql text, p_expect text default null)
returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was ACCEPTED');
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, p_expect is null or position(p_expect in sqlerrm) > 0 or sqlstate = p_expect,
    'refused [' || sqlstate || ']: ' || left(sqlerrm, 100));
end $$;
create or replace function pg_temp.act(p_profile uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
end $$;
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
create or replace function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where key = p_key $$;
create or replace function pg_temp.person(p_name text) returns uuid language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_project uuid, p_kind text) returns uuid language sql as $$
  select id from public.project_parties where project_id = p_project and kind = p_kind limit 1 $$;
create or replace function pg_temp.fp(p_actor uuid, p_project uuid) returns text language plpgsql as $$
declare v text; v_role text := current_setting('role'); v_claims text := current_setting('request.jwt.claims', true);
begin
  perform pg_temp.act(p_actor);
  v := public.planning_working_plan_fingerprint(p_project);
  perform set_config('role', v_role, true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v;
end $$;
-- A baseline request through the server-only writer, as p_actor.
create or replace function pg_temp.req(p_actor uuid, p_project uuid) returns text language sql as $$
  select format('select public.request_planning_baseline(%L::uuid, %L::uuid, %L, %L, %L::jsonb, %L)',
    p_actor, p_project, 'ZZ 13.12 notification test', pg_temp.fp(p_actor, p_project),
    '[{"date":"2026-08-27","value":0},{"date":"2026-09-03","value":40},{"date":"2026-10-01","value":100}]', '1.0.0')
$$;
create or replace function pg_temp.pending(p_project uuid) returns uuid language sql as $$
  select id from public.planning_baselines where project_id = p_project and revision_status = 'requested' $$;
-- Approvers today: every active System Administrator / Project Control Admin.
create or replace function pg_temp.approvers() returns setof uuid language sql as $$
  select id from public.profiles where active and role in ('system_admin', 'project_control_admin') $$;
create or replace function pg_temp.rows_for(p_baseline uuid, p_event text) returns setof uuid language sql as $$
  select recipient_id from public.user_notifications where baseline_id = p_baseline and event_type = p_event $$;
-- What a recipient sees through RLS.
create or replace function pg_temp.sees(p_profile uuid, p_baseline uuid, p_event text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.act(p_profile);
  select count(*) into v from public.user_notifications where baseline_id = p_baseline and event_type = p_event;
  perform pg_temp.owner();
  return v;
end $$;

/* ================================ fixtures ================================ */

do $fix$
declare
  v_template uuid := (select id from public.projects order by created_at limit 1);
begin
  if to_regclass('public.user_notifications') is null
     or not exists (select 1 from information_schema.columns where table_name = 'user_notifications' and column_name = 'baseline_id') then
    raise exception 'apply 20261025090200_baseline_notifications.sql first.';
  end if;
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-1312N-' || v.s, 'ZZ 13.12 notifications ' || v.s, p.client_id, '2026-08-01', '2027-06-30', 'active', 'psm'
    from public.projects p, (values ('A'), ('B')) v(s) where p.id = v_template;
  insert into ids values ('PA', (select id from public.projects where code = 'ZZ-1312N-A')),
                         ('PB', (select id from public.projects where code = 'ZZ-1312N-B'));

  insert into public.contacts (name, email, active)
  select 'ZZ 1312N ' || s, 'zz.1312n.' || lower(s) || '@example.invalid', true from (values ('X'), ('PCA'), ('PCA2')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-c000-00000013120' || v.n)::uuid, 'authenticated', 'authenticated',
         'zz.1312n.' || lower(v.s) || '@example.invalid', 'NOT-A-VALID-HASH', now(), '{}', '{}', now(), now()
    from (values ('X', '5'), ('PCA', '6'), ('PCA2', '7')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-c000-00000013120' || v.n)::uuid, 'zz.1312n.' || lower(v.s) || '@example.invalid', 'ZZ 1312N ' || v.s,
         v.role, pg_temp.person('ZZ 1312N ' || v.s), true
    from (values ('X', '5', 'viewer'), ('PCA', '6', 'project_control_admin'),
                 ('PCA2', '7', 'project_control_admin')) v(s, n, role);
  insert into ids values ('X', '00000000-0000-4000-c000-000000131205'), ('PCA', '00000000-0000-4000-c000-000000131206'),
                         ('PCA2', '00000000-0000-4000-c000-000000131207'),
                         -- At most two active System Administrators exist (platform rule): use one of them.
                         ('SA', (select id from public.profiles where role = 'system_admin' and active order by created_at limit 1));

  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select p.id, pg_temp.person('ZZ 1312N X'), pg_temp.party(p.id, 'eprom'), 'Project Controls'
    from public.projects p where p.code like 'ZZ-1312N-%';
  insert into public.project_contacts (project_id, contact_id, role)
  select p.id, pg_temp.person('ZZ 1312N X'), 'project_control_manager' from public.projects p where p.code like 'ZZ-1312N-%';
  update public.projects set project_control_manager_id = pg_temp.person('ZZ 1312N X') where code like 'ZZ-1312N-%';
  insert into public.project_planning_settings (project_id, onboarding_mode)
  select id, 'new_project' from public.projects where code like 'ZZ-1312N-%';

  -- One node and one dated activity per project: enough to request a baseline.
  perform pg_temp.act(pg_temp.id('X'));
  insert into public.planning_work_items (project_id, code, name, local_weight_percent)
  select id, 'N1', 'Node', 100 from public.projects where code like 'ZZ-1312N-%';
  insert into public.planning_activities (project_id, work_item_id, code, name, local_weight_percent, earning_method,
                                          planned_start_date, planned_finish_date, source)
  select w.project_id, w.id, 'A1', 'Activity', 100, 'percent_complete', '2026-09-01', '2026-09-30', 'manual'
    from public.planning_work_items w join public.projects p on p.id = w.project_id where p.code like 'ZZ-1312N-%';
  perform pg_temp.owner();
end;
$fix$;

/* ============== 01. BL0 request → every approver, never the requester ===== */

do $s01$
declare v_bl uuid;
begin
  perform pg_temp.svc();
  perform pg_temp.must_pass(1, '01 BL0 REQUEST', 'the assigned Project Control requests BL0', pg_temp.req(pg_temp.id('X'), pg_temp.id('PA')));
  perform pg_temp.owner();
  v_bl := pg_temp.pending(pg_temp.id('PA'));
  insert into ids values ('BL0', v_bl);
  perform pg_temp.chk(1, '01 BL0 REQUEST', 'every active System Administrator and Project Control Admin is notified, exactly once',
    (select array_agg(x order by x) from pg_temp.rows_for(v_bl, 'baseline_requested') x)
      = (select array_agg(x order by x) from pg_temp.approvers() x),
    format('%s rows / %s approvers', (select count(*) from pg_temp.rows_for(v_bl, 'baseline_requested')), (select count(*) from pg_temp.approvers())));
  perform pg_temp.chk(1, '01 BL0 REQUEST', 'the requester gets nothing; the row names the project, the request and the requester',
    not exists (select 1 from pg_temp.rows_for(v_bl, 'baseline_requested') x where x = pg_temp.id('X'))
    and (select bool_and(project_id = pg_temp.id('PA') and source_id is null and actor_name = 'ZZ 1312N X' and read_at is null)
           from public.user_notifications where baseline_id = v_bl));
end;
$s01$;

/* ======= 02. BLn request; an approver who requests is excluded ============ */

do $s02$
declare v_bl uuid;
begin
  -- Approve BL0 so the next request is a re-baseline.
  perform pg_temp.act(pg_temp.id('PCA'));
  perform pg_temp.must_pass(2, '02 BLn REQUEST', 'BL0 approved by a Project Control Admin',
    format('select public.decide_planning_baseline(%L::uuid, %L, null, true)', pg_temp.id('BL0'), 'approve'));
  perform pg_temp.owner();
  perform pg_temp.svc();
  perform pg_temp.must_pass(2, '02 BLn REQUEST', 'a Project Control Admin requests a re-baseline', pg_temp.req(pg_temp.id('PCA'), pg_temp.id('PA')));
  perform pg_temp.owner();
  v_bl := pg_temp.pending(pg_temp.id('PA'));
  insert into ids values ('BL1REQ', v_bl);
  perform pg_temp.chk(2, '02 BLn REQUEST', 'every approver EXCEPT the requesting Project Control Admin is notified (B3)',
    (select array_agg(x order by x) from pg_temp.rows_for(v_bl, 'baseline_requested') x)
      = (select array_agg(x order by x) from pg_temp.approvers() x where x <> pg_temp.id('PCA')));
end;
$s02$;

/* ============================ 03. no duplicates =========================== */

do $s03$
declare v_before integer := (select count(*) from public.user_notifications where baseline_id = pg_temp.id('BL1REQ'));
begin
  perform pg_temp.act(pg_temp.id('PCA2'));
  perform pg_temp.must_pass(3, '03 DUPLICATES', 'reconcile as an approver who already has the row', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.act(pg_temp.id('PCA'));
  perform pg_temp.must_pass(3, '03 DUPLICATES', 'reconcile as the requester', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.owner();
  perform pg_temp.chk(3, '03 DUPLICATES', 'no new row, and never one for the requester',
    (select count(*) from public.user_notifications where baseline_id = pg_temp.id('BL1REQ')) = v_before
    and not exists (select 1 from pg_temp.rows_for(pg_temp.id('BL1REQ'), 'baseline_requested') x where x = pg_temp.id('PCA')));
  perform pg_temp.chk(3, '03 DUPLICATES', 'one row per recipient and event (unique index)',
    not exists (select 1 from public.user_notifications where baseline_id is not null
                 group by recipient_id, event_type, baseline_id having count(*) > 1));
  -- An approver whose row is missing gets it back from reconcile.
  delete from public.user_notifications where baseline_id = pg_temp.id('BL1REQ') and recipient_id = pg_temp.id('PCA2');
  perform pg_temp.act(pg_temp.id('PCA2'));
  perform pg_temp.must_pass(3, '03 DUPLICATES', 'reconcile restores a missing approver row', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.owner();
  perform pg_temp.chk(3, '03 DUPLICATES', 'restored exactly once',
    (select count(*) from pg_temp.rows_for(pg_temp.id('BL1REQ'), 'baseline_requested') x where x = pg_temp.id('PCA2')) = 1);
end;
$s03$;

/* ============================== 04. visibility ============================= */

do $s04$
begin
  perform pg_temp.chk(4, '04 VISIBILITY', 'an approver sees the actionable request (it requires action)',
    pg_temp.sees(pg_temp.id('PCA2'), pg_temp.id('BL1REQ'), 'baseline_requested') = 1
    and public.notification_requires_action('baseline_requested', pg_temp.id('BL1REQ')));
  perform pg_temp.chk(4, '04 VISIBILITY', 'the requester and a non-approver see nothing',
    pg_temp.sees(pg_temp.id('PCA'), pg_temp.id('BL1REQ'), 'baseline_requested') = 0
    and pg_temp.sees(pg_temp.id('X'), pg_temp.id('BL1REQ'), 'baseline_requested') = 0);
end;
$s04$;

/* ================= 05. approval → requester; no stale action =============== */

do $s05$
begin
  perform pg_temp.chk(5, '05 APPROVED', 'BL0 approval told its requester (assigned Project Control)',
    (select array_agg(x) from pg_temp.rows_for(pg_temp.id('BL0'), 'baseline_approved') x) = array[pg_temp.id('X')]
    and (select actor_name from public.user_notifications where baseline_id = pg_temp.id('BL0') and event_type = 'baseline_approved') = 'ZZ 1312N PCA');
  perform pg_temp.chk(5, '05 APPROVED', 'the requester sees the outcome',
    pg_temp.sees(pg_temp.id('X'), pg_temp.id('BL0'), 'baseline_approved') = 1);
  perform pg_temp.chk(5, '05 APPROVED', 'the approvers'' BL0 request rows are no longer visible or actionable',
    pg_temp.sees(pg_temp.id('PCA2'), pg_temp.id('BL0'), 'baseline_requested') = 0
    and pg_temp.sees(pg_temp.id('SA'), pg_temp.id('BL0'), 'baseline_requested') = 0
    and not public.notification_requires_action('baseline_requested', pg_temp.id('BL0')));
end;
$s05$;

/* =========================== 06. rejection → requester ===================== */

do $s06$
begin
  perform pg_temp.act(pg_temp.id('SA'));
  perform pg_temp.must_pass(6, '06 REJECTED', 'a System Administrator rejects the re-baseline',
    format('select public.decide_planning_baseline(%L::uuid, %L, %L)', pg_temp.id('BL1REQ'), 'reject', 'Not yet'));
  perform pg_temp.owner();
  perform pg_temp.chk(6, '06 REJECTED', 'the requester (a Project Control Admin) is told, by name of the decider',
    (select array_agg(x) from pg_temp.rows_for(pg_temp.id('BL1REQ'), 'baseline_rejected') x) = array[pg_temp.id('PCA')]
    and (select actor_name from public.user_notifications where baseline_id = pg_temp.id('BL1REQ') and event_type = 'baseline_rejected') = (select full_name from public.profiles where id = pg_temp.id('SA'))
    and pg_temp.sees(pg_temp.id('PCA'), pg_temp.id('BL1REQ'), 'baseline_rejected') = 1);
  perform pg_temp.chk(6, '06 REJECTED', 'no approver keeps an actionable row',
    pg_temp.sees(pg_temp.id('PCA2'), pg_temp.id('BL1REQ'), 'baseline_requested') = 0);
end;
$s06$;

/* ============== 07. withdrawal: nothing sent, nothing left actionable ====== */

do $s07$
declare
  v_bl uuid;
  v_rows integer;
  v_cleared integer;
begin
  perform pg_temp.svc();
  perform pg_temp.must_pass(7, '07 WITHDRAWN', 'a new re-baseline is requested', pg_temp.req(pg_temp.id('X'), pg_temp.id('PA')));
  perform pg_temp.owner();
  v_bl := pg_temp.pending(pg_temp.id('PA'));
  v_rows := (select count(*) from public.user_notifications where baseline_id = v_bl);
  perform pg_temp.act(pg_temp.id('X'));
  perform pg_temp.must_pass(7, '07 WITHDRAWN', 'the requester withdraws it', format('select public.withdraw_planning_baseline(%L::uuid)', v_bl));
  perform pg_temp.owner();
  perform pg_temp.chk(7, '07 WITHDRAWN', 'no notification is sent for a withdrawal',
    (select count(*) from public.user_notifications where baseline_id = v_bl) = v_rows);
  perform pg_temp.chk(7, '07 WITHDRAWN', 'no approver is left with a dead approval action',
    pg_temp.sees(pg_temp.id('PCA2'), v_bl, 'baseline_requested') = 0
    and pg_temp.sees(pg_temp.id('SA'), v_bl, 'baseline_requested') = 0
    and not public.notification_requires_action('baseline_requested', v_bl));
  perform pg_temp.act(pg_temp.id('PCA2'));
  select public.clear_my_notification_history() into v_cleared;
  perform pg_temp.owner();
  perform pg_temp.chk(7, '07 WITHDRAWN', 'Clear history clears the resolved baseline rows (kept as delivery records)',
    v_cleared >= 1
    and (select cleared_at is not null from public.user_notifications where baseline_id = v_bl and recipient_id = pg_temp.id('PCA2')));
end;
$s07$;

/* ======================= 08. archived project: frozen ====================== */

do $s08$
declare v_bl uuid;
begin
  perform pg_temp.svc();
  perform pg_temp.must_pass(8, '08 ARCHIVED', 'BL0 requested on a second project', pg_temp.req(pg_temp.id('X'), pg_temp.id('PB')));
  perform pg_temp.owner();
  v_bl := pg_temp.pending(pg_temp.id('PB'));
  perform pg_temp.chk(8, '08 ARCHIVED', 'visible to an approver while the project is active',
    pg_temp.sees(pg_temp.id('PCA2'), v_bl, 'baseline_requested') = 1);
  update public.projects set status = 'archived', active = false, archived_at = now() where id = pg_temp.id('PB');
  perform pg_temp.chk(8, '08 ARCHIVED', 'archived: the pending request leaves approvers'' inboxes (not decidable)',
    pg_temp.sees(pg_temp.id('PCA2'), v_bl, 'baseline_requested') = 0
    and (select revision_status from public.planning_baselines where id = v_bl) = 'requested');
end;
$s08$;

/* ================================ 09. catalog ============================== */

do $s09$
begin
  perform pg_temp.act(pg_temp.id('PCA2'));
  perform pg_temp.must_fail(9, '09 CATALOG', 'a client cannot insert a notification',
    format('insert into public.user_notifications (recipient_id, event_type, project_id, baseline_id) values (%L, %L, %L, %L)',
           pg_temp.id('PCA2'), 'baseline_requested', pg_temp.id('PA'), pg_temp.id('BL0')), '42501');
  perform pg_temp.must_fail(9, '09 CATALOG', 'a client cannot re-point a notification',
    format('update public.user_notifications set baseline_id = %L where recipient_id = %L', pg_temp.id('BL0'), pg_temp.id('PCA2')), '42501');
  perform pg_temp.owner();
  perform pg_temp.chk(9, '09 CATALOG', 'the trigger function is not callable by any client role',
    not has_function_privilege('authenticated', 'public.notify_planning_baseline_event()', 'execute')
    and not has_function_privilege('service_role', 'public.notify_planning_baseline_event()', 'execute'));
  perform pg_temp.must_fail(9, '09 CATALOG', 'a baseline event must point at a baseline (source shape)',
    format('insert into public.user_notifications (recipient_id, event_type, project_id, source_id) values (%L, %L, %L, null)',
           pg_temp.id('PCA2'), 'baseline_approved', pg_temp.id('PA')), 'user_notifications_source_shape');
  perform pg_temp.chk(9, '09 CATALOG', 'the amendment notification trigger and its rows are unchanged',
    (select count(*) from pg_trigger where tgname = 'notify_setup_amendment_event') = 1
    and not exists (select 1 from public.user_notifications where event_type like 'amendment\_%' and (source_id is null or baseline_id is not null)));
end;
$s09$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;
