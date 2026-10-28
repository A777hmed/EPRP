-- Phase 13.9B (UAT) — "Clear history" for the notification inbox — RUNTIME
-- verification. LOCAL DATABASE ONLY.
--
-- Proves 20261021090000_notification_history_clear.sql through the REAL
-- request / decide functions on real RLS. One transaction, ROLLED BACK.
--
--   01  setup: one request stays pending, one is approved, one is rejected
--   02  requester clears: resolved outcomes leave the inbox and unread count;
--       rows are kept (hidden, not deleted); other users' rows, amendments and
--       relation history are byte-for-byte unchanged; repeat is a no-op
--   03  approver clears: the pending "Approval required" stays visible and
--       unread; only resolved rows are hidden; others unchanged
--   04  a pending request on an archived project is not cleared (it still
--       requires action and returns if the project is restored)
--   05  client rights: no direct write of cleared_at, no delete; anon / no
--       session cannot clear
--   06  new notifications after a clear arrive normally
--
-- HOW TO RUN (after the migration is applied; from eprp/; the APP database):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/129_runtime_13_9b_notification_clear.sql

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
grant all on r to authenticated, anon;
do $g$
begin
  if (select count(*) from pg_class where relname = 'r' and relpersistence = 't') <> 1 then
    raise exception 'not inside the expected transaction';
  end if;
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end $g$;

create temp table ids(key text primary key, id uuid, note text) on commit drop;
grant all on ids to authenticated, anon;

