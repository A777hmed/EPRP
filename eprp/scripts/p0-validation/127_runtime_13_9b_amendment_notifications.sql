-- Phase 13.9B — actionable notifications for Project Setup amendments —
-- RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261020090000_project_setup_amendment_notifications.sql through the
-- REAL request / decide / withdraw functions on real RLS. One transaction,
-- ROLLED BACK.
--
--   01  submit: every active System Administrator / Project Control Admin
--       except the requester is notified once; requester, inactive approver
--       and plain viewer are not; row carries project, amendment, requester
--   02  no spam: lightweight amendment and free edit create nothing
--   03  inbox rules (RLS): own rows only; read_at is the only writable column;
--       no client insert / delete
--   04  approve: requester notified (with approver); the request leaves the
--       other approvers' inbox
--   05  reject: requester notified; the reason is mandatory and recorded
--   06  stale: requester notified when approval resolves the request as stale
--   07  withdraw: leaves every approver's inbox; requester gets nothing
--   08  archived: leaves every approver's inbox; requester gets "frozen"; the
--       amendment itself is byte-for-byte unchanged (still pending)
--   09  eligibility: a demoted or deactivated approver sees no request
--   10  reconcile: an approver created after the request finds it; idempotent;
--       a requester / viewer gets nothing; decided / withdrawn / frozen
--       requests are never recreated
--   11  catalog
--
-- HOW TO RUN (after the migration is applied; from eprp/; the APP database):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/127_runtime_13_9b_amendment_notifications.sql

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
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-139F-' || v.s, 'ZZ 13.9B-N ' || v.s, p.client_id, '2026-01-01', '2027-06-30', 'active', 'psm'
    from public.projects p, (values ('ACT'), ('ARC')) v(s) where p.id = v_template;
  insert into ids(key, id) select 'PRJ:' || code, id from public.projects where code like 'ZZ-139F-%';

  -- X = assigned Project Control (requester); PCA / PCA2 = active Project Control Admins;
  -- PCAI = INACTIVE Project Control Admin; V = plain viewer; PCA3 is created later (section 10).
  insert into public.contacts (name, email, active)
  select 'ZZ 139F ' || s, 'zz.139f.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('Y'), ('V'), ('PCA'), ('PCA2'), ('PCAI')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-f000-000000139f' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.139f.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('Y', '02'), ('V', '03'), ('PCA', '04'), ('PCA2', '05'), ('PCAI', '06')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-f000-000000139f' || v.n)::uuid, 'zz.139f.' || lower(v.s) || '@example.invalid',
         'ZZ 139F ' || v.s, v.role, pg_temp.person('ZZ 139F ' || v.s), v.active
    from (values ('X', '01', 'viewer', true), ('Y', '02', 'viewer', true), ('V', '03', 'viewer', true),
                 ('PCA', '04', 'project_control_admin', true), ('PCA2', '05', 'project_control_admin', true),
                 ('PCAI', '06', 'project_control_admin', false)) v(s, n, role, active);
  insert into ids(key, id) values
    ('P_X', '00000000-0000-4000-f000-000000139f01'), ('P_Y', '00000000-0000-4000-f000-000000139f02'),
    ('P_V', '00000000-0000-4000-f000-000000139f03'), ('P_PCA', '00000000-0000-4000-f000-000000139f04'),
    ('P_PCA2', '00000000-0000-4000-f000-000000139f05'), ('P_PCAI', '00000000-0000-4000-f000-000000139f06');

  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-139F-' || p.s), pg_temp.person('ZZ 139F ' || m.s), pg_temp.party('ZZ-139F-' || p.s, 'eprom'), m.role
    from (values ('ACT'), ('ARC')) p(s), (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-139F-' || p.s), pg_temp.person('ZZ 139F ' || m.s), m.role
    from (values ('ACT'), ('ARC')) p(s), (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects set project_control_manager_id = pg_temp.person('ZZ 139F X'),
                             reporting_coordinator_id = pg_temp.person('ZZ 139F Y')
   where code like 'ZZ-139F-%';
  insert into public.project_planning_settings (project_id, onboarding_mode)
  select id, 'new_project' from public.projects where code like 'ZZ-139F-%';
end;
$fix$;

select pg_temp.act(pg_temp.id('P_X'));
do $anchor$ begin
  perform pg_temp.must_pass(0, '00 FIXTURE', 'ACT and ARC are Controlled by a confirmed first publish',
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)',
           pg_temp.project('ZZ-139F-ACT'), '2026-10-10') || '; ' ||
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)',
           pg_temp.project('ZZ-139F-ARC'), '2026-10-10'));
