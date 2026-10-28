-- Phase 13.9B — Project Setup Governance — Step 1 governance core
-- — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261016090000_project_setup_governance_core.sql against real
-- PostgreSQL, real RLS and real authenticated roles. Everything — fixtures,
-- accounts and every write — runs in ONE transaction that is ROLLED BACK.
-- Nothing persists.
--
--   01  not Controlled: every setup field and the onboarding mode still save as
--       today; nothing is logged; amendments are refused (edit directly)
--   02  Controlled anchor: the first publish needs the explicit confirmation;
--       the first snapshot makes the project Controlled; later publishes need
--       no confirmation; Controlled never reverts
--   03  free / logged fields: direct edit allowed and logged; unchanged hidden
--       (retired / governed) values round-trip
--   04  lightweight: no reason refused; direct edit refused; with a reason the
--       value is applied atomically; stale base and no-change refused
--   05  governed: direct edit refused; request pending; duplicate pending
--       refused; self-approval refused for every role; a different PCA / SA
--       approves and the value is applied; reject needs a comment; withdraw;
--       first decision wins (a second decision is refused)
--   06  stale: the value changes while a request is pending (System
--       Administrator Project Type correction); approval records stale and
--       applies nothing
--   07  retired fields: any change refused; an amendment of one refused
--   08  Project Type: the existing System Administrator correction is
--       unchanged and writes no amendment row; a PCA is refused; the one-time
--       classification of a Controlled legacy project through Project Setup is
--       refused (System Administrator bootstrap only, 124 — owner 2026-10-17)
--   09  onboarding transitions (B18): the app's same-mode upsert passes;
--       new <-> existing and planned -> no_formal refused once a snapshot
--       exists; no_formal -> planned only through an approved amendment
--   10  publish guards: no_formal_schedule publish and Opening Position
--       promotion refused; operations authority unchanged
--   11  authority: Reporting Coordinator, viewer and an assigned Project
--       Control on another project refused; assigned Project Control works on
--       their own project; non-global users cannot decide; no direct table
--       writes for any client; the history is immutable even for the owner
--   12  archived (B24): request, decide, withdraw, setup edits and publish
--       refused for every role; the pending request is byte-for-byte unchanged
--       and readable
--   13  catalog: registry coverage, trigger order, grants, one publish
--       overload, shared predicates unchanged
--
-- HOW TO RUN (after the migration is applied; from eprp/; the APP database):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/123_runtime_13_9b_governance_core.sql

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


-- Fixture ids are pinned at creation: an approved Project Code amendment
-- changes the code later in this script.
create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select coalesce((select id from ids where key = 'PRJ:' || p_code),
                                   (select id from public.projects where code = p_code)) $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp join public.projects p on p.id = pp.project_id
                    where p.code = p_code and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.id(p_key text) returns uuid
language sql as $$ select id from ids where key = p_key $$;

-- The value of some columns of a project, as {column: value} (the caller's view).
create or replace function pg_temp.val(p_project uuid, p_columns text[]) returns jsonb
language sql as $$
  select coalesce(jsonb_object_agg(c, coalesce(to_jsonb(p) -> c, 'null'::jsonb)), '{}'::jsonb)
    from public.projects p, unnest(p_columns) c where p.id = p_project
$$;

-- A Project Setup save, exactly as the app sends it (save_project_setup_patch).
create or replace function pg_temp.patch_sql(p_project uuid, p_columns jsonb) returns text
language sql as $$
  select format('select public.save_project_setup_patch(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L::jsonb, %L::jsonb)',
                p_project, p_project, p_columns, '{}'::jsonb)
$$;

-- request_project_setup_amendment() as SQL text that stores the new id under p_key.
create or replace function pg_temp.req_sql(
  p_key text, p_project uuid, p_field text, p_expected jsonb, p_proposed jsonb, p_reason text
) returns text language sql as $$
  select format('insert into ids(key, id) select %L, (public.request_project_setup_amendment(%L::uuid, %L, %L::jsonb, %L::jsonb, %L)).id',
                p_key, p_project, p_field, p_expected, p_proposed, p_reason)
$$;

create or replace function pg_temp.amend(p_key text) returns public.project_setup_amendments
language sql as $$ select * from public.project_setup_amendments where id = (select id from ids where key = p_key) $$;

create or replace function pg_temp.publish_sql(p_project uuid, p_confirm boolean, p_date date default '2026-10-10') returns text
language sql as $$
  select format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => %L)',
                p_project, p_date, p_confirm)
$$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  v_insp uuid := (select id from public.project_types where code = 'INSP-DEMO');
  v_pipe uuid := (select id from public.project_types where code = 'PIPE-DEMO');