create or replace function pg_temp.chk(
  p_seq int, p_area text, p_item text, p_ok boolean, p_detail text default ''
) returns void language plpgsql as $$
begin
  insert into r values (p_seq, p_area, p_item,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end ||
    case when coalesce(p_detail, '') = '' then '' else ' — ' || p_detail end);
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
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 13.12 (docs/02 §26.25 D-D): a normal publish is v2 only — the Planning Engine
-- on the server and its trusted writer (proved in 133). A fixture that only
-- needs a project to be Controlled seeds one historical (legacy, pre-13.12)
-- snapshot as data; it tests nothing about publishing.
create or replace function pg_temp.seed_legacy_snapshot(p_project uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $seed$
declare v uuid;
begin
  insert into public.planning_snapshots (project_id, version, data_date, snapshot_data)
  values (p_project, coalesce((select max(version) from public.planning_snapshots where project_id = p_project), 0) + 1,
          p_date, '{"work_items": [], "activities": [], "milestone_links": [], "opening_position": null}'::jsonb)
  returning id into v;
  return v;
end $seed$;

create or replace function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where key = p_key $$;
create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select id from ids where key = 'PRJ:' || p_code $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp where pp.project_id = pg_temp.project(p_code) and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.val(p_project uuid, p_columns text[]) returns jsonb
language sql as $$
  select coalesce(jsonb_object_agg(c, coalesce(to_jsonb(p) -> c, 'null'::jsonb)), '{}'::jsonb)
    from public.projects p, unnest(p_columns) c where p.id = p_project
$$;
create or replace function pg_temp.req_sql(
  p_key text, p_project uuid, p_field text, p_expected jsonb, p_proposed jsonb, p_reason text
) returns text language sql as $$
  select format('insert into ids(key, id) select %L, (public.request_project_setup_amendment(%L::uuid, %L, %L::jsonb, %L::jsonb, %L)).id',
                p_key, p_project, p_field, p_expected, p_proposed, p_reason)
$$;
create or replace function pg_temp.amend(p_key text) returns public.project_setup_amendments
language sql as $$ select * from public.project_setup_amendments where id = (select id from ids where key = p_key) $$;
-- Notifications for one amendment: count, and the set of recipients (as the CURRENT role sees them).
create or replace function pg_temp.seen(p_key text, p_event text default null) returns bigint
language sql as $$
  select count(*) from public.user_notifications
   where source_id = pg_temp.id(p_key) and (p_event is null or event_type = p_event)
$$;
-- The rows that exist (owner view), recipients as a sorted list.
create or replace function pg_temp.recipients(p_key text, p_event text) returns uuid[]
language sql as $$
  select coalesce(array_agg(recipient_id order by recipient_id), array[]::uuid[])
    from public.user_notifications where source_id = pg_temp.id(p_key) and event_type = p_event
$$;
create or replace function pg_temp.approvers_except(p_except uuid) returns uuid[]
language sql as $$
  select coalesce(array_agg(id order by id), array[]::uuid[]) from public.profiles
   where active and role in ('system_admin', 'project_control_admin') and id <> p_except
$$;
create or replace function pg_temp.total_rows() returns bigint language sql as $$
  select count(*) from public.user_notifications
$$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regclass('public.user_notifications') is null then
    raise exception 'user_notifications not found — apply 20261020090000_project_setup_amendment_notifications.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_notifications' and column_name = 'cleared_at') then
    raise exception 'cleared_at not found — apply 20261021090000_notification_history_clear.sql first.';
  end if;
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-139H-' || v.s, 'ZZ 13.9B-C ' || v.s, p.client_id, '2026-01-01', '2027-06-30', 'active', 'psm'
    from public.projects p, (values ('ACT'), ('ARC')) v(s) where p.id = v_template;
  insert into ids(key, id) select 'PRJ:' || code, id from public.projects where code like 'ZZ-139H-%';

  -- X = assigned Project Control (requester); PCA / PCA2 = active Project Control Admins;
  -- PCAI = INACTIVE Project Control Admin; V = plain viewer; PCA3 is created later (section 10).
  insert into public.contacts (name, email, active)
  select 'ZZ 139H ' || s, 'zz.139h.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('Y'), ('V'), ('PCA'), ('PCA2'), ('PCAI')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-f000-000000139c' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.139h.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('Y', '02'), ('V', '03'), ('PCA', '04'), ('PCA2', '05'), ('PCAI', '06')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-f000-000000139c' || v.n)::uuid, 'zz.139h.' || lower(v.s) || '@example.invalid',
         'ZZ 139H ' || v.s, v.role, pg_temp.person('ZZ 139H ' || v.s), v.active
    from (values ('X', '01', 'viewer', true), ('Y', '02', 'viewer', true), ('V', '03', 'viewer', true),
                 ('PCA', '04', 'project_control_admin', true), ('PCA2', '05', 'project_control_admin', true),
                 ('PCAI', '06', 'project_control_admin', false)) v(s, n, role, active);
  insert into ids(key, id) values
    ('P_X', '00000000-0000-4000-f000-000000139c01'), ('P_Y', '00000000-0000-4000-f000-000000139c02'),
    ('P_V', '00000000-0000-4000-f000-000000139c03'), ('P_PCA', '00000000-0000-4000-f000-000000139c04'),
    ('P_PCA2', '00000000-0000-4000-f000-000000139c05'), ('P_PCAI', '00000000-0000-4000-f000-000000139c06');

  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-139H-' || p.s), pg_temp.person('ZZ 139H ' || m.s), pg_temp.party('ZZ-139H-' || p.s, 'eprom'), m.role
    from (values ('ACT'), ('ARC')) p(s), (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-139H-' || p.s), pg_temp.person('ZZ 139H ' || m.s), m.role
    from (values ('ACT'), ('ARC')) p(s), (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects set project_control_manager_id = pg_temp.person('ZZ 139H X'),
                             reporting_coordinator_id = pg_temp.person('ZZ 139H Y')
   where code like 'ZZ-139H-%';
  insert into public.project_planning_settings (project_id, onboarding_mode)
  select id, 'new_project' from public.projects where code like 'ZZ-139H-%';
end;
$fix$;

select pg_temp.act(pg_temp.id('P_X'));
do $anchor$ begin
  perform pg_temp.must_pass(0, '00 FIXTURE', 'ACT and ARC are Controlled by a first (historical) snapshot',
    format('select pg_temp.seed_legacy_snapshot(%L::uuid, %L::date)',
           pg_temp.project('ZZ-139H-ACT'), '2026-10-10') || '; ' ||
    format('select pg_temp.seed_legacy_snapshot(%L::uuid, %L::date)',
           pg_temp.project('ZZ-139H-ARC'), '2026-10-10'));
end $anchor$;

/* ================================ 01. setup =============================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s01$
declare A uuid := pg_temp.project('ZZ-139H-ACT');
begin
  perform pg_temp.must_pass(1, '01 SETUP', 'X requests Currency (stays pending: action required for approvers)',
    pg_temp.req_sql('N_PEND', A, 'currency', pg_temp.val(A, array['currency']), '{"currency": "USD"}', 'Contract currency'));
  perform pg_temp.must_pass(1, '01 SETUP', 'X requests Time zone (will be approved)',
    pg_temp.req_sql('N_APP', A, 'time_zone', pg_temp.val(A, array['time_zone']), '{"time_zone": "Asia/Riyadh"}', 'Site moved'));
  perform pg_temp.must_pass(1, '01 SETUP', 'X requests Contract start (will be rejected)',
    pg_temp.req_sql('N_REJ', A, 'contract_start_date', pg_temp.val(A, array['contract_start_date']), '{"contract_start_date": "2025-12-01"}', 'Signed contract'));
end $s01$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s01d$ begin
  perform pg_temp.must_pass(1, '01 SETUP', 'PCA approves Time zone',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('N_APP'), 'approve'));
  perform pg_temp.must_pass(1, '01 SETUP', 'PCA rejects Contract start with a reason',
    format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('N_REJ'), 'reject', 'Keep the signed date.'));
end $s01d$;

/* ========================= 02. requester clears ========================== */

select pg_temp.owner();
insert into ids(key, note) select 'AMEND_BEFORE', md5(string_agg(to_jsonb(a)::text, '|' order by a.id)) from public.project_setup_amendments a;
insert into ids(key, note) select 'REL_BEFORE', md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) from public.project_setup_relation_changes c;
insert into ids(key, note) select 'NOT_X_BEFORE', md5(string_agg(to_jsonb(n)::text, '|' order by n.id)) from public.user_notifications n where n.recipient_id <> pg_temp.id('P_X');
select pg_temp.act(pg_temp.id('P_X'));
do $s02$
declare v_cleared integer;
begin
  perform pg_temp.chk(2, '02 REQUESTER', 'before: X sees the approved and the rejected outcome',
    (select count(*) from public.user_notifications) = 2
    and pg_temp.seen('N_APP', 'amendment_approved') = 1 and pg_temp.seen('N_REJ', 'amendment_rejected') = 1);
  v_cleared := public.clear_my_notification_history();
  perform pg_temp.chk(2, '02 REQUESTER', 'clear hides both resolved outcomes (returns 2)', v_cleared = 2, 'returned ' || v_cleared);
  perform pg_temp.chk(2, '02 REQUESTER', 'after: X''s inbox and unread count are empty',
    (select count(*) from public.user_notifications) = 0
    and (select count(*) from public.user_notifications where read_at is null) = 0);
  perform pg_temp.chk(2, '02 REQUESTER', 'clearing again is a no-op', public.clear_my_notification_history() = 0);
end $s02$;
select pg_temp.owner();
do $s02o$ begin
  perform pg_temp.chk(2, '02 REQUESTER', 'the rows are kept as delivery records (hidden, not deleted)',
    (select count(*) from public.user_notifications where recipient_id = pg_temp.id('P_X')) = 2
    and (select bool_and(cleared_at is not null) from public.user_notifications where recipient_id = pg_temp.id('P_X')));
  perform pg_temp.chk(2, '02 REQUESTER', 'other users'' notifications are byte-for-byte unchanged',
    (select md5(string_agg(to_jsonb(n)::text, '|' order by n.id)) from public.user_notifications n where n.recipient_id <> pg_temp.id('P_X'))
      = (select note from ids where key = 'NOT_X_BEFORE'));
  perform pg_temp.chk(2, '02 REQUESTER', 'amendments (approval records) and relation history are unchanged',
    (select md5(string_agg(to_jsonb(a)::text, '|' order by a.id)) from public.project_setup_amendments a) = (select note from ids where key = 'AMEND_BEFORE')
    and (select md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) from public.project_setup_relation_changes c) = (select note from ids where key = 'REL_BEFORE'));