end $anchor$;

/* =============================== 01. submit ============================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s01$
declare A uuid := pg_temp.project('ZZ-139F-ACT');
begin
  perform pg_temp.must_pass(1, '01 SUBMIT', 'X requests a governed Currency amendment',
    pg_temp.req_sql('N_CUR', A, 'currency', pg_temp.val(A, array['currency']), '{"currency": "USD"}', 'Contract currency'));
end $s01$;
select pg_temp.owner();
do $s01o$
declare A uuid := pg_temp.project('ZZ-139F-ACT');
begin
  perform pg_temp.chk(1, '01 SUBMIT', 'exactly the active System Administrators / Project Control Admins except the requester are notified',
    pg_temp.recipients('N_CUR', 'amendment_submitted') = pg_temp.approvers_except(pg_temp.id('P_X'))
    and cardinality(pg_temp.recipients('N_CUR', 'amendment_submitted')) >= 2);
  perform pg_temp.chk(1, '01 SUBMIT', 'the requester, the inactive Project Control Admin and the plain viewer are not',
    not pg_temp.id('P_X') = any (pg_temp.recipients('N_CUR', 'amendment_submitted'))
    and not pg_temp.id('P_PCAI') = any (pg_temp.recipients('N_CUR', 'amendment_submitted'))
    and not pg_temp.id('P_V') = any (pg_temp.recipients('N_CUR', 'amendment_submitted'))
    and not pg_temp.id('P_Y') = any (pg_temp.recipients('N_CUR', 'amendment_submitted')));
  perform pg_temp.chk(1, '01 SUBMIT', 'the row points at the project and the amendment (deep-link data), with the requester''s name, unread',
    (select bool_and(project_id = A and source_id = pg_temp.id('N_CUR') and actor_name = 'ZZ 139F X' and read_at is null)
       from public.user_notifications where source_id = pg_temp.id('N_CUR'))
    and (select count(*) from public.user_notifications where source_id = pg_temp.id('N_CUR'))
        = cardinality(pg_temp.approvers_except(pg_temp.id('P_X'))));
end $s01o$;

/* ============================== 02. no spam ============================== */

select pg_temp.owner();
insert into ids(key, note) select 'BEFORE_SPAM', pg_temp.total_rows()::text;
select pg_temp.act(pg_temp.id('P_X'));
do $s02b$
declare A uuid := pg_temp.project('ZZ-139F-ACT');
begin
  perform pg_temp.must_pass(2, '02 NO SPAM', 'a lightweight amendment (Short Name) applies at once',
    pg_temp.req_sql('N_LIGHT', A, 'short_name', pg_temp.val(A, array['short_name']), '{"short_name": "ZZ NOTIF"}', 'Display name'));
  perform pg_temp.chk(2, '02 NO SPAM', 'it is applied (not pending)', (pg_temp.amend('N_LIGHT')).status = 'applied');
end $s02b$;
select pg_temp.owner();
update public.projects set description = 'Free / logged edit' where id = pg_temp.project('ZZ-139F-ACT');
do $s02o$ begin
  perform pg_temp.chk(2, '02 NO SPAM', 'the lightweight amendment and the free edit created no notification',
    pg_temp.total_rows() = (select note::bigint from ids where key = 'BEFORE_SPAM'));
end $s02o$;

/* ============================ 03. inbox rules ============================ */