begin
  if v_template is null or v_insp is null or v_pipe is null then
    raise exception 'ZZ-P0TEST-PRJ / INSP-DEMO / PIPE-DEMO not found — this script expects the local development dataset.';
  end if;
  if to_regprocedure('public.request_project_setup_amendment(uuid,text,jsonb,jsonb,text)') is null then
    raise exception 'request_project_setup_amendment() not found — apply 20261016090000_project_setup_governance_core.sql first.';
  end if;
  insert into ids(key, id) values ('T_INSP', v_insp), ('T_PIPE', v_pipe);

  -- FREE stays not Controlled. ACT, ARC and X2P become Controlled by a real
  -- publish. OTH is an Other project. NFS is no_formal_schedule. LEG is the
  -- legacy no_formal + snapshot state. LGC is a legacy (unclassified) project.
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status,
                               structure_family, project_type_id)
  select 'ZZ-139B-' || v.s, 'ZZ 13.9B ' || v.s, p.client_id, '2026-01-01', '2027-06-30', 'active',
         v.fam, case v.fam when 'other' then v_insp end
    from public.projects p,
         (values ('FREE', 'psm'), ('ACT', 'psm'), ('ARC', 'psm'), ('X2P', 'psm'), ('OTH', 'other'),
                 ('NFS', 'psm'), ('LEG', 'psm')) v(s, fam)
   where p.id = v_template;
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, project_type_id)
  select 'ZZ-139B-LGC', 'ZZ 13.9B LGC', p.client_id, '2026-01-01', '2027-06-30', 'active', v_insp
    from public.projects p where p.id = v_template;
  insert into ids(key, id) select 'PRJ:' || code, id from public.projects where code like 'ZZ-139B-%';

  -- People: X = assigned Project Control on every fixture except X2P;
  -- X2 = assigned Project Control on X2P only; Y = Reporting Coordinator;
  -- V = plain viewer; PCA / PCA2 = Project Control Admins; SA = an existing
  -- System Administrator.
  insert into public.contacts (name, email, active)
  select 'ZZ 139B ' || s, 'zz.139b.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('X2'), ('Y'), ('V'), ('PCA'), ('PCA2')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-b000-000000139b' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.139b.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('X2', '02'), ('Y', '03'), ('V', '04'), ('PCA', '05'), ('PCA2', '06')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-b000-000000139b' || v.n)::uuid, 'zz.139b.' || lower(v.s) || '@example.invalid',
         'ZZ 139B ' || v.s, v.role, pg_temp.person('ZZ 139B ' || v.s), true
    from (values ('X', '01', 'viewer'), ('X2', '02', 'viewer'), ('Y', '03', 'viewer'), ('V', '04', 'viewer'),
                 ('PCA', '05', 'project_control_admin'), ('PCA2', '06', 'project_control_admin')) v(s, n, role);
  insert into ids(key, id) values
    ('P_X', '00000000-0000-4000-b000-000000139b01'), ('P_X2', '00000000-0000-4000-b000-000000139b02'),
    ('P_Y', '00000000-0000-4000-b000-000000139b03'), ('P_V', '00000000-0000-4000-b000-000000139b04'),
    ('P_PCA', '00000000-0000-4000-b000-000000139b05'), ('P_PCA2', '00000000-0000-4000-b000-000000139b06'),
    ('P_SA', (select id from public.profiles where role = 'system_admin' and active and contact_id is not null
               order by created_at limit 1));
  if pg_temp.id('P_SA') is null then
    raise exception 'No active System Administrator with a contact exists in the local dataset.';
  end if;

  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-139B-' || p.s), pg_temp.person('ZZ 139B ' || m.s), pg_temp.party('ZZ-139B-' || p.s, 'eprom'), m.role
    from (values ('FREE'), ('ACT'), ('ARC'), ('OTH'), ('NFS'), ('LEG'), ('LGC')) p(s),
         (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-139B-' || p.s), pg_temp.person('ZZ 139B ' || m.s), m.role
    from (values ('FREE'), ('ACT'), ('ARC'), ('OTH'), ('NFS'), ('LEG'), ('LGC')) p(s),
         (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects
     set project_control_manager_id = pg_temp.person('ZZ 139B X'),
         reporting_coordinator_id = pg_temp.person('ZZ 139B Y')
   where code in ('ZZ-139B-FREE', 'ZZ-139B-ACT', 'ZZ-139B-ARC', 'ZZ-139B-OTH', 'ZZ-139B-NFS', 'ZZ-139B-LEG', 'ZZ-139B-LGC');
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  values (pg_temp.project('ZZ-139B-X2P'), pg_temp.person('ZZ 139B X2'), pg_temp.party('ZZ-139B-X2P', 'eprom'), 'Project Controls');
  insert into public.project_contacts (project_id, contact_id, role)
  values (pg_temp.project('ZZ-139B-X2P'), pg_temp.person('ZZ 139B X2'), 'project_control_manager');
  update public.projects set project_control_manager_id = pg_temp.person('ZZ 139B X2') where code = 'ZZ-139B-X2P';

  insert into public.project_planning_settings (project_id, onboarding_mode)
  select pg_temp.project('ZZ-139B-' || v.s), v.mode
    from (values ('FREE', 'new_project'), ('ACT', 'new_project'), ('ARC', 'new_project'), ('X2P', 'new_project'),
                 ('OTH', 'new_project'), ('NFS', 'no_formal_schedule'), ('LEG', 'no_formal_schedule')) v(s, mode);
  -- LGC deliberately has no settings row (reads the default new_project).

  -- NFS: a draft Opening Position (promotion must be refused for the mode).
  -- Since 13.11 (20261023090000) a no_formal_schedule project cannot gain an
  -- Opening Position, so this models LEGACY data: written with that guard
  -- disabled for this one insert, inside this rolled-back transaction.
  alter table public.planning_opening_positions disable trigger guard_no_formal_schedule_planning;
  insert into public.planning_opening_positions (project_id, data_date, planned_progress_percent, actual_progress_percent, source)
  values (pg_temp.project('ZZ-139B-NFS'), '2026-10-01', 30, 25, 'ZZ prior contractor S-curve');
  alter table public.planning_opening_positions enable trigger guard_no_formal_schedule_planning;
  insert into ids(key, id) values ('NFS_OP',
    (select id from public.planning_opening_positions where project_id = pg_temp.project('ZZ-139B-NFS')));

  -- LEG: the legacy state (no_formal_schedule with an existing snapshot) that
  -- the publish guard now prevents; written directly, as old data would be.
  insert into public.planning_snapshots (project_id, version, snapshot_data, data_date)
  values (pg_temp.project('ZZ-139B-LEG'), 1, '{}'::jsonb, '2026-09-30');
end;
$fix$;

/* =============== 01. not Controlled: everything as today ================= */

select pg_temp.act(pg_temp.id('P_X'));
do $s01$
declare F uuid := pg_temp.project('ZZ-139B-FREE');
begin
  perform pg_temp.chk(1, '01 NOT CONTROLLED', 'FREE is not Controlled (no snapshot)',
    public.project_setup_controlled(F) = false and public.project_setup_controlled_since(F) is null);
  perform pg_temp.must_pass(1, '01 NOT CONTROLLED', 'lightweight, governed and retired fields save directly as today',
    pg_temp.patch_sql(F, jsonb_build_object('name', 'ZZ 13.9B FREE renamed', 'code', 'ZZ-139B-FREE2',
      'forecast_finish_date', '2027-07-31', 'priority', 'high', 'planned_progress', 12, 'description', 'free text')));
  perform pg_temp.chk(1, '01 NOT CONTROLLED', 'the values were saved',
    (select name = 'ZZ 13.9B FREE renamed' and code = 'ZZ-139B-FREE2' and priority = 'high' and planned_progress = 12
       from public.projects where id = F));
  perform pg_temp.must_pass(1, '01 NOT CONTROLLED', 'the onboarding mode still changes freely (app upsert)',
    format('insert into public.project_planning_settings (project_id, onboarding_mode) values (%L, %L) on conflict (project_id) do update set onboarding_mode = excluded.onboarding_mode',
           F, 'existing_active_project'));
  perform pg_temp.chk(1, '01 NOT CONTROLLED', 'nothing is logged and no amendment exists',
    not exists (select 1 from public.project_setup_field_changes where project_id = F)
    and not exists (select 1 from public.project_setup_amendments where project_id = F));
  perform pg_temp.must_fail(1, '01 NOT CONTROLLED', 'an amendment is refused: edit directly',
    pg_temp.req_sql('FREE_NAME', F, 'name', pg_temp.val(F, array['name']), '{"name": "ZZ x"}', 'test'), 'SETUP_NOT_CONTROLLED');
end $s01$;

/* ====================== 02. the Controlled anchor ======================== */

do $s02$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  -- 13.12: the first-anchor confirmation now guards the v2 writer, BL0 approval
  -- and Opening Position promotion (133 §02, §05, §10); a normal legacy publish is retired.
  perform pg_temp.must_fail(2, '02 ANCHOR', '13.12: a normal legacy publish is refused ([V2_PUBLISH_REQUIRED])',
    pg_temp.publish_sql(A, false), 'V2_PUBLISH_REQUIRED');
  perform pg_temp.chk(2, '02 ANCHOR', 'the refused publish created no snapshot and the project stays not Controlled',
    not exists (select 1 from public.planning_snapshots where project_id = A) and not public.project_setup_controlled(A));
  perform pg_temp.must_pass(2, '02 ANCHOR', 'a first (historical) snapshot exists — fixture data',
    format('select pg_temp.seed_legacy_snapshot(%L::uuid, %L::date)', A, '2026-10-10'));
  perform pg_temp.chk(2, '02 ANCHOR', 'the first snapshot makes the project Controlled, since its published_at',
    public.project_setup_controlled(A)
    and public.project_setup_controlled_since(A) = (select min(published_at) from public.planning_snapshots where project_id = A));
  perform pg_temp.must_pass(2, '02 ANCHOR', 'a later (historical) snapshot — fixture data',
    format('select pg_temp.seed_legacy_snapshot(%L::uuid, %L::date)', A, '2026-10-12'));
end $s02$;
do $s02b$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_fail(2, '02 ANCHOR', 'a client delete of the snapshots is refused (13.12: no client write at all)',
    format('delete from public.planning_snapshots where project_id = %L', A), '42501');
  perform pg_temp.chk(2, '02 ANCHOR', 'Controlled never reverts (snapshots survive; the state is unchanged)',
    public.project_setup_controlled(A) and (select count(*) from public.planning_snapshots where project_id = A) = 2);
end $s02b$;

-- The remaining anchors (as X with confirmation): ARC and OTH; X2P by X2; LGC by X.
do $s02c$
begin
  perform pg_temp.must_pass(2, '02 ANCHOR', 'fixtures ARC / OTH / LGC become Controlled by a first (historical) snapshot',
    format('select pg_temp.seed_legacy_snapshot(%L::uuid, %L::date); select pg_temp.seed_legacy_snapshot(%L::uuid, %L::date); select pg_temp.seed_legacy_snapshot(%L::uuid, %L::date)',
           pg_temp.project('ZZ-139B-ARC'), '2026-10-10', pg_temp.project('ZZ-139B-OTH'), '2026-10-10',
           pg_temp.project('ZZ-139B-LGC'), '2026-10-10'));
end $s02c$;
select pg_temp.act(pg_temp.id('P_X2'));
do $s02d$
begin
  perform pg_temp.must_pass(2, '02 ANCHOR', 'fixture X2P becomes Controlled by a first (historical) snapshot',
    format('select pg_temp.seed_legacy_snapshot(%L::uuid, %L::date)', pg_temp.project('ZZ-139B-X2P'), '2026-10-10'));
end $s02d$;
select pg_temp.act(pg_temp.id('P_X'));

/* ============== 03. free / logged and hidden round-trips ================== */

do $s03$
declare
  A uuid := pg_temp.project('ZZ-139B-ACT');
  v_hidden jsonb;
begin
  perform pg_temp.must_pass(3, '03 FREE', 'free fields (description, city, Lifecycle Status) save directly',
    pg_temp.patch_sql(A, '{"description": "Controlled description", "city": "Alexandria", "status": "on_hold"}'));
  perform pg_temp.chk(3, '03 FREE', 'each change is logged once with before / after, actor and transaction',
    (select count(*) from public.project_setup_field_changes c
      where c.project_id = A and c.change_source = 'direct_edit'
        and c.changed_by = pg_temp.id('P_X') and c.changed_by_name = 'ZZ 139B X'
        and c.transaction_id = pg_current_xact_id()
        and ((c.field_key = 'description' and c.new_value = '{"description": "Controlled description"}' and c.previous_value = '{"description": null}')
          or (c.field_key = 'city' and c.new_value = '{"city": "Alexandria"}')
          or (c.field_key = 'status' and c.previous_value = '{"status": "active"}' and c.new_value = '{"status": "on_hold"}'))) = 3);
  -- The app re-sends every column. Unchanged lightweight / governed / retired
  -- values must pass beside a real free change.
  v_hidden := pg_temp.val(A, array['name', 'short_name', 'code', 'client_id', 'contract_number', 'purchase_order_number',
                                   'contract_start_date', 'planned_start_date', 'planned_finish_date', 'forecast_finish_date',
                                   'actual_start_date', 'actual_finish_date', 'priority', 'overall_status',
                                   'planned_progress', 'actual_progress', 'currency', 'time_zone', 'working_week',
                                   'monthly_cutoff_day', 'weekly_reporting_day', 'weekly_enabled', 'monthly_enabled',
                                   'executive_enabled', 'milestone_update_approval', 'project_type_id',
                                   'project_category_detail'])
              || '{"status": "active"}'::jsonb;
  perform pg_temp.must_pass(3, '03 FREE', 'unchanged hidden lightweight / governed / retired values round-trip with a free change',
    pg_temp.patch_sql(A, v_hidden));
  perform pg_temp.chk(3, '03 FREE', 'only the real change is logged (status back to active)',
    (select count(*) from public.project_setup_field_changes where project_id = A) = 4);
end $s03$;

/* ============================ 04. lightweight ============================ */

do $s04$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_fail(4, '04 LIGHTWEIGHT', 'a direct edit of Project Name is refused',
    pg_temp.patch_sql(A, '{"name": "ZZ direct"}'), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(4, '04 LIGHTWEIGHT', 'an amendment without a reason is refused',
    pg_temp.req_sql('L0', A, 'name', pg_temp.val(A, array['name']), '{"name": "ZZ 13.9B ACT v2"}', '  '), 'REASON_REQUIRED');
  perform pg_temp.must_fail(4, '04 LIGHTWEIGHT', 'a stale base value is refused (PT409)',
    pg_temp.req_sql('L0', A, 'name', '{"name": "not the current name"}', '{"name": "ZZ 13.9B ACT v2"}', 'rename'), 'PT409');
  perform pg_temp.must_fail(4, '04 LIGHTWEIGHT', 'a value equal to the current one is refused',
    pg_temp.req_sql('L0', A, 'name', pg_temp.val(A, array['name']), pg_temp.val(A, array['name']), 'rename'), 'NO_CHANGE');
  perform pg_temp.must_pass(4, '04 LIGHTWEIGHT', 'with a reason, the amendment is accepted',
    pg_temp.req_sql('L_NAME', A, 'name', pg_temp.val(A, array['name']), '{"name": "ZZ 13.9B ACT v2"}', 'Client renamed the project'));
  perform pg_temp.chk(4, '04 LIGHTWEIGHT', 'status applied, value applied in the same transaction, no decider',
    (select status = 'applied' and amendment_class = 'lightweight' and applied_transaction_id = pg_current_xact_id()
            and decided_by is null and requested_by = pg_temp.id('P_X') and previous_value = '{"name": "ZZ 13.9B ACT"}'
            and impact_warning <> '' from pg_temp.amend('L_NAME'))
    and (select name from public.projects where id = A) = 'ZZ 13.9B ACT v2');
  perform pg_temp.must_pass(4, '04 LIGHTWEIGHT', 'Actual Start is lightweight too (applied with a reason)',
    pg_temp.req_sql('L_AS', A, 'actual_start_date', pg_temp.val(A, array['actual_start_date']), '{"actual_start_date": "2026-02-01"}', 'Mobilised'));
  perform pg_temp.chk(4, '04 LIGHTWEIGHT', 'Actual Start applied',
    (select actual_start_date = '2026-02-01' from public.projects where id = A));
  perform pg_temp.must_fail(4, '04 LIGHTWEIGHT', 'a free field cannot be amended (edit directly)',
    pg_temp.req_sql('L1', A, 'description', pg_temp.val(A, array['description']), '{"description": "x"}', 'r'), 'FIELD_NOT_AMENDABLE');
end $s04$;

/* ============================== 05. governed ============================= */

do $s05$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_fail(5, '05 GOVERNED', 'a direct edit of Project Code is refused',
    pg_temp.patch_sql(A, '{"code": "ZZ-139B-ACT-NEW"}'), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(5, '05 GOVERNED', 'a direct edit of Forecast Finish is refused (B22: governed)',
    pg_temp.patch_sql(A, '{"forecast_finish_date": "2027-09-30"}'), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(5, '05 GOVERNED', 'a direct edit of the reporting cut-off is refused',
    pg_temp.patch_sql(A, '{"monthly_cutoff_day": 20}'), 'SETUP_CONTROLLED');
  perform pg_temp.must_pass(5, '05 GOVERNED', 'the assigned Project Control requests a Project Code change',
    pg_temp.req_sql('G_CODE', A, 'code', '{"code": "ZZ-139B-ACT"}', '{"code": "ZZ-139B-ACT-NEW"}', 'Client contract re-numbering'));
  perform pg_temp.chk(5, '05 GOVERNED', 'the request is pending and nothing is applied yet',
    (select status = 'pending' and applied_transaction_id is null from pg_temp.amend('G_CODE'))
    and (select code from public.projects where id = A) = 'ZZ-139B-ACT');
  perform pg_temp.must_fail(5, '05 GOVERNED', 'a second pending request on the same field is refused',
    pg_temp.req_sql('G_CODE2', A, 'code', '{"code": "ZZ-139B-ACT"}', '{"code": "ZZ-139B-ACT-OTHER"}', 'again'), 'AMENDMENT_PENDING');
  perform pg_temp.must_fail(5, '05 GOVERNED', 'the requester cannot approve their own request',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('G_CODE'), 'approve'), 'SELF_APPROVAL');
end $s05$;

select pg_temp.act(pg_temp.id('P_Y'));
do $s05y$
begin
  perform pg_temp.must_fail(5, '05 GOVERNED', 'the Reporting Coordinator cannot decide',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('G_CODE'), 'approve'), 'NOT_AUTHORIZED');
end $s05y$;

select pg_temp.act(pg_temp.id('P_PCA'));
do $s05p$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_pass(5, '05 GOVERNED', 'a different Project Control Admin approves',
    format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('G_CODE'), 'approve', 'Agreed'));
  perform pg_temp.chk(5, '05 GOVERNED', 'approved by PCA, value applied in the decision transaction',
    (select status = 'approved' and decided_by = pg_temp.id('P_PCA') and decided_by_name = 'ZZ 139B PCA'
            and applied_transaction_id = pg_current_xact_id() and decision_comment = 'Agreed' from pg_temp.amend('G_CODE'))
    and (select code from public.projects where id = A) = 'ZZ-139B-ACT-NEW');
  perform pg_temp.must_fail(5, '05 GOVERNED', 'first decision wins: a second approval is refused (PT409)',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('G_CODE'), 'approve'), 'PT409');
  perform pg_temp.must_fail(5, '05 GOVERNED', 'first decision wins: a later rejection is refused',
    format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('G_CODE'), 'reject', 'too late'), 'AMENDMENT_NOT_PENDING');
  -- A Project Control Admin's own request.
  perform pg_temp.must_pass(5, '05 GOVERNED', 'a Project Control Admin requests a Contract Start',
    pg_temp.req_sql('G_CS', A, 'contract_start_date', pg_temp.val(A, array['contract_start_date']), '{"contract_start_date": "2025-12-01"}', 'Signed contract'));
  perform pg_temp.must_fail(5, '05 GOVERNED', 'a Project Control Admin cannot approve their own request',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('G_CS'), 'approve'), 'SELF_APPROVAL');