end $s02o$;

/* ========================== 03. approver clears ========================== */

select pg_temp.owner();
insert into ids(key, note) select 'NOT_PCA_BEFORE', md5(string_agg(to_jsonb(n)::text, '|' order by n.id)) from public.user_notifications n where n.recipient_id <> pg_temp.id('P_PCA');
select pg_temp.act(pg_temp.id('P_PCA'));
do $s03$
declare v_cleared integer;
begin
  perform pg_temp.chk(3, '03 APPROVER', 'before: PCA sees only the pending request (decided ones already left the inbox)',
    pg_temp.seen('N_PEND', 'amendment_submitted') = 1 and pg_temp.seen('N_APP') = 0 and pg_temp.seen('N_REJ') = 0);
  v_cleared := public.clear_my_notification_history();
  perform pg_temp.chk(3, '03 APPROVER', 'clear hides the two resolved requests only', v_cleared = 2, 'returned ' || v_cleared);
  perform pg_temp.chk(3, '03 APPROVER', 'the pending "Approval required" stays visible and unread',
    pg_temp.seen('N_PEND', 'amendment_submitted') = 1
    and (select read_at is null from public.user_notifications where source_id = pg_temp.id('N_PEND')));
  perform pg_temp.chk(3, '03 APPROVER', 'action required is decided by the request, not by the event name',
    public.notification_requires_action('amendment_submitted', pg_temp.id('N_PEND'))
    and not public.notification_requires_action('amendment_submitted', pg_temp.id('N_APP'))
    and not public.notification_requires_action('amendment_rejected', pg_temp.id('N_REJ')));