select pg_temp.act(pg_temp.id('P_PCA'));
do $s03$
begin
  perform pg_temp.chk(3, '03 INBOX', 'PCA sees exactly their own row for the request',
    pg_temp.seen('N_CUR') = 1
    and (select recipient_id from public.user_notifications where source_id = pg_temp.id('N_CUR')) = pg_temp.id('P_PCA'));
  perform pg_temp.must_pass(3, '03 INBOX', 'PCA marks it read',
    format('update public.user_notifications set read_at = now() where source_id = %L and event_type = %L', pg_temp.id('N_CUR'), 'amendment_submitted'));
  perform pg_temp.chk(3, '03 INBOX', 'read state is saved on the row',
    (select read_at is not null from public.user_notifications where source_id = pg_temp.id('N_CUR')));
  perform pg_temp.must_fail(3, '03 INBOX', 'PCA cannot rewrite the event, recipient or project',
    format('update public.user_notifications set event_type = %L where source_id = %L', 'amendment_approved', pg_temp.id('N_CUR')), '42501');
  perform pg_temp.must_fail(3, '03 INBOX', 'PCA cannot insert a notification',
    format('insert into public.user_notifications (recipient_id, event_type, project_id, source_id) values (%L, %L, %L, %L)',
           pg_temp.id('P_PCA'), 'amendment_stale', pg_temp.project('ZZ-139F-ACT'), pg_temp.id('N_CUR')), '42501');
  perform pg_temp.must_fail(3, '03 INBOX', 'PCA cannot delete a notification',
    format('delete from public.user_notifications where source_id = %L', pg_temp.id('N_CUR')), '42501');
end $s03$;
select pg_temp.act(pg_temp.id('P_PCA2'));
do $s03b$ begin
  perform pg_temp.chk(3, '03 INBOX', 'PCA2 still has their own unread row; PCA''s read did not touch it',
    pg_temp.seen('N_CUR') = 1 and (select read_at is null from public.user_notifications where source_id = pg_temp.id('N_CUR')));
end $s03b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s03x$ begin
  perform pg_temp.chk(3, '03 INBOX', 'the requester sees none of the approvers'' rows', pg_temp.seen('N_CUR') = 0);
end $s03x$;
select pg_temp.act(pg_temp.id('P_V'));
do $s03v$ begin
  perform pg_temp.chk(3, '03 INBOX', 'a plain viewer sees nothing', (select count(*) from public.user_notifications) = 0);
end $s03v$;

/* ============================== 04. approve ============================== */

select pg_temp.act(pg_temp.id('P_PCA2'));
do $s04$ begin
  perform pg_temp.must_pass(4, '04 APPROVE', 'PCA2 approves the Currency amendment',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('N_CUR'), 'approve'));
  perform pg_temp.chk(4, '04 APPROVE', 'it has left PCA2''s own inbox', pg_temp.seen('N_CUR', 'amendment_submitted') = 0);
end $s04$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s04b$ begin
  perform pg_temp.chk(4, '04 APPROVE', 'it has left PCA''s inbox as well (nothing left to decide), and the unread count dropped',
    pg_temp.seen('N_CUR', 'amendment_submitted') = 0);
end $s04b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s04x$ begin
  perform pg_temp.chk(4, '04 APPROVE', 'the requester has one "approved" notification naming the approver',
    pg_temp.seen('N_CUR', 'amendment_approved') = 1
    and (select actor_name = 'ZZ 139F PCA2' and read_at is null and project_id = pg_temp.project('ZZ-139F-ACT')
           from public.user_notifications where source_id = pg_temp.id('N_CUR') and event_type = 'amendment_approved'));
  perform pg_temp.chk(4, '04 APPROVE', 'the amendment the notification opens holds previous and approved values',
    (select previous_value = '{"currency": "EGP"}'::jsonb or previous_value ? 'currency' from pg_temp.amend('N_CUR'))
    and (pg_temp.amend('N_CUR')).proposed_value = '{"currency": "USD"}' and (pg_temp.amend('N_CUR')).decided_by_name = 'ZZ 139F PCA2');
end $s04x$;