end $s05p$;

select pg_temp.act(pg_temp.id('P_SA'));
do $s05s$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_pass(5, '05 GOVERNED', 'the System Administrator approves the PCA request',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('G_CS'), 'approve'));
  perform pg_temp.chk(5, '05 GOVERNED', 'Contract Start applied',
    (select contract_start_date = '2025-12-01' from public.projects where id = A));
  perform pg_temp.must_pass(5, '05 GOVERNED', 'the System Administrator requests a Currency change',
    pg_temp.req_sql('G_CUR', A, 'currency', pg_temp.val(A, array['currency']), '{"currency": "USD"}', 'Contract currency'));
  perform pg_temp.must_fail(5, '05 GOVERNED', 'a System Administrator cannot approve their own request either (no break-glass)',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('G_CUR'), 'approve'), 'SELF_APPROVAL');
  perform pg_temp.must_fail(5, '05 GOVERNED', 'a System Administrator cannot reject their own request either',
    format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('G_CUR'), 'reject', 'no'), 'SELF_APPROVAL');
end $s05s$;

select pg_temp.act(pg_temp.id('P_PCA2'));
do $s05q$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_fail(5, '05 GOVERNED', 'a rejection without a comment is refused',
    format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('G_CUR'), 'reject', ' '), 'DECISION_COMMENT_REQUIRED');
  perform pg_temp.must_pass(5, '05 GOVERNED', 'another Project Control Admin rejects with a comment',
    format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('G_CUR'), 'reject', 'Contract is in EGP'));
  perform pg_temp.chk(5, '05 GOVERNED', 'rejected, nothing applied',
    (select status = 'rejected' and decided_by = pg_temp.id('P_PCA2') and applied_transaction_id is null from pg_temp.amend('G_CUR'))
    and (select currency from public.projects where id = A) <> 'USD');