end $s03$;
select pg_temp.owner();
do $s03o$ begin
  perform pg_temp.chk(3, '03 APPROVER', 'the pending row is not cleared',
    (select cleared_at is null from public.user_notifications where recipient_id = pg_temp.id('P_PCA') and source_id = pg_temp.id('N_PEND')));
  perform pg_temp.chk(3, '03 APPROVER', 'other users'' notifications (PCA2 included) are byte-for-byte unchanged',
    (select md5(string_agg(to_jsonb(n)::text, '|' order by n.id)) from public.user_notifications n where n.recipient_id <> pg_temp.id('P_PCA'))
      = (select note from ids where key = 'NOT_PCA_BEFORE'));
  perform pg_temp.chk(3, '03 APPROVER', 'amendments are still unchanged',
    (select md5(string_agg(to_jsonb(a)::text, '|' order by a.id)) from public.project_setup_amendments a) = (select note from ids where key = 'AMEND_BEFORE'));
end $s03o$;

/* ============== 04. a pending request on an archived project ============== */

select pg_temp.act(pg_temp.id('P_X'));
do $s04$
declare R uuid := pg_temp.project('ZZ-139H-ARC');
begin
  perform pg_temp.must_pass(4, '04 ARCHIVED', 'X requests Currency on ARC',
    pg_temp.req_sql('N_ARC', R, 'currency', pg_temp.val(R, array['currency']), '{"currency": "USD"}', 'Contract currency'));
end $s04$;
select pg_temp.owner();
update public.projects set status = 'archived', active = false, archived_at = now() where id = pg_temp.project('ZZ-139H-ARC');
select pg_temp.act(pg_temp.id('P_PCA2'));
do $s04a$ begin
  perform pg_temp.chk(4, '04 ARCHIVED', 'archived: the frozen request is not shown to the approver', pg_temp.seen('N_ARC') = 0);
  perform public.clear_my_notification_history();
end $s04a$;
select pg_temp.owner();
do $s04b$ begin
  perform pg_temp.chk(4, '04 ARCHIVED', 'still pending, so it was not cleared (it returns as actionable if the project is restored)',
    (select cleared_at is null from public.user_notifications
      where recipient_id = pg_temp.id('P_PCA2') and source_id = pg_temp.id('N_ARC') and event_type = 'amendment_submitted')
    and public.notification_requires_action('amendment_submitted', pg_temp.id('N_ARC')));
end $s04b$;

/* =========================== 05. client rights =========================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s05$ begin
  perform pg_temp.must_fail(5, '05 RIGHTS', 'a client cannot un-clear a row directly',
    'update public.user_notifications set cleared_at = null');
  perform pg_temp.must_fail(5, '05 RIGHTS', 'a client cannot clear rows directly (bypassing the action-required rule)',
    'update public.user_notifications set cleared_at = now()');
  perform pg_temp.must_fail(5, '05 RIGHTS', 'a client cannot delete notifications',
    'delete from public.user_notifications');
end $s05$;
select pg_temp.owner();
do $s05o$ begin
  perform pg_temp.chk(5, '05 RIGHTS', 'only read_at stays client-writable; anon cannot clear',
    has_column_privilege('authenticated', 'public.user_notifications', 'read_at', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.user_notifications', 'cleared_at', 'UPDATE')
    and has_function_privilege('authenticated', 'public.clear_my_notification_history()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.clear_my_notification_history()', 'EXECUTE'));
end $s05o$;
select pg_temp.owner();
do $s05a$ begin
  perform pg_temp.must_fail(5, '05 RIGHTS', 'clear refuses a caller without a session',
    'select public.clear_my_notification_history()', 'NOT_AUTHORISED');
end $s05a$;

/* ================== 06. new notifications after a clear ================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s06$
declare A uuid := pg_temp.project('ZZ-139H-ACT');
begin
  perform pg_temp.must_pass(6, '06 AFTER CLEAR', 'X requests Monthly cut-off day',
    pg_temp.req_sql('N_NEW', A, 'monthly_cutoff_day', pg_temp.val(A, array['monthly_cutoff_day']), '{"monthly_cutoff_day": 20}', 'Month-end'));
end $s06$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s06a$ begin
  perform pg_temp.chk(6, '06 AFTER CLEAR', 'PCA (who cleared) receives the new request normally', pg_temp.seen('N_NEW', 'amendment_submitted') = 1);
  perform pg_temp.must_pass(6, '06 AFTER CLEAR', 'PCA approves it',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('N_NEW'), 'approve'));
end $s06a$;
select pg_temp.act(pg_temp.id('P_X'));
do $s06x$ begin
  perform pg_temp.chk(6, '06 AFTER CLEAR', 'X (who cleared) receives new events normally (the frozen ARC request, the new approval); the cleared ones stay hidden',
    (select count(*) from public.user_notifications) = 2 and pg_temp.seen('N_NEW', 'amendment_approved') = 1
    and pg_temp.seen('N_ARC', 'amendment_frozen') = 1 and pg_temp.seen('N_APP') = 0 and pg_temp.seen('N_REJ') = 0
    and (select count(*) from public.user_notifications where read_at is null) = 2);
end $s06x$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;