/* ============================== 05. reject =============================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s05$
declare A uuid := pg_temp.project('ZZ-139F-ACT');
begin
  perform pg_temp.must_pass(5, '05 REJECT', 'X requests a Time Zone amendment',
    pg_temp.req_sql('N_TZ', A, 'time_zone', pg_temp.val(A, array['time_zone']), '{"time_zone": "Asia/Riyadh"}', 'Site moved'));
end $s05$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s05b$ begin
  perform pg_temp.must_fail(5, '05 REJECT', 'a rejection without a reason is still refused',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('N_TZ'), 'reject'), 'DECISION_COMMENT_REQUIRED');
  perform pg_temp.chk(5, '05 REJECT', 'no decision notification exists yet', pg_temp.seen('N_TZ', 'amendment_rejected') = 0);
  perform pg_temp.must_pass(5, '05 REJECT', 'PCA rejects with a reason',
    format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('N_TZ'), 'reject', 'Time zone stays on the contract time zone.'));
end $s05b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s05x$ begin
  perform pg_temp.chk(5, '05 REJECT', 'the requester has one "rejected" notification; the reason is on the amendment it opens',
    pg_temp.seen('N_TZ', 'amendment_rejected') = 1
    and (select actor_name = 'ZZ 139F PCA' from public.user_notifications where source_id = pg_temp.id('N_TZ') and event_type = 'amendment_rejected')
    and (pg_temp.amend('N_TZ')).decision_comment = 'Time zone stays on the contract time zone.'
    and (pg_temp.amend('N_TZ')).status = 'rejected');
end $s05x$;
select pg_temp.act(pg_temp.id('P_PCA2'));
do $s05p$ begin
  perform pg_temp.chk(5, '05 REJECT', 'the decided request is gone from the other approver''s inbox', pg_temp.seen('N_TZ', 'amendment_submitted') = 0);
end $s05p$;

/* =============================== 06. stale =============================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s06$
declare A uuid := pg_temp.project('ZZ-139F-ACT');
begin
  perform pg_temp.must_pass(6, '06 STALE', 'X requests a Contract Start amendment',
    pg_temp.req_sql('N_CS', A, 'contract_start_date', pg_temp.val(A, array['contract_start_date']), '{"contract_start_date": "2025-12-01"}', 'Signed contract'));
end $s06$;
select pg_temp.owner();
-- The value changes under the pending request (guard lifted inside this rolled-back transaction only).
set constraints all immediate;
alter table public.projects disable trigger guard_project_setup_controlled;
update public.projects set contract_start_date = '2026-03-01' where id = pg_temp.project('ZZ-139F-ACT');
alter table public.projects enable trigger guard_project_setup_controlled;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s06b$ begin
  perform pg_temp.must_pass(6, '06 STALE', 'approving the request resolves it as stale (returns normally)',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('N_CS'), 'approve'));
  perform pg_temp.chk(6, '06 STALE', 'recorded stale, nothing applied', (pg_temp.amend('N_CS')).status = 'stale'
    and (select contract_start_date = '2026-03-01' from public.projects where id = pg_temp.project('ZZ-139F-ACT')));
end $s06b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s06x$ begin
  perform pg_temp.chk(6, '06 STALE', 'the requester has one "stale" notification; the stale reason is on the amendment',
    pg_temp.seen('N_CS', 'amendment_stale') = 1
    and (pg_temp.amend('N_CS')).decision_comment like 'The value changed after this request%');
end $s06x$;

/* ============================== 07. withdraw ============================= */

select pg_temp.act(pg_temp.id('P_X'));
do $s07$
declare A uuid := pg_temp.project('ZZ-139F-ACT');
begin
  perform pg_temp.must_pass(7, '07 WITHDRAW', 'X requests a Reporting Cut-off amendment',
    pg_temp.req_sql('N_WD', A, 'monthly_cutoff_day', pg_temp.val(A, array['monthly_cutoff_day']), '{"monthly_cutoff_day": 20}', 'Month-end'));
end $s07$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s07a$ begin
  perform pg_temp.chk(7, '07 WITHDRAW', 'before withdrawal the approver sees it', pg_temp.seen('N_WD', 'amendment_submitted') = 1);
end $s07a$;
select pg_temp.owner();
insert into ids(key, note) select 'BEFORE_WD', pg_temp.total_rows()::text;
select pg_temp.act(pg_temp.id('P_X'));
do $s07b$ begin
  perform pg_temp.must_pass(7, '07 WITHDRAW', 'the requester withdraws it',
    format('select public.withdraw_project_setup_amendment(%L::uuid, %L)', pg_temp.id('N_WD'), 'Not needed'));
end $s07b$;
select pg_temp.owner();
do $s07o$ begin
  perform pg_temp.chk(7, '07 WITHDRAW', 'no notification was created by the withdrawal (none for the requester about their own withdrawal)',
    pg_temp.total_rows() = (select note::bigint from ids where key = 'BEFORE_WD'));
end $s07o$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s07p$ begin
  perform pg_temp.chk(7, '07 WITHDRAW', 'it is no longer actionable for any approver', pg_temp.seen('N_WD') = 0);