end $s05q$;

select pg_temp.act(pg_temp.id('P_X'));
do $s05w$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_pass(5, '05 GOVERNED', 'Project Control requests a Time Zone change',
    pg_temp.req_sql('G_TZ', A, 'time_zone', pg_temp.val(A, array['time_zone']), '{"time_zone": "Asia/Riyadh"}', 'Site moved'));
  perform pg_temp.must_pass(5, '05 GOVERNED', 'Project Control requests a Weekly Reporting Day change',
    pg_temp.req_sql('G_WD', A, 'weekly_reporting_day', pg_temp.val(A, array['weekly_reporting_day']), '{"weekly_reporting_day": "monday"}', 'New cadence'));
  perform pg_temp.must_pass(5, '05 GOVERNED', 'the requester withdraws their own request',
    format('select public.withdraw_project_setup_amendment(%L, %L)', pg_temp.id('G_TZ'), 'Raised in error'));
  perform pg_temp.chk(5, '05 GOVERNED', 'withdrawn, nothing applied, withdrawer recorded',
    (select status = 'withdrawn' and decided_by = pg_temp.id('P_X') from pg_temp.amend('G_TZ'))
    and (select time_zone from public.projects where id = A) <> 'Asia/Riyadh');
  perform pg_temp.must_fail(5, '05 GOVERNED', 'a decided request cannot be withdrawn',
    format('select public.withdraw_project_setup_amendment(%L)', pg_temp.id('G_TZ')), 'AMENDMENT_NOT_PENDING');
end $s05w$;

select pg_temp.act(pg_temp.id('P_Y'));
do $s05y2$
begin
  perform pg_temp.must_fail(5, '05 GOVERNED', 'the Reporting Coordinator cannot withdraw someone else''s request',
    format('select public.withdraw_project_setup_amendment(%L)', pg_temp.id('G_WD')), 'NOT_AUTHORIZED');
end $s05y2$;

select pg_temp.act(pg_temp.id('P_PCA'));
do $s05w2$
begin
  perform pg_temp.must_pass(5, '05 GOVERNED', 'a Project Control Admin may withdraw another user''s request',
    format('select public.withdraw_project_setup_amendment(%L)', pg_temp.id('G_WD')));
end $s05w2$;

/* ================================ 06. stale ============================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s06$
declare O uuid := pg_temp.project('ZZ-139B-OTH');
begin
  perform pg_temp.must_pass(6, '06 STALE', 'Project Control requests a Project Category change on the Other project',
    pg_temp.req_sql('G_CAT', O, 'project_category', pg_temp.val(O, array['project_type_id', 'project_category_detail']),
                    jsonb_build_object('project_type_id', pg_temp.id('T_PIPE'), 'project_category_detail', null), 'Scope is pipeline'));
end $s06$;

select pg_temp.act(pg_temp.id('P_SA'));
do $s06s$
declare O uuid := pg_temp.project('ZZ-139B-OTH');
begin
  -- Meanwhile the System Administrator corrects the Project Type (Other ->
  -- PSM), which clears the category the request was based on.
  perform pg_temp.must_pass(6, '06 STALE', 'meanwhile the System Administrator corrects the Project Type (existing path)',
    format('select public.correct_project_structure_family(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L, null, null, %L)',
           O, O, 'psm', 'Misclassified at creation'));
end $s06s$;

select pg_temp.act(pg_temp.id('P_PCA'));
do $s06p$
declare O uuid := pg_temp.project('ZZ-139B-OTH');
begin
  perform pg_temp.must_pass(6, '06 STALE', 'approving the now-stale request returns normally (the outcome is recorded)',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('G_CAT'), 'approve'));
  perform pg_temp.chk(6, '06 STALE', 'status stale, no decider, decision time set, nothing applied',
    (select status = 'stale' and decided_by is null and decided_at is not null and applied_transaction_id is null
            and decision_comment like 'The value changed%' from pg_temp.amend('G_CAT'))
    and (select structure_family = 'psm' and project_type_id is null from public.projects where id = O));
  perform pg_temp.must_fail(6, '06 STALE', 'a stale request cannot be decided again',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('G_CAT'), 'approve'), 'AMENDMENT_NOT_PENDING');
end $s06p$;

/* =============================== 07. retired ============================= */

select pg_temp.act(pg_temp.id('P_X'));
do $s07$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_fail(7, '07 RETIRED', 'a changed Priority is refused',
    pg_temp.patch_sql(A, '{"priority": "critical"}'), 'SETUP_FIELD_RETIRED');
  perform pg_temp.must_fail(7, '07 RETIRED', 'a changed overall_status is refused',
    pg_temp.patch_sql(A, '{"overall_status": "behind"}'), 'SETUP_FIELD_RETIRED');
  perform pg_temp.must_fail(7, '07 RETIRED', 'a changed typed planned_progress is refused',
    pg_temp.patch_sql(A, '{"planned_progress": 55}'), 'SETUP_FIELD_RETIRED');
  perform pg_temp.must_fail(7, '07 RETIRED', 'a changed typed actual_progress is refused',
    pg_temp.patch_sql(A, '{"actual_progress": 44}'), 'SETUP_FIELD_RETIRED');
  perform pg_temp.must_fail(7, '07 RETIRED', 'a retired field cannot be amended either',
    pg_temp.req_sql('R1', A, 'priority', pg_temp.val(A, array['priority']), '{"priority": "low"}', 'r'), 'SETUP_FIELD_RETIRED');
end $s07$;

/* ============================ 08. Project Type =========================== */

select pg_temp.act(pg_temp.id('P_PCA'));
do $s08p$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_fail(8, '08 PROJECT TYPE', 'a Project Control Admin cannot correct the Project Type',
    format('select public.correct_project_structure_family(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L, %L::uuid, null, %L)',
           A, A, 'other', pg_temp.id('T_INSP'), 'try'), 'NOT_AUTHORIZED');
  perform pg_temp.must_fail(8, '08 PROJECT TYPE', 'the Project Type is not amendable (System Administrator correction only)',
    pg_temp.req_sql('PT1', A, 'structure_family', '{"structure_family": "psm"}', '{"structure_family": "other"}', 'r'), 'FIELD_NOT_AMENDABLE');
end $s08p$;
do $s08$
declare O uuid := pg_temp.project('ZZ-139B-OTH');
begin
  perform pg_temp.chk(8, '08 PROJECT TYPE', 'the System Administrator correction on a Controlled project kept its own audit row',
    exists (select 1 from public.project_classification_corrections
             where project_id = O and old_family = 'other' and new_family = 'psm' and reason = 'Misclassified at creation'));
  perform pg_temp.chk(8, '08 PROJECT TYPE', 'and wrote no amendment row and no field-change row (not duplicated)',
    not exists (select 1 from public.project_setup_amendments where project_id = O and field_key in ('structure_family', 'project_category') and status <> 'stale')
    and not exists (select 1 from public.project_setup_field_changes where project_id = O));
end $s08$;

select pg_temp.act(pg_temp.id('P_X'));
do $s08l$
declare L uuid := pg_temp.project('ZZ-139B-LGC');
begin
  perform pg_temp.chk(8, '08 PROJECT TYPE', 'LGC is a Controlled legacy project (no Project Type yet)',
    public.project_setup_controlled(L) and (select structure_family is null from public.projects where id = L));
  -- Owner closure 2026-10-17 (applied by 20261017090000): once Controlled, a
  -- legacy project is classified only by the System Administrator bootstrap
  -- (proved in 124), never through Project Setup.
  perform pg_temp.must_fail(8, '08 PROJECT TYPE', 'its classification through Project Setup is refused once Controlled (System Administrator bootstrap only)',
    pg_temp.patch_sql(L, '{"structure_family": "psm", "project_type_id": null, "project_category_detail": null}'), 'SETUP_CONTROLLED');
  perform pg_temp.chk(8, '08 PROJECT TYPE', 'nothing changed and nothing was logged',
    (select structure_family is null from public.projects where id = L)
    and not exists (select 1 from public.project_setup_field_changes where project_id = L));
end $s08l$;

/* ======================= 09. onboarding transitions ====================== */