end $s07p$;
select pg_temp.act(pg_temp.id('P_X'));
do $s07x$ begin
  perform pg_temp.chk(7, '07 WITHDRAW', 'the requester has nothing for it, and the amendment says withdrawn',
    pg_temp.seen('N_WD') = 0 and (pg_temp.amend('N_WD')).status = 'withdrawn');
end $s07x$;

/* ============================== 08. archived ============================= */

select pg_temp.act(pg_temp.id('P_X'));
do $s08$
declare R uuid := pg_temp.project('ZZ-139F-ARC');
begin
  perform pg_temp.must_pass(8, '08 ARCHIVED', 'X requests a Currency amendment on ARC',
    pg_temp.req_sql('N_ARC', R, 'currency', pg_temp.val(R, array['currency']), '{"currency": "USD"}', 'Contract currency'));
end $s08$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s08a$ begin
  perform pg_temp.chk(8, '08 ARCHIVED', 'while active, the approver sees it', pg_temp.seen('N_ARC', 'amendment_submitted') = 1);
end $s08a$;
select pg_temp.owner();
do $s08o$
declare R uuid := pg_temp.project('ZZ-139F-ARC');
begin
  insert into ids(key, note) values ('ARC_PRINT', (select md5(to_jsonb(a)::text) from public.project_setup_amendments a where a.id = pg_temp.id('N_ARC')));
  update public.projects set status = 'archived', active = false, archived_at = now() where id = R;
end $s08o$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s08b$ begin
  perform pg_temp.chk(8, '08 ARCHIVED', 'the frozen request is no longer actionable for an approver', pg_temp.seen('N_ARC', 'amendment_submitted') = 0);
end $s08b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s08x$ begin
  perform pg_temp.chk(8, '08 ARCHIVED', 'the requester has one "frozen" notification',
    pg_temp.seen('N_ARC', 'amendment_frozen') = 1);
  perform pg_temp.chk(8, '08 ARCHIVED', 'the amendment is byte-for-byte unchanged (still pending; not mutated for notification purposes)',
    (select md5(to_jsonb(a)::text) from public.project_setup_amendments a where a.id = pg_temp.id('N_ARC')) = (select note from ids where key = 'ARC_PRINT')
    and (pg_temp.amend('N_ARC')).status = 'pending');
end $s08x$;

/* ============================ 09. eligibility ============================ */

select pg_temp.act(pg_temp.id('P_X'));
do $s09$
declare A uuid := pg_temp.project('ZZ-139F-ACT');
begin
  perform pg_temp.must_pass(9, '09 ELIGIBILITY', 'X requests a Weekly Reporting amendment (pending for the rest of the suite)',
    pg_temp.req_sql('N_PEND', A, 'weekly_enabled', pg_temp.val(A, array['weekly_enabled']),
      (select jsonb_build_object('weekly_enabled', not weekly_enabled) from public.projects where id = A), 'Change frequency'));
end $s09$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s09a$ begin
  perform pg_temp.chk(9, '09 ELIGIBILITY', 'PCA sees it while eligible', pg_temp.seen('N_PEND', 'amendment_submitted') = 1);
end $s09a$;
select pg_temp.owner();
update public.profiles set role = 'viewer' where id = pg_temp.id('P_PCA');
select pg_temp.act(pg_temp.id('P_PCA'));
do $s09b$ begin
  perform pg_temp.chk(9, '09 ELIGIBILITY', 'demoted to viewer: the request is no longer visible', pg_temp.seen('N_PEND') = 0);
end $s09b$;
select pg_temp.owner();
update public.profiles set role = 'project_control_admin', active = false where id = pg_temp.id('P_PCA');
select pg_temp.act(pg_temp.id('P_PCA'));
do $s09c$ begin
  perform pg_temp.chk(9, '09 ELIGIBILITY', 'deactivated: nothing is visible', (select count(*) from public.user_notifications) = 0);
end $s09c$;
select pg_temp.owner();
update public.profiles set active = true where id = pg_temp.id('P_PCA');
select pg_temp.act(pg_temp.id('P_PCA'));
do $s09d$ begin
  perform pg_temp.chk(9, '09 ELIGIBILITY', 'restored: the request is visible again (rows were never deleted)', pg_temp.seen('N_PEND', 'amendment_submitted') = 1);
end $s09d$;

/* ============================== 10. reconcile ============================ */

select pg_temp.owner();
-- A Project Control Admin created AFTER the request was made.
insert into public.contacts (name, email, active) values ('ZZ 139F PCA3', 'zz.139f.pca3@example.invalid', true);
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-f000-000000139f07', 'authenticated', 'authenticated',
        'zz.139f.pca3@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (id, email, full_name, role, contact_id, active)
values ('00000000-0000-4000-f000-000000139f07', 'zz.139f.pca3@example.invalid', 'ZZ 139F PCA3', 'project_control_admin', pg_temp.person('ZZ 139F PCA3'), true);
insert into ids(key, id) values ('P_PCA3', '00000000-0000-4000-f000-000000139f07');
select pg_temp.act(pg_temp.id('P_PCA3'));
do $s10$ begin
  perform pg_temp.chk(10, '10 RECONCILE', 'before reconcile the late approver has no row', (select count(*) from public.user_notifications) = 0);
  perform pg_temp.must_pass(10, '10 RECONCILE', 'reconcile runs for the caller', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.chk(10, '10 RECONCILE', 'the late approver now finds the pending request, dated when it was requested',
    pg_temp.seen('N_PEND', 'amendment_submitted') = 1
    and (select created_at = (pg_temp.amend('N_PEND')).requested_at from public.user_notifications where source_id = pg_temp.id('N_PEND')));
  perform pg_temp.chk(10, '10 RECONCILE', 'only pending, active-project requests: nothing for the decided, withdrawn or frozen ones',
    pg_temp.seen('N_CUR') = 0 and pg_temp.seen('N_TZ') = 0 and pg_temp.seen('N_CS') = 0 and pg_temp.seen('N_WD') = 0 and pg_temp.seen('N_ARC') = 0);
  perform pg_temp.must_pass(10, '10 RECONCILE', 'running it again is idempotent', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.chk(10, '10 RECONCILE', 'no duplicate', (select count(*) from public.user_notifications where source_id = pg_temp.id('N_PEND')) = 1);
end $s10$;
select pg_temp.act(pg_temp.id('P_X'));
do $s10x$ begin
  perform pg_temp.must_pass(10, '10 RECONCILE', 'the requester may call it', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.chk(10, '10 RECONCILE', 'but gets nothing for their own request', pg_temp.seen('N_PEND') = 0);
end $s10x$;
select pg_temp.act(pg_temp.id('P_V'));
do $s10v$ begin
  perform pg_temp.must_pass(10, '10 RECONCILE', 'a plain viewer may call it', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.chk(10, '10 RECONCILE', 'and gets nothing', (select count(*) from public.user_notifications) = 0);
end $s10v$;
select pg_temp.owner();
do $s10o$ begin
  perform pg_temp.chk(10, '10 RECONCILE', 'the pending request itself is untouched by notification work',
    (pg_temp.amend('N_PEND')).status = 'pending' and (pg_temp.amend('N_PEND')).decided_by is null);
end $s10o$;

/* =============================== 11. catalog ============================= */

do $s11$ begin
  perform pg_temp.chk(11, '11 CATALOG', 'event triggers exist on the amendment table (insert + update) and on projects (status)',
    exists (select 1 from pg_trigger where tgname = 'notify_setup_amendment_event' and tgrelid = 'public.project_setup_amendments'::regclass)
    and exists (select 1 from pg_trigger where tgname = 'notify_setup_amendments_frozen' and tgrelid = 'public.projects'::regclass));
  perform pg_temp.chk(11, '11 CATALOG', 'clients cannot write notifications or call the trigger functions; anon reads nothing',
    not has_table_privilege('authenticated', 'public.user_notifications', 'INSERT,DELETE')
    and not has_column_privilege('authenticated', 'public.user_notifications', 'recipient_id', 'UPDATE')
    and has_column_privilege('authenticated', 'public.user_notifications', 'read_at', 'UPDATE')
    and not has_table_privilege('anon', 'public.user_notifications', 'SELECT')
    and not has_function_privilege('authenticated', 'public.notify_setup_amendment_event()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.notify_setup_amendments_frozen()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.reconcile_my_setup_amendment_notifications()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.reconcile_my_setup_amendment_notifications()', 'EXECUTE'));
  perform pg_temp.chk(11, '11 CATALOG', 'one notification per recipient, event and amendment',
    exists (select 1 from pg_indexes where indexname = 'user_notifications_one_per_event' and indexdef like '%UNIQUE%(recipient_id, event_type, source_id)%'));
end $s11$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;