do $s09$
declare
  A uuid := pg_temp.project('ZZ-139B-ACT');
  L uuid := pg_temp.project('ZZ-139B-LGC');
  v_upsert text := 'insert into public.project_planning_settings (project_id, onboarding_mode%s) values (%L, %L%s) on conflict (project_id) do update set onboarding_mode = excluded.onboarding_mode%s';
begin
  perform pg_temp.must_pass(9, '09 ONBOARDING', 'the app''s same-mode upsert (with default_import_source) passes on a Controlled project',
    format(v_upsert, ', default_import_source', A, 'new_project', ', ''p6''', ', default_import_source = excluded.default_import_source'));
  perform pg_temp.must_pass(9, '09 ONBOARDING', 'a first settings row with the default mode passes on a Controlled project without one',
    format(v_upsert, '', L, 'new_project', '', ''));
  perform pg_temp.must_fail(9, '09 ONBOARDING', 'with a snapshot: new_project -> existing_active_project is refused (upsert)',
    format(v_upsert, '', A, 'existing_active_project', '', ''), 'ONBOARDING_TRANSITION_PROHIBITED');
  perform pg_temp.must_fail(9, '09 ONBOARDING', 'with a snapshot: new_project -> no_formal_schedule is refused (update)',
    format('update public.project_planning_settings set onboarding_mode = %L where project_id = %L', 'no_formal_schedule', A),
    'ONBOARDING_TRANSITION_PROHIBITED');
  perform pg_temp.must_fail(9, '09 ONBOARDING', 'with a snapshot: an amendment request for a prohibited transition is refused',
    pg_temp.req_sql('OB1', A, 'onboarding_mode', '{"onboarding_mode": "new_project"}', '{"onboarding_mode": "existing_active_project"}', 'r'),
    'ONBOARDING_TRANSITION_PROHIBITED');
  perform pg_temp.chk(9, '09 ONBOARDING', 'the transition rule matches B18 for a project with a snapshot',
    public.project_onboarding_transition_rule(A, 'no_formal_schedule', 'new_project') = 'governed'
    and public.project_onboarding_transition_rule(A, 'no_formal_schedule', 'existing_active_project') = 'governed'
    and public.project_onboarding_transition_rule(A, 'new_project', 'no_formal_schedule') = 'prohibited'
    and public.project_onboarding_transition_rule(A, 'existing_active_project', 'no_formal_schedule') = 'prohibited'
    and public.project_onboarding_transition_rule(A, 'new_project', 'existing_active_project') = 'prohibited'
    and public.project_onboarding_transition_rule(A, 'existing_active_project', 'new_project') = 'prohibited'
    and public.project_onboarding_transition_rule(A, 'new_project', 'new_project') = 'unchanged'
    and public.project_onboarding_transition_rule(pg_temp.project('ZZ-139B-FREE'), 'new_project', 'no_formal_schedule') = 'free');
end $s09$;
do $s09l$
declare
  G uuid := pg_temp.project('ZZ-139B-LEG');
  v_snap text := (select md5(string_agg(to_jsonb(s)::text, '|' order by version)) from public.planning_snapshots s
                   where project_id = pg_temp.project('ZZ-139B-LEG'));
begin
  perform pg_temp.chk(9, '09 ONBOARDING', 'LEG (legacy: no_formal_schedule with a snapshot) is Controlled',
    public.project_setup_controlled(G));
  perform pg_temp.must_fail(9, '09 ONBOARDING', 'no_formal_schedule -> new_project as a direct edit is refused',
    format('update public.project_planning_settings set onboarding_mode = %L where project_id = %L', 'new_project', G), 'SETUP_CONTROLLED');
  perform pg_temp.must_pass(9, '09 ONBOARDING', 'it is requested as a governed amendment',
    pg_temp.req_sql('OB_LEG', G, 'onboarding_mode', '{"onboarding_mode": "no_formal_schedule"}', '{"onboarding_mode": "new_project"}', 'Contractor schedule received'));
  perform pg_temp.chk(9, '09 ONBOARDING', 'pending, mode unchanged',
    (select status = 'pending' and amendment_class = 'governed' from pg_temp.amend('OB_LEG'))
    and (select onboarding_mode from public.project_planning_settings where project_id = G) = 'no_formal_schedule');
  insert into ids(key, note) values ('LEG_SNAP', v_snap);
end $s09l$;

select pg_temp.act(pg_temp.id('P_PCA'));
do $s09a$
declare G uuid := pg_temp.project('ZZ-139B-LEG');
begin
  perform pg_temp.must_pass(9, '09 ONBOARDING', 'a Project Control Admin approves no_formal_schedule -> new_project',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('OB_LEG'), 'approve'));
  perform pg_temp.chk(9, '09 ONBOARDING', 'the mode is applied; the snapshot history is byte-for-byte unchanged',
    (select onboarding_mode from public.project_planning_settings where project_id = G) = 'new_project'
    and (select md5(string_agg(to_jsonb(s)::text, '|' order by version)) from public.planning_snapshots s where project_id = G)
        = (select note from ids where key = 'LEG_SNAP'));
end $s09a$;
select pg_temp.act(pg_temp.id('P_X'));
do $s09b$
declare G uuid := pg_temp.project('ZZ-139B-LEG');
begin
  perform pg_temp.must_fail(9, '09 ONBOARDING', 'the way back (new_project -> no_formal_schedule) is now prohibited',
    format('update public.project_planning_settings set onboarding_mode = %L where project_id = %L', 'no_formal_schedule', G),
    'ONBOARDING_TRANSITION_PROHIBITED');
end $s09b$;

/* ============================ 10. publish guards ========================= */

do $s10$
declare N uuid := pg_temp.project('ZZ-139B-NFS');
begin
  perform pg_temp.must_fail(10, '10 PUBLISH', 'no_formal_schedule: publish is refused even with the confirmation',
    pg_temp.publish_sql(N, true), 'NO_FORMAL_SCHEDULE');
  perform pg_temp.must_fail(10, '10 PUBLISH', 'no_formal_schedule: Opening Position promotion is refused',
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_opening_position_id => %L::uuid, p_confirm_setup_control => true)',
           N, pg_temp.id('NFS_OP')), 'NO_FORMAL_SCHEDULE');
  perform pg_temp.chk(10, '10 PUBLISH', 'nothing was published or promoted; NFS stays not Controlled',
    not exists (select 1 from public.planning_snapshots where project_id = N)
    and (select status from public.planning_opening_positions where id = pg_temp.id('NFS_OP')) = 'draft'
    and not public.project_setup_controlled(N));
  perform pg_temp.must_fail(10, '10 PUBLISH', 'operations authority unchanged: X cannot publish on X2P',
    pg_temp.publish_sql(pg_temp.project('ZZ-139B-X2P'), true), '42501');
end $s10$;

select pg_temp.act(pg_temp.id('P_Y'));
do $s10y$
begin
  perform pg_temp.must_fail(10, '10 PUBLISH', 'operations authority unchanged: the Reporting Coordinator cannot publish',
    pg_temp.publish_sql(pg_temp.project('ZZ-139B-ACT'), true), '42501');
end $s10y$;

/* =============================== 11. authority =========================== */

do $s11y$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'Reporting Coordinator: amendment request refused',
    pg_temp.req_sql('U1', A, 'name', pg_temp.val(A, array['name']), '{"name": "ZZ y"}', 'r'), 'NOT_AUTHORIZED');
  perform pg_temp.chk(11, '11 AUTHORITY', 'Reporting Coordinator can read the project''s amendment history',
    (select count(*) from public.project_setup_amendments where project_id = A) >= 6
    and (select count(*) from public.project_setup_field_changes where project_id = A) >= 1);
end $s11y$;

select pg_temp.act(pg_temp.id('P_X2'));
do $s11x2$
declare
  A uuid := pg_temp.project('ZZ-139B-ACT');
  P uuid := pg_temp.project('ZZ-139B-X2P');
begin
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'assigned Project Control on ANOTHER project: request refused here',
    pg_temp.req_sql('U3', A, 'name', '{"name": "ZZ 13.9B ACT v2"}', '{"name": "ZZ x2"}', 'r'), 'NOT_AUTHORIZED');
  perform pg_temp.must_pass(11, '11 AUTHORITY', 'the same user amends their own assigned project',
    pg_temp.req_sql('X2_NAME', P, 'name', pg_temp.val(P, array['name']), '{"name": "ZZ 13.9B X2P v2"}', 'Rename'));
  perform pg_temp.must_pass(11, '11 AUTHORITY', 'and requests a governed change there',
    pg_temp.req_sql('X2_CODE', P, 'code', pg_temp.val(P, array['code']), '{"code": "ZZ-139B-X2P-B"}', 'Re-numbering'));
end $s11x2$;

select pg_temp.act(pg_temp.id('P_V'));
do $s11v$
declare A uuid := pg_temp.project('ZZ-139B-ACT');
begin
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'plain viewer (no project role): amendment request refused',
    pg_temp.req_sql('U2', A, 'name', '{"name": "ZZ 13.9B ACT v2"}', '{"name": "ZZ v"}', 'r'), 'NOT_AUTHORIZED');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'plain viewer: deciding a pending request is refused',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('X2_CODE'), 'approve'), 'NOT_AUTHORIZED');
  perform pg_temp.chk(11, '11 AUTHORITY', 'plain viewer without project access reads no amendment rows',
    (select count(*) from public.project_setup_amendments where project_id = A) = 0);
end $s11v$;

select pg_temp.act(pg_temp.id('P_X'));
do $s11x$
begin
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'assigned Project Control (not a global authority) cannot decide',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('X2_CODE'), 'approve'), 'NOT_AUTHORIZED');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'direct INSERT into project_setup_amendments is refused for a client',
    format('insert into public.project_setup_amendments (project_id, field_key, amendment_class, previous_value, proposed_value, reason, impact_warning, requested_by, status, applied_transaction_id) values (%L, %L, %L, %L, %L, %L, %L, %L, %L, pg_current_xact_id())',
           pg_temp.project('ZZ-139B-ACT'), 'code', 'lightweight', '{"code": "a"}', '{"code": "b"}', 'r', 'w', pg_temp.id('P_X'), 'applied'), '42501');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'direct INSERT into project_setup_field_changes is refused for a client',
    format('insert into public.project_setup_field_changes (project_id, field_key, previous_value, new_value) values (%L, %L, %L, %L)',
           pg_temp.project('ZZ-139B-ACT'), 'city', '{"city": "a"}', '{"city": "b"}'), '42501');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'internal apply function is not callable by a client',
    format('select public.project_setup_apply_value(%L, %L, %L)', pg_temp.project('ZZ-139B-ACT'), 'code', '{"code": "HACK"}'), '42501');
end $s11x$;

select pg_temp.act(pg_temp.id('P_SA'));
do $s11sa$
begin
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'direct UPDATE of an amendment is refused for the System Administrator (no grant)',
    format('update public.project_setup_amendments set status = %L where id = %L', 'approved', pg_temp.id('X2_CODE')), '42501');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'direct DELETE of an amendment is refused for the System Administrator (no grant)',
    format('delete from public.project_setup_amendments where id = %L', pg_temp.id('L_NAME')), '42501');
end $s11sa$;

select pg_temp.owner();
do $s11o$
begin
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'owner: a decided amendment cannot be edited (history guard)',
    format('update public.project_setup_amendments set reason = %L where id = %L', 'rewritten', pg_temp.id('G_CODE')), 'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'owner: a pending amendment''s request columns cannot be edited',
    format('update public.project_setup_amendments set proposed_value = %L where id = %L', '{"code": "ZZ-OTHER"}', pg_temp.id('X2_CODE')), 'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'owner: an amendment cannot be deleted',
    format('delete from public.project_setup_amendments where id = %L', pg_temp.id('L_NAME')), 'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'owner: a field-change row cannot be edited',
    format('update public.project_setup_field_changes set new_value = %L where project_id = %L', '{"city": "x"}', pg_temp.project('ZZ-139B-ACT')), 'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'owner: a field-change row cannot be deleted',
    format('delete from public.project_setup_field_changes where project_id = %L', pg_temp.project('ZZ-139B-ACT')), 'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'owner: a self-approval cannot be forged by an UPDATE (constraint)',
    format('update public.project_setup_amendments set status = %L, decided_by = requested_by, decided_at = now(), applied_transaction_id = pg_current_xact_id() where id = %L',
           'approved', pg_temp.id('X2_CODE')), '23514');
end $s11o$;

/* ========================== 12. archived (B24) =========================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s12r$
declare R uuid := pg_temp.project('ZZ-139B-ARC');
begin
  perform pg_temp.must_pass(12, '12 ARCHIVED', 'before archiving: a governed request is left pending on ARC',
    pg_temp.req_sql('ARC_CODE', R, 'code', pg_temp.val(R, array['code']), '{"code": "ZZ-139B-ARC-NEW"}', 'Re-numbering'));
  perform pg_temp.must_pass(12, '12 ARCHIVED', 'before archiving: a lightweight amendment is applied on ARC',
    pg_temp.req_sql('ARC_NAME', R, 'name', pg_temp.val(R, array['name']), '{"name": "ZZ 13.9B ARC v2"}', 'Rename'));
end $s12r$;

select pg_temp.owner();
do $s12a$
declare R uuid := pg_temp.project('ZZ-139B-ARC');
begin
  insert into ids(key, note) values ('ARC_PRINT',
    (select md5(string_agg(to_jsonb(a)::text, '|' order by a.requested_at, a.id)) from public.project_setup_amendments a where a.project_id = R));
  update public.projects set status = 'archived', active = false, archived_at = now() where id = R;
  perform pg_temp.chk(12, '12 ARCHIVED', 'archiving a Controlled project with a pending request works and is logged as a status change',
    (select status from public.projects where id = R) = 'archived'
    and exists (select 1 from public.project_setup_field_changes where project_id = R and field_key = 'status'
                 and new_value = '{"status": "archived"}'));
end $s12a$;

do $s12$
declare
  R uuid := pg_temp.project('ZZ-139B-ARC');
  v_actor text;
begin
  foreach v_actor in array array['P_X', 'P_PCA', 'P_SA'] loop
    perform pg_temp.act(pg_temp.id(v_actor));
    perform pg_temp.must_fail(12, '12 ARCHIVED', v_actor || ': a new amendment request is refused',
      pg_temp.req_sql('ARC_X', R, 'short_name', pg_temp.val(R, array['short_name']), '{"short_name": "ZZ"}', 'r'), 'PROJECT_ARCHIVED');
    perform pg_temp.must_fail(12, '12 ARCHIVED', v_actor || ': approving the pending request is refused',
      format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('ARC_CODE'), 'approve'), 'PROJECT_ARCHIVED');
    perform pg_temp.must_fail(12, '12 ARCHIVED', v_actor || ': rejecting the pending request is refused',
      format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('ARC_CODE'), 'reject', 'no'), 'PROJECT_ARCHIVED');
    perform pg_temp.must_fail(12, '12 ARCHIVED', v_actor || ': withdrawing the pending request is refused',
      format('select public.withdraw_project_setup_amendment(%L)', pg_temp.id('ARC_CODE')), 'PROJECT_ARCHIVED');
    perform pg_temp.must_fail(12, '12 ARCHIVED', v_actor || ': a free setup edit is refused',
      pg_temp.patch_sql(R, '{"city": "Cairo"}'), 'PROJECT_ARCHIVED');
    perform pg_temp.must_fail(12, '12 ARCHIVED', v_actor || ': publish is refused (archived answers first)',
      pg_temp.publish_sql(R, true), 'PROJECT_ARCHIVED');
  end loop;
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.chk(12, '12 ARCHIVED', 'history stays readable: the pending request (still pending) and the applied amendment',
    (select count(*) from public.project_setup_amendments where project_id = R) = 2
    and (select status from public.project_setup_amendments where id = pg_temp.id('ARC_CODE')) = 'pending');
  perform pg_temp.owner();
  perform pg_temp.must_fail(12, '12 ARCHIVED', 'owner: the pending request on an archived project cannot be updated either',
    format('update public.project_setup_amendments set status = %L, decided_at = now(), decision_comment = %L where id = %L',
           'stale', 'x', pg_temp.id('ARC_CODE')), 'PROJECT_ARCHIVED');
  perform pg_temp.chk(12, '12 ARCHIVED', 'the archived project''s amendment rows are byte-for-byte unchanged (B24)',
    (select md5(string_agg(to_jsonb(a)::text, '|' order by a.requested_at, a.id)) from public.project_setup_amendments a where a.project_id = R)
    = (select note from ids where key = 'ARC_PRINT'));
end $s12$;

/* ================================ 13. catalog ============================ */

select pg_temp.owner();
do $s13$
begin
  perform pg_temp.chk(13, '13 CATALOG', 'every projects column is classified by the registry or is a system column',
    not exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name = 'projects'
                   and not exists (select 1 from public.project_setup_field_registry() r
                                    where r.kind = 'column' and r.target_table = 'projects' and c.column_name::text = any (r.target_columns))
                   and not (c.column_name::text = any (array['id', 'active', 'archived_at', 'created_at', 'updated_at']))));
  perform pg_temp.chk(13, '13 CATALOG', 'the registry uses only the seven approved classes; enforced future states are recorded, not active',
    (select bool_and(field_class in ('free_logged', 'lightweight', 'governed', 'system_admin_correction', 'retired'))
       from public.project_setup_field_registry())
    and (select future_class from public.project_setup_field_registry() where field_key = 'forecast_finish_date') = 'planning_owned'
    and (select future_class from public.project_setup_field_registry() where field_key = 'planned_start_date') = 'superseded'
    and (select field_class from public.project_setup_field_registry() where field_key = 'forecast_finish_date') = 'governed');
  perform pg_temp.chk(13, '13 CATALOG', 'structure renames and scope are governed relations (Step 4); display order and notes free',
    (select string_agg(field_key || ':' || field_class, ',' order by field_key) from public.project_setup_field_registry()
      where field_key like 'structure\_%' and kind = 'relation')
    = 'structure_departments:governed,structure_disciplines:governed,structure_display_order:free_logged,structure_levels:governed,structure_notes:free_logged,structure_units:governed');
  perform pg_temp.chk(13, '13 CATALOG', 'projects: the archived guard answers before the setup-controlled guard',
    exists (select 1 from pg_trigger where tgname = 'block_archived_project_setup' and tgrelid = 'public.projects'::regclass)
    and 'block_archived_project_setup' < 'guard_project_setup_controlled'
    and exists (select 1 from pg_trigger where tgname = 'guard_project_setup_controlled' and tgrelid = 'public.projects'::regclass));
  perform pg_temp.chk(13, '13 CATALOG', 'settings: the 13.9 archived planning guard answers before the onboarding guard',
    exists (select 1 from pg_trigger where tgname = 'guard_onboarding_mode_setup_controlled'
             and tgrelid = 'public.project_planning_settings'::regclass)
    and 'block_archived_project_planning' < 'guard_onboarding_mode_setup_controlled');
  perform pg_temp.chk(13, '13 CATALOG', 'one publish_planning_snapshot() overload, with p_confirm_setup_control',
    (select count(*) from pg_proc where proname = 'publish_planning_snapshot' and pronamespace = 'public'::regnamespace) = 1
    and to_regprocedure('public.publish_planning_snapshot(uuid,uuid,uuid,boolean,text,uuid,date,boolean)') is not null);
  perform pg_temp.chk(13, '13 CATALOG', 'internal functions are not callable by anon, authenticated or service_role',
    not has_function_privilege('authenticated', 'public.project_setup_apply_value(uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.project_setup_apply_value(uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.project_setup_field_value(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_project_setup_controlled()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.request_project_setup_amendment(uuid,text,jsonb,jsonb,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.request_project_setup_amendment(uuid,text,jsonb,jsonb,text)', 'EXECUTE'));
  perform pg_temp.chk(13, '13 CATALOG', 'no client role can write either governance table; anon cannot read them',
    not has_table_privilege('authenticated', 'public.project_setup_amendments', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('service_role', 'public.project_setup_amendments', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.project_setup_field_changes', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('anon', 'public.project_setup_amendments', 'SELECT')
    and not has_table_privilege('anon', 'public.project_setup_field_changes', 'SELECT'));
  perform pg_temp.chk(13, '13 CATALOG', 'can_manage_project_operations() is byte-for-byte unchanged (pre-13.9 fingerprint)',
    (select md5(prosrc) from pg_proc where oid = 'public.can_manage_project_operations(uuid)'::regprocedure)
    = '05c5f58290be4341497507fffc05c2a0');
  perform pg_temp.chk(13, '13 CATALOG', 'the eight 2C.3E block_archived_project_setup guards are unchanged in number',
    (select count(*) from pg_trigger where tgname = 'block_archived_project_setup') = 8);
end $s13$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;
