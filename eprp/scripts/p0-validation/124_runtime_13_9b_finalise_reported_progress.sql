-- Phase 13.9B — Project Setup Governance — Step 2: Setup Finalisation and the
-- Reported Progress stream — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261017090000_project_setup_finalise_reported_progress.sql against
-- real PostgreSQL, real RLS and real authenticated roles. Everything —
-- fixtures, accounts and every write — runs in ONE transaction that is ROLLED
-- BACK. Nothing persists.
--
--   01  Finalise authority: System Administrator, Project Control Admin and
--       the assigned Project Control may finalise; an unassigned Project
--       Control, the Reporting Coordinator, a department user and an ordinary
--       member may not; the explicit confirmation is required
--   02  Finalise rules: wrong onboarding mode, already Controlled, duplicate,
--       archived; Controlled is derived from the finalisation (and from the
--       earlier anchor); no snapshot / PV / EV / SPI is created; immutable and
--       irreversible
--   03  Reported Progress: not before Finalise; original report; optional
--       planned %; value validation; future Data Date; same-date duplicate;
--       back-dating against the latest VALID Data Date
--   04  Chain: correction and withdrawal need a reason; only the current head
--       can be superseded; a withdrawal is final; heads and the latest valid
--       position; superseded history readable; no cycle, no cross-project chain
--   05  Concurrency: with every pre-check bypassed (owner inserts, the entry
--       trigger disabled), the unique constraints still refuse a second
--       finalisation, a second same-date report, a second correction of one
--       head and a correction-vs-withdrawal race; the writers serialise
--   06  Eligibility: planning-governed mode, snapshot present, onboarding
--       transition to a planned mode (history kept, writes refused, Setup
--       stays Controlled, publish then needs no confirmation), authority
--       across projects and roles, no SPI anywhere
--   07  Archived: Finalise and every Reported Progress write refused for every
--       role and the owner; history byte-for-byte unchanged and readable
--   08  Legacy classification bootstrap (owner closure 2026-10-17): a
--       Controlled legacy project is classified once by the System
--       Administrator correction, recorded once in the classification history,
--       never as an amendment; afterwards the normal rules apply
--   09  Catalog: guard order, grants, internal functions, no un-finalise path
--
-- HOW TO RUN (after the migration is applied; from eprp/; the APP database):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/124_runtime_13_9b_finalise_reported_progress.sql

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

create or replace function pg_temp.id(p_key text) returns uuid
language sql as $$ select id from ids where key = p_key $$;
create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select coalesce((select id from ids where key = 'PRJ:' || p_code),
                                   (select id from public.projects where code = p_code)) $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp join public.projects p on p.id = pp.project_id
                    where p.code = p_code and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.entry(p_key text) returns public.project_reported_progress
language sql as $$ select * from public.project_reported_progress where id = (select id from ids where key = p_key) $$;

create or replace function pg_temp.fin_sql(p_project uuid, p_confirm boolean, p_ack text, p_note text default null) returns text
language sql as $$
  select format('select public.finalise_project_setup(%L::uuid, %L, %L, %L)', p_project, p_confirm, p_ack, p_note)
$$;
create or replace function pg_temp.rec_sql(
  p_key text, p_project uuid, p_date date, p_actual numeric, p_narrative text,
  p_planned numeric default null, p_reason text default null
) returns text language sql as $$
  select format('insert into ids(key, id) select %L, (public.record_reported_progress(%L::uuid, %L::date, %L::numeric, %L, %L::numeric, %L)).id',
                p_key, p_project, p_date, p_actual, p_narrative, p_planned, p_reason)
$$;
create or replace function pg_temp.cor_sql(
  p_key text, p_entry text, p_actual numeric, p_narrative text, p_reason text, p_planned numeric default null
) returns text language sql as $$
  select format('insert into ids(key, id) select %L, (public.correct_reported_progress(%L::uuid, %L::numeric, %L, %L, %L::numeric)).id',
                p_key, pg_temp.id(p_entry), p_actual, p_narrative, p_reason, p_planned)
$$;
create or replace function pg_temp.wd_sql(p_key text, p_entry text, p_reason text) returns text
language sql as $$
  select format('insert into ids(key, id) select %L, (public.withdraw_reported_progress(%L::uuid, %L)).id',
                p_key, pg_temp.id(p_entry), p_reason)
$$;
create or replace function pg_temp.publish_sql(p_project uuid, p_confirm boolean, p_date date default '2026-10-10') returns text
language sql as $$
  select format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => %L)',
                p_project, p_date, p_confirm)
$$;
create or replace function pg_temp.patch_sql(p_project uuid, p_columns jsonb) returns text
language sql as $$
  select format('select public.save_project_setup_patch(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L::jsonb, %L::jsonb)',
                p_project, p_project, p_columns, '{}'::jsonb)
$$;
create or replace function pg_temp.stream_print(p uuid) returns text language sql as $$
  select md5(coalesce(string_agg(to_jsonb(e)::text, '|' order by e.recorded_at, e.id), '')
             || coalesce((select to_jsonb(f)::text from public.project_setup_finalisations f where f.project_id = p), ''))
    from public.project_reported_progress e where e.project_id = p
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
  if to_regprocedure('public.finalise_project_setup(uuid,boolean,text,text)') is null then
    raise exception 'finalise_project_setup() not found — apply 20261017090000_project_setup_finalise_reported_progress.sql first.';
  end if;
  insert into ids(key, id) values ('T_INSP', v_insp), ('T_PIPE', v_pipe);

  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-139C-' || v.s, 'ZZ 13.9B-2 ' || v.s, p.client_id, '2026-01-01', '2027-06-30', 'active', 'psm'
    from public.projects p,
         (values ('NF'), ('NF2'), ('NF3'), ('NF4'), ('NFX'), ('GOV'), ('SNP'), ('ARC'), ('ARC0'), ('TRN')) v(s)
   where p.id = v_template;
  -- Legacy (NULL Project Type) projects: LGC becomes Controlled; LGN and LGM do not.
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, project_type_id)
  select 'ZZ-139C-' || v.s, 'ZZ 13.9B-2 ' || v.s, p.client_id, '2026-01-01', '2027-06-30', 'active', v_insp
    from public.projects p, (values ('LGC'), ('LGN'), ('LGM')) v(s)
   where p.id = v_template;
  insert into ids(key, id) select 'PRJ:' || code, id from public.projects where code like 'ZZ-139C-%';

  -- X = assigned Project Control everywhere but NFX; X2 = assigned on NFX only;
  -- Y = Reporting Coordinator; D = a department user who is a member;
  -- M = an ordinary member; PCA = Project Control Admin; SA = existing.
  insert into public.contacts (name, email, active)
  select 'ZZ 139C ' || s, 'zz.139c.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('X2'), ('Y'), ('D'), ('M'), ('PCA')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-c000-000000139c' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.139c.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('X2', '02'), ('Y', '03'), ('D', '04'), ('M', '05'), ('PCA', '06')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-c000-000000139c' || v.n)::uuid, 'zz.139c.' || lower(v.s) || '@example.invalid',
         'ZZ 139C ' || v.s, v.role, pg_temp.person('ZZ 139C ' || v.s), true
    from (values ('X', '01', 'viewer'), ('X2', '02', 'viewer'), ('Y', '03', 'viewer'),
                 ('D', '04', 'department_user'), ('M', '05', 'viewer'), ('PCA', '06', 'project_control_admin')) v(s, n, role);
  insert into ids(key, id) values
    ('P_X', '00000000-0000-4000-c000-000000139c01'), ('P_X2', '00000000-0000-4000-c000-000000139c02'),
    ('P_Y', '00000000-0000-4000-c000-000000139c03'), ('P_D', '00000000-0000-4000-c000-000000139c04'),
    ('P_M', '00000000-0000-4000-c000-000000139c05'), ('P_PCA', '00000000-0000-4000-c000-000000139c06'),
    ('P_SA', (select id from public.profiles where role = 'system_admin' and active and contact_id is not null
               order by created_at limit 1));
  if pg_temp.id('P_SA') is null then
    raise exception 'No active System Administrator with a contact exists in the local dataset.';
  end if;

  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-139C-' || p.s), pg_temp.person('ZZ 139C ' || m.s), pg_temp.party('ZZ-139C-' || p.s, 'eprom'), m.role
    from (values ('NF'), ('NF2'), ('NF3'), ('NF4'), ('GOV'), ('SNP'), ('ARC'), ('ARC0'), ('TRN'), ('LGC'), ('LGN')) p(s),
         (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator'), ('D', 'Discipline Engineer'), ('M', 'Engineer')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-139C-' || p.s), pg_temp.person('ZZ 139C ' || m.s), m.role
    from (values ('NF'), ('NF2'), ('NF3'), ('NF4'), ('GOV'), ('SNP'), ('ARC'), ('ARC0'), ('TRN'), ('LGC'), ('LGN')) p(s),
         (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects
     set project_control_manager_id = pg_temp.person('ZZ 139C X'), reporting_coordinator_id = pg_temp.person('ZZ 139C Y')
   where code like 'ZZ-139C-%' and code not in ('ZZ-139C-NFX', 'ZZ-139C-LGM');
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  values (pg_temp.project('ZZ-139C-NFX'), pg_temp.person('ZZ 139C X2'), pg_temp.party('ZZ-139C-NFX', 'eprom'), 'Project Controls');
  insert into public.project_contacts (project_id, contact_id, role)
  values (pg_temp.project('ZZ-139C-NFX'), pg_temp.person('ZZ 139C X2'), 'project_control_manager');
  update public.projects set project_control_manager_id = pg_temp.person('ZZ 139C X2') where code = 'ZZ-139C-NFX';

  insert into public.project_planning_settings (project_id, onboarding_mode)
  select pg_temp.project('ZZ-139C-' || v.s), v.mode
    from (values ('NF', 'no_formal_schedule'), ('NF2', 'no_formal_schedule'), ('NF3', 'no_formal_schedule'),
                 ('NF4', 'no_formal_schedule'), ('NFX', 'no_formal_schedule'), ('GOV', 'new_project'),
                 ('SNP', 'no_formal_schedule'), ('ARC', 'no_formal_schedule'), ('ARC0', 'no_formal_schedule'),
                 ('TRN', 'no_formal_schedule')) v(s, mode);

  -- SNP: legacy no_formal + snapshot. LGC: legacy NULL Project Type, Controlled by a snapshot.
  insert into public.planning_snapshots (project_id, version, snapshot_data, data_date)
  values (pg_temp.project('ZZ-139C-SNP'), 1, '{}'::jsonb, '2026-09-30'),
         (pg_temp.project('ZZ-139C-LGC'), 1, '{}'::jsonb, '2026-09-30');
  -- ARC0 is archived before it is ever finalised.
  update public.projects set status = 'archived', active = false, archived_at = now() where code = 'ZZ-139C-ARC0';
end;
$fix$;

/* ======================== 01. Finalise authority ========================= */

do $s01$
declare
  N uuid := pg_temp.project('ZZ-139C-NF');
  v_actor text;
begin
  foreach v_actor in array array['P_Y', 'P_D', 'P_M', 'P_X2'] loop
    perform pg_temp.act(pg_temp.id(v_actor));
    perform pg_temp.must_fail(1, '01 FINALISE AUTHORITY', v_actor || ' cannot finalise (RC / department user / member / unassigned Project Control)',
      pg_temp.fin_sql(N, true, 'Core setup becomes controlled.'), 'NOT_AUTHORIZED');
  end loop;
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.chk(1, '01 FINALISE AUTHORITY', 'before Finalise, NF is not Controlled',
    not public.project_setup_controlled(N));
  perform pg_temp.must_fail(1, '01 FINALISE AUTHORITY', 'without the confirmation Finalise is refused',
    pg_temp.fin_sql(N, false, 'Core setup becomes controlled.'), 'FINALISE_CONFIRMATION_REQUIRED');
  perform pg_temp.must_fail(1, '01 FINALISE AUTHORITY', 'with a blank acknowledgement Finalise is refused',
    pg_temp.fin_sql(N, true, '  '), 'FINALISE_CONFIRMATION_REQUIRED');
  perform pg_temp.must_pass(1, '01 FINALISE AUTHORITY', 'the assigned Project Control finalises NF',
    pg_temp.fin_sql(N, true, 'Core Project Setup becomes controlled; the project stays Reported - not planning governed.', 'Client confirmed no schedule'));
end $s01$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s01p$ begin
  perform pg_temp.must_pass(1, '01 FINALISE AUTHORITY', 'a Project Control Admin finalises NF2',
    pg_temp.fin_sql(pg_temp.project('ZZ-139C-NF2'), true, 'Core setup becomes controlled.'));
end $s01p$;
select pg_temp.act(pg_temp.id('P_SA'));
do $s01s$ begin
  perform pg_temp.must_pass(1, '01 FINALISE AUTHORITY', 'the System Administrator finalises NF3',
    pg_temp.fin_sql(pg_temp.project('ZZ-139C-NF3'), true, 'Core setup becomes controlled.'));
end $s01s$;
select pg_temp.act(pg_temp.id('P_X2'));
do $s01x2$ begin
  perform pg_temp.must_pass(1, '01 FINALISE AUTHORITY', 'X2 finalises their own assigned project NFX',
    pg_temp.fin_sql(pg_temp.project('ZZ-139C-NFX'), true, 'Core setup becomes controlled.'));
end $s01x2$;

/* ========================== 02. Finalise rules =========================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s02$
declare
  N uuid := pg_temp.project('ZZ-139C-NF');
  f public.project_setup_finalisations;
begin
  select * into f from public.project_setup_finalisations where project_id = N;
  perform pg_temp.chk(2, '02 FINALISE RULES', 'the record: mode, before / after meaning, acknowledgement, note, actor, provenance',
    f.onboarding_mode_at_finalisation = 'no_formal_schedule' and f.state_before = 'not_controlled'
    and f.state_after = 'controlled' and f.acknowledgement like 'Core Project Setup becomes controlled%'
    and f.note = 'Client confirmed no schedule' and f.finalised_by = pg_temp.id('P_X')
    and f.finalised_by_name = 'ZZ 139C X' and f.source = 'project_setup' and f.transaction_id = pg_current_xact_id());
  perform pg_temp.chk(2, '02 FINALISE RULES', 'Finalisation makes the project Controlled, since its finalised_at',
    public.project_setup_controlled(N) and public.project_setup_controlled_since(N) = f.finalised_at);
  perform pg_temp.chk(2, '02 FINALISE RULES', 'no snapshot, Opening Position or other planning record was created (no PV / EV / SPI)',
    not exists (select 1 from public.planning_snapshots where project_id = N)
    and not exists (select 1 from public.planning_opening_positions where project_id = N)
    and not exists (select 1 from public.planning_baselines where project_id = N)
    and (select onboarding_mode from public.project_planning_settings where project_id = N) = 'no_formal_schedule');
  perform pg_temp.chk(2, '02 FINALISE RULES', 'the earlier anchor wins: SNP (snapshot, no finalisation) is Controlled since its snapshot',
    public.project_setup_controlled_since(pg_temp.project('ZZ-139C-SNP'))
      = (select min(published_at) from public.planning_snapshots where project_id = pg_temp.project('ZZ-139C-SNP')));
  perform pg_temp.must_fail(2, '02 FINALISE RULES', 'a second Finalise is refused (one per project)',
    pg_temp.fin_sql(N, true, 'again'), 'SETUP_ALREADY_FINALISED');
  perform pg_temp.must_fail(2, '02 FINALISE RULES', 'a planned (new_project) project cannot be finalised',
    pg_temp.fin_sql(pg_temp.project('ZZ-139C-GOV'), true, 'x'), 'FINALISE_WRONG_MODE');
  perform pg_temp.must_fail(2, '02 FINALISE RULES', 'an already Controlled project (snapshot) cannot be finalised',
    pg_temp.fin_sql(pg_temp.project('ZZ-139C-SNP'), true, 'x'), 'SETUP_ALREADY_CONTROLLED');
  perform pg_temp.must_fail(2, '02 FINALISE RULES', 'an archived project cannot be finalised',
    pg_temp.fin_sql(pg_temp.project('ZZ-139C-ARC0'), true, 'x'), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(2, '02 FINALISE RULES', 'once finalised, governed setup fields are controlled (Step 1 guard)',
    pg_temp.patch_sql(N, '{"code": "ZZ-139C-NF-NEW"}'), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(2, '02 FINALISE RULES', 'a client cannot insert a finalisation directly',
    format('insert into public.project_setup_finalisations (project_id, onboarding_mode_at_finalisation, acknowledgement, finalised_by) values (%L, %L, %L, %L)',
           pg_temp.project('ZZ-139C-NF4'), 'no_formal_schedule', 'x', pg_temp.id('P_X')), '42501');
end $s02$;

select pg_temp.owner();
do $s02o$
declare N uuid := pg_temp.project('ZZ-139C-NF');
begin
  perform pg_temp.must_fail(2, '02 FINALISE RULES', 'owner: a finalisation cannot be edited (not reversible)',
    format('update public.project_setup_finalisations set note = %L where project_id = %L', 'undo', N), 'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(2, '02 FINALISE RULES', 'owner: a finalisation cannot be deleted (not reversible)',
    format('delete from public.project_setup_finalisations where project_id = %L', N), 'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(2, '02 FINALISE RULES', 'owner: a finalisation of a planned project is refused by the entry trigger',
    format('insert into public.project_setup_finalisations (project_id, onboarding_mode_at_finalisation, acknowledgement, finalised_by) values (%L, %L, %L, %L)',
           pg_temp.project('ZZ-139C-GOV'), 'no_formal_schedule', 'x', pg_temp.id('P_X')), 'FINALISE_WRONG_MODE');
end $s02o$;

/* ====================== 03. Reported Progress basics ===================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s03$
declare N uuid := pg_temp.project('ZZ-139C-NF');
begin
  perform pg_temp.must_fail(3, '03 REPORTED PROGRESS', 'cannot record before Finalise (NF4)',
    pg_temp.rec_sql('E0', pg_temp.project('ZZ-139C-NF4'), '2026-10-01', 10, 'Early'), 'SETUP_NOT_FINALISED');
  perform pg_temp.must_pass(3, '03 REPORTED PROGRESS', 'an original report with planned % succeeds',
    pg_temp.rec_sql('E1', N, '2026-10-01', 20, 'Site works progressing', 25));
  perform pg_temp.chk(3, '03 REPORTED PROGRESS', 'stored as an original report: values, actor, provenance, not back-dated',
    (select entry_kind = 'report' and reported_actual_percent = 20 and reported_planned_percent = 25
            and supersedes_entry_id is null and not is_backdated and source = 'eprp_entry'
            and recorded_by = pg_temp.id('P_X') and recorded_by_name = 'ZZ 139C X' from pg_temp.entry('E1')));
  perform pg_temp.must_pass(3, '03 REPORTED PROGRESS', 'reported planned % is optional',
    pg_temp.rec_sql('E2', N, '2026-10-05', 30, 'Works continue'));
  perform pg_temp.chk(3, '03 REPORTED PROGRESS', 'planned % stored as NULL',
    (select reported_planned_percent is null from pg_temp.entry('E2')));
  perform pg_temp.must_fail(3, '03 REPORTED PROGRESS', 'actual % is required',
    pg_temp.rec_sql('BAD', N, '2026-10-06', null, 'x'), 'INVALID_VALUE');
  perform pg_temp.must_fail(3, '03 REPORTED PROGRESS', 'actual % above 100 is refused',
    pg_temp.rec_sql('BAD', N, '2026-10-06', 120, 'x'), 'INVALID_VALUE');
  perform pg_temp.must_fail(3, '03 REPORTED PROGRESS', 'planned % below 0 is refused',
    pg_temp.rec_sql('BAD', N, '2026-10-06', 10, 'x', -1), 'INVALID_VALUE');
  perform pg_temp.must_fail(3, '03 REPORTED PROGRESS', 'a narrative is required',
    pg_temp.rec_sql('BAD', N, '2026-10-06', 10, ' '), 'NARRATIVE_REQUIRED');
  perform pg_temp.must_fail(3, '03 REPORTED PROGRESS', 'a future Data Date is refused (project time zone)',
    pg_temp.rec_sql('BAD', N, (current_date + 3), 10, 'x'), 'DATA_DATE_IN_FUTURE');
  perform pg_temp.must_fail(3, '03 REPORTED PROGRESS', 'a second original report for the same Data Date is refused',
    pg_temp.rec_sql('BAD', N, '2026-10-01', 22, 'again'), 'REPORTED_PROGRESS_DATE_EXISTS');
  perform pg_temp.must_fail(3, '03 REPORTED PROGRESS', 'a Data Date before the latest valid one needs a reason',
    pg_temp.rec_sql('BAD', N, '2026-09-20', 15, 'Late entry'), 'BACKDATE_REASON_REQUIRED');
  perform pg_temp.must_pass(3, '03 REPORTED PROGRESS', 'with a reason the back-dated report is accepted',
    pg_temp.rec_sql('E3', N, '2026-09-20', 15, 'Late entry', null, 'September figure found in site diary'));
  perform pg_temp.chk(3, '03 REPORTED PROGRESS', 'it is marked back-dated and does not become the latest',
    (select is_backdated and reason like 'September%' from pg_temp.entry('E3'))
    and (select id from public.project_reported_progress_latest(N)) = pg_temp.id('E2'));
end $s03$;

/* ================================ 04. chain ============================== */

do $s04$
declare N uuid := pg_temp.project('ZZ-139C-NF');
begin
  perform pg_temp.must_fail(4, '04 CHAIN', 'a correction needs a reason',
    pg_temp.cor_sql('C1', 'E1', 21, 'Revised count', ' '), 'REASON_REQUIRED');
  perform pg_temp.must_pass(4, '04 CHAIN', 'a correction of the original report succeeds',
    pg_temp.cor_sql('C1', 'E1', 21, 'Revised count', 'Quantity survey corrected', 24));
  perform pg_temp.chk(4, '04 CHAIN', 'the correction points at the original, keeps its Data Date; the original is unchanged',
    (select entry_kind = 'correction' and supersedes_entry_id = pg_temp.id('E1') and data_date = '2026-10-01'
            and reported_actual_percent = 21 from pg_temp.entry('C1'))
    and (select reported_actual_percent = 20 from pg_temp.entry('E1')));
  perform pg_temp.must_fail(4, '04 CHAIN', 'the superseded original cannot be corrected again (not the current head)',
    pg_temp.cor_sql('BAD', 'E1', 22, 'x', 'y'), 'ENTRY_NOT_CURRENT');
  perform pg_temp.must_pass(4, '04 CHAIN', 'the current head (the correction) can be corrected',
    pg_temp.cor_sql('C2', 'C1', 22, 'Final count', 'Second review'));
  perform pg_temp.must_fail(4, '04 CHAIN', 'a superseded correction cannot be withdrawn',
    pg_temp.wd_sql('BAD', 'C1', 'y'), 'ENTRY_NOT_CURRENT');
  perform pg_temp.must_fail(4, '04 CHAIN', 'a withdrawal needs a reason',
    pg_temp.wd_sql('W2', 'E2', ''), 'REASON_REQUIRED');
  perform pg_temp.must_pass(4, '04 CHAIN', 'the 2026-10-05 report is withdrawn with a reason',
    pg_temp.wd_sql('W2', 'E2', 'Reported against the wrong project'));
  perform pg_temp.chk(4, '04 CHAIN', 'the withdrawal carries no values and points at the report',
    (select entry_kind = 'withdrawal' and reported_actual_percent is null and reported_planned_percent is null
            and supersedes_entry_id = pg_temp.id('E2') and data_date = '2026-10-05' from pg_temp.entry('W2')));
  perform pg_temp.must_fail(4, '04 CHAIN', 'a withdrawal is final: it cannot be withdrawn again',
    pg_temp.wd_sql('BAD', 'W2', 'again'), 'ENTRY_WITHDRAWN');
  perform pg_temp.must_fail(4, '04 CHAIN', 'a withdrawal is final: it cannot be corrected',
    pg_temp.cor_sql('BAD', 'W2', 30, 'x', 'restore'), 'ENTRY_WITHDRAWN');
  perform pg_temp.must_fail(4, '04 CHAIN', 'the withdrawn report itself cannot be withdrawn twice',
    pg_temp.wd_sql('BAD', 'E2', 'again'), 'ENTRY_NOT_CURRENT');
  perform pg_temp.chk(4, '04 CHAIN', 'heads: one per Data Date (C2 for 10-01, W2 for 10-05, E3 for 09-20)',
    (select array_agg(id order by data_date) from public.project_reported_progress_heads(N))
    = array[pg_temp.id('E3'), pg_temp.id('C2'), pg_temp.id('W2')]);
  perform pg_temp.chk(4, '04 CHAIN', 'latest valid position = greatest Data Date whose head is not withdrawn (C2, 2026-10-01)',
    (select id from public.project_reported_progress_latest(N)) = pg_temp.id('C2'));
  perform pg_temp.must_pass(4, '04 CHAIN', 'after the withdrawal, 2026-10-03 is not back-dated (latest valid is 10-01)',
    pg_temp.rec_sql('E4', N, '2026-10-03', 26, 'Mid-week figure'));
  perform pg_temp.chk(4, '04 CHAIN', 'E4 not back-dated and now the latest valid position',
    (select not is_backdated from pg_temp.entry('E4'))
    and (select id from public.project_reported_progress_latest(N)) = pg_temp.id('E4'));
  perform pg_temp.chk(4, '04 CHAIN', 'superseded history stays readable (every entry, 7 rows)',
    (select count(*) from public.project_reported_progress where project_id = N) = 7);
end $s04$;

select pg_temp.act(pg_temp.id('P_Y'));
do $s04y$ begin
  perform pg_temp.chk(4, '04 CHAIN', 'the Reporting Coordinator reads the whole history and the latest position',
    (select count(*) from public.project_reported_progress where project_id = pg_temp.project('ZZ-139C-NF')) = 7
    and (select id from public.project_reported_progress_latest(pg_temp.project('ZZ-139C-NF'))) = pg_temp.id('E4')
    and exists (select 1 from public.project_setup_finalisations where project_id = pg_temp.project('ZZ-139C-NF')));
end $s04y$;

select pg_temp.owner();
do $s04o$
declare N uuid := pg_temp.project('ZZ-139C-NF');
begin
  perform pg_temp.must_fail(4, '04 CHAIN', 'owner: an entry cannot be edited (no re-pointing, no cycle)',
    format('update public.project_reported_progress set supersedes_entry_id = %L where id = %L', pg_temp.id('C2'), pg_temp.id('E1')),
    'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(4, '04 CHAIN', 'owner: an entry cannot be deleted',
    format('delete from public.project_reported_progress where id = %L', pg_temp.id('E3')), 'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(4, '04 CHAIN', 'owner: an entry cannot supersede itself',
    format('insert into public.project_reported_progress (id, project_id, data_date, entry_kind, reported_actual_percent, narrative, supersedes_entry_id, reason, recorded_by) values (%L, %L, %L, %L, 1, %L, %L, %L, %L)',
           '00000000-0000-4000-c000-0000000139ff', N, '2026-10-01', 'correction', 'x', '00000000-0000-4000-c000-0000000139ff', 'r', pg_temp.id('P_X')));
  perform pg_temp.must_fail(4, '04 CHAIN', 'owner: a chain cannot cross projects',
    format('insert into public.project_reported_progress (project_id, data_date, entry_kind, reported_actual_percent, narrative, supersedes_entry_id, reason, recorded_by) values (%L, %L, %L, 1, %L, %L, %L, %L)',
           pg_temp.project('ZZ-139C-NF2'), '2026-10-04', 'correction', 'x', pg_temp.id('E4'), 'r', pg_temp.id('P_X')));
  perform pg_temp.must_pass(4, '04 CHAIN', 'owner: a forged is_backdated on a non-back-dated report is overridden by the server',
    format('with x as (insert into public.project_reported_progress (project_id, data_date, entry_kind, reported_actual_percent, narrative, is_backdated, reason, recorded_by) values (%2$L, %3$L, %4$L, 5, %5$L, true, %6$L, %7$L) returning id) insert into ids(key, id) select %1$L, id from x',
           'E_N3', pg_temp.project('ZZ-139C-NF3'), '2026-10-02', 'report', 'x', 'forged', pg_temp.id('P_X')));
  perform pg_temp.chk(4, '04 CHAIN', 'the forged flag was reset to false',
    (select not is_backdated from pg_temp.entry('E_N3')));
end $s04o$;

/* ============================ 05. concurrency ============================ */

do $s05$
declare N uuid := pg_temp.project('ZZ-139C-NF');
begin
  -- Bypass every pre-check: the entry triggers are disabled inside this
  -- rolled-back transaction, so only the constraints stand.
  alter table public.project_setup_finalisations disable trigger guard_setup_finalisation_entry;
  alter table public.project_reported_progress disable trigger guard_reported_progress_entry;
  perform pg_temp.must_fail(5, '05 CONCURRENCY', 'duplicate Finalise: a raced second row is refused by the unique constraint',
    format('insert into public.project_setup_finalisations (project_id, onboarding_mode_at_finalisation, acknowledgement, finalised_by) values (%L, %L, %L, %L)',
           N, 'no_formal_schedule', 'raced', pg_temp.id('P_PCA')), '23505');
  perform pg_temp.must_fail(5, '05 CONCURRENCY', 'duplicate same-date report: a raced second original is refused by the unique index',
    format('insert into public.project_reported_progress (project_id, data_date, entry_kind, reported_actual_percent, narrative, recorded_by) values (%L, %L, %L, 50, %L, %L)',
           N, '2026-10-03', 'report', 'raced', pg_temp.id('P_PCA')), '23505');
  perform pg_temp.must_pass(5, '05 CONCURRENCY', 'two corrections of one head: the first lands',
    format('insert into public.project_reported_progress (project_id, data_date, entry_kind, reported_actual_percent, narrative, supersedes_entry_id, reason, recorded_by) values (%L, %L, %L, 27, %L, %L, %L, %L)',
           N, '2026-10-03', 'correction', 'first', pg_temp.id('E4'), 'r1', pg_temp.id('P_X')));
  perform pg_temp.must_fail(5, '05 CONCURRENCY', 'two corrections of one head: the raced second is refused (one successor)',
    format('insert into public.project_reported_progress (project_id, data_date, entry_kind, reported_actual_percent, narrative, supersedes_entry_id, reason, recorded_by) values (%L, %L, %L, 28, %L, %L, %L, %L)',
           N, '2026-10-03', 'correction', 'second', pg_temp.id('E4'), 'r2', pg_temp.id('P_PCA')), '23505');
  perform pg_temp.must_fail(5, '05 CONCURRENCY', 'correction vs withdrawal race: the raced withdrawal of the same head is refused',
    format('insert into public.project_reported_progress (project_id, data_date, entry_kind, narrative, supersedes_entry_id, reason, recorded_by) values (%L, %L, %L, null, %L, %L, %L)',
           N, '2026-10-03', 'withdrawal', pg_temp.id('E4'), 'race', pg_temp.id('P_PCA')), '23505');
  alter table public.project_setup_finalisations enable trigger guard_setup_finalisation_entry;
  alter table public.project_reported_progress enable trigger guard_reported_progress_entry;
  perform pg_temp.chk(5, '05 CONCURRENCY', 'the chain is still linear: E4 has exactly one successor',
    (select count(*) from public.project_reported_progress where supersedes_entry_id = pg_temp.id('E4')) = 1);
  perform pg_temp.chk(5, '05 CONCURRENCY', 'every writer serialises on the Project Setup advisory lock',
    (select bool_and(prosrc like '%pg_advisory_xact_lock(190726, 1)%') from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('finalise_project_setup', 'record_reported_progress', 'reported_progress_supersede')));
end $s05$;

/* ============================ 06. eligibility ============================ */

select pg_temp.act(pg_temp.id('P_X'));
do $s06$ begin
  perform pg_temp.must_fail(6, '06 ELIGIBILITY', 'a planning-governed (new_project) project cannot record Reported Progress',
    pg_temp.rec_sql('BAD', pg_temp.project('ZZ-139C-GOV'), '2026-10-01', 10, 'x'), 'REPORTED_PROGRESS_NOT_ALLOWED');
  perform pg_temp.must_fail(6, '06 ELIGIBILITY', 'a project with a Published Planning Snapshot cannot record Reported Progress',
    pg_temp.rec_sql('BAD', pg_temp.project('ZZ-139C-SNP'), '2026-10-01', 10, 'x'), 'REPORTED_PROGRESS_NOT_ALLOWED');
  perform pg_temp.must_pass(6, '06 ELIGIBILITY', 'TRN: finalised and an entry recorded',
    pg_temp.fin_sql(pg_temp.project('ZZ-139C-TRN'), true, 'Core setup becomes controlled.') || '; ' ||
    pg_temp.rec_sql('T1', pg_temp.project('ZZ-139C-TRN'), '2026-10-01', 40, 'Before the schedule arrived'));
  perform pg_temp.must_pass(6, '06 ELIGIBILITY', 'TRN: Project Control requests no_formal_schedule -> new_project (governed)',
    format('insert into ids(key, id) select %L, (public.request_project_setup_amendment(%L::uuid, %L, %L::jsonb, %L::jsonb, %L)).id',
           'OB_TRN', pg_temp.project('ZZ-139C-TRN'), 'onboarding_mode', '{"onboarding_mode": "no_formal_schedule"}',
           '{"onboarding_mode": "new_project"}', 'Contractor schedule received'));
  insert into ids(key, note) values ('TRN_PRINT', pg_temp.stream_print(pg_temp.project('ZZ-139C-TRN')));
end $s06$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s06p$ begin
  perform pg_temp.must_pass(6, '06 ELIGIBILITY', 'TRN: a Project Control Admin approves the transition',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('OB_TRN'), 'approve'));
end $s06p$;
select pg_temp.act(pg_temp.id('P_X'));
do $s06t$
declare T uuid := pg_temp.project('ZZ-139C-TRN');
begin
  perform pg_temp.chk(6, '06 ELIGIBILITY', 'TRN after the transition: mode new_project, still Controlled, finalisation and stream unchanged',
    (select onboarding_mode from public.project_planning_settings where project_id = T) = 'new_project'
    and public.project_setup_controlled(T)
    and pg_temp.stream_print(T) = (select note from ids where key = 'TRN_PRINT'));
  perform pg_temp.must_fail(6, '06 ELIGIBILITY', 'TRN: a new report is refused (history is read-only context)',
    pg_temp.rec_sql('BAD', T, '2026-10-08', 45, 'x'), 'REPORTED_PROGRESS_NOT_ALLOWED');
  perform pg_temp.must_fail(6, '06 ELIGIBILITY', 'TRN: a correction of the earlier entry is refused',
    pg_temp.cor_sql('BAD', 'T1', 41, 'x', 'y'), 'REPORTED_PROGRESS_NOT_ALLOWED');
  perform pg_temp.must_fail(6, '06 ELIGIBILITY', 'TRN: a withdrawal of the earlier entry is refused',
    pg_temp.wd_sql('BAD', 'T1', 'y'), 'REPORTED_PROGRESS_NOT_ALLOWED');
  perform pg_temp.must_pass(6, '06 ELIGIBILITY', 'TRN: the first Planning Snapshot publishes without a new confirmation (already Controlled)',
    pg_temp.publish_sql(T, false));
  perform pg_temp.must_fail(6, '06 ELIGIBILITY', 'TRN: once a snapshot exists, the way back to no_formal_schedule is prohibited',
    format('update public.project_planning_settings set onboarding_mode = %L where project_id = %L', 'no_formal_schedule', T),
    'ONBOARDING_TRANSITION_PROHIBITED');
  perform pg_temp.chk(6, '06 ELIGIBILITY', 'TRN: the Reported Progress history is still intact after the snapshot',
    pg_temp.stream_print(T) = (select note from ids where key = 'TRN_PRINT'));
end $s06t$;

do $s06r$
declare
  N uuid := pg_temp.project('ZZ-139C-NF');
  v_actor text;
begin
  foreach v_actor in array array['P_Y', 'P_D', 'P_M', 'P_X2'] loop
    perform pg_temp.act(pg_temp.id(v_actor));
    perform pg_temp.must_fail(6, '06 ELIGIBILITY', v_actor || ' cannot record Reported Progress on NF',
      pg_temp.rec_sql('BAD', N, '2026-10-07', 10, 'x'), 'NOT_AUTHORIZED');
    perform pg_temp.must_fail(6, '06 ELIGIBILITY', v_actor || ' cannot correct Reported Progress on NF',
      pg_temp.cor_sql('BAD', 'C2', 23, 'x', 'y'), 'NOT_AUTHORIZED');
    perform pg_temp.must_fail(6, '06 ELIGIBILITY', v_actor || ' cannot withdraw Reported Progress on NF',
      pg_temp.wd_sql('BAD', 'C2', 'y'), 'NOT_AUTHORIZED');
  end loop;
  perform pg_temp.act(pg_temp.id('P_X2'));
  perform pg_temp.must_pass(6, '06 ELIGIBILITY', 'X2 records on their own assigned project NFX',
    pg_temp.rec_sql('X1', pg_temp.project('ZZ-139C-NFX'), '2026-10-01', 12, 'Own project'));
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_fail(6, '06 ELIGIBILITY', 'X cannot correct an entry on a project they are not assigned to',
    pg_temp.cor_sql('BAD', 'X1', 13, 'x', 'y'), 'NOT_AUTHORIZED');
  perform pg_temp.act(pg_temp.id('P_PCA'));
  perform pg_temp.must_pass(6, '06 ELIGIBILITY', 'a Project Control Admin corrects on any project (global authority)',
    pg_temp.cor_sql('X1C', 'X1', 13, 'Checked', 'Recount'));
  perform pg_temp.act(pg_temp.id('P_SA'));
  perform pg_temp.must_pass(6, '06 ELIGIBILITY', 'the System Administrator withdraws on any project',
    pg_temp.wd_sql('X1W', 'X1C', 'Duplicate of the Monthly figure'));
  perform pg_temp.owner();
  perform pg_temp.chk(6, '06 ELIGIBILITY', 'no SPI / PV / EV exists anywhere in the stream',
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name in ('project_reported_progress', 'project_setup_finalisations')
                   and column_name ~ '(^|_)(spi|pv|ev|planned_value|earned_value)($|_)'));
  perform pg_temp.chk(6, '06 ELIGIBILITY', 'the retired typed project progress was not touched by the stream',
    (select planned_progress = 0 and actual_progress = 0 from public.projects where id = N));
end $s06r$;

/* ============================== 07. archived ============================= */

select pg_temp.act(pg_temp.id('P_X'));
do $s07a$
declare A uuid := pg_temp.project('ZZ-139C-ARC');
begin
  perform pg_temp.must_pass(7, '07 ARCHIVED', 'before archiving: ARC is finalised and has an entry',
    pg_temp.fin_sql(A, true, 'Core setup becomes controlled.') || '; ' ||
    pg_temp.rec_sql('A1', A, '2026-10-01', 50, 'Before archive'));
end $s07a$;
select pg_temp.owner();
do $s07o$
declare A uuid := pg_temp.project('ZZ-139C-ARC');
begin
  insert into ids(key, note) values ('ARC_PRINT', pg_temp.stream_print(A));
  update public.projects set status = 'archived', active = false, archived_at = now() where id = A;
end $s07o$;
do $s07$
declare
  A uuid := pg_temp.project('ZZ-139C-ARC');
  v_actor text;
begin
  foreach v_actor in array array['P_X', 'P_PCA', 'P_SA'] loop
    perform pg_temp.act(pg_temp.id(v_actor));
    perform pg_temp.must_fail(7, '07 ARCHIVED', v_actor || ': a new report is refused',
      pg_temp.rec_sql('BAD', A, '2026-10-05', 55, 'x'), 'PROJECT_ARCHIVED');
    perform pg_temp.must_fail(7, '07 ARCHIVED', v_actor || ': a correction is refused',
      pg_temp.cor_sql('BAD', 'A1', 51, 'x', 'y'), 'PROJECT_ARCHIVED');
    perform pg_temp.must_fail(7, '07 ARCHIVED', v_actor || ': a withdrawal is refused',
      pg_temp.wd_sql('BAD', 'A1', 'y'), 'PROJECT_ARCHIVED');
    perform pg_temp.must_fail(7, '07 ARCHIVED', v_actor || ': Finalise is refused',
      pg_temp.fin_sql(A, true, 'x'), 'PROJECT_ARCHIVED');
  end loop;
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.chk(7, '07 ARCHIVED', 'the historical finalisation and entries stay readable',
    exists (select 1 from public.project_setup_finalisations where project_id = A)
    and (select count(*) from public.project_reported_progress where project_id = A) = 1
    and (select id from public.project_reported_progress_latest(A)) = pg_temp.id('A1'));
  perform pg_temp.owner();
  perform pg_temp.must_fail(7, '07 ARCHIVED', 'owner: a direct insert on the archived project is refused',
    format('insert into public.project_reported_progress (project_id, data_date, entry_kind, reported_actual_percent, narrative, recorded_by) values (%L, %L, %L, 1, %L, %L)',
           A, '2026-10-06', 'report', 'x', pg_temp.id('P_X')), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(7, '07 ARCHIVED', 'owner: an entry of the archived project cannot be changed (archived answers first)',
    format('update public.project_reported_progress set narrative = %L where id = %L', 'x', pg_temp.id('A1')), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(7, '07 ARCHIVED', 'owner: the finalisation of the archived project cannot be changed',
    format('update public.project_setup_finalisations set note = %L where project_id = %L', 'x', A), 'PROJECT_ARCHIVED');
  perform pg_temp.chk(7, '07 ARCHIVED', 'finalisation and stream are byte-for-byte unchanged',
    pg_temp.stream_print(A) = (select note from ids where key = 'ARC_PRINT'));
end $s07$;

/* =================== 08. legacy classification bootstrap ================= */

select pg_temp.act(pg_temp.id('P_X'));
do $s08x$
declare L uuid := pg_temp.project('ZZ-139C-LGC');
begin
  perform pg_temp.chk(8, '08 LEGACY BOOTSTRAP', 'LGC is Controlled with no Project Type',
    public.project_setup_controlled(L) and (select structure_family is null from public.projects where id = L));
  perform pg_temp.must_fail(8, '08 LEGACY BOOTSTRAP', 'Project Control cannot classify it through Project Setup',
    pg_temp.patch_sql(L, '{"structure_family": "psm", "project_type_id": null, "project_category_detail": null}'), 'SETUP_CONTROLLED');
  perform pg_temp.must_pass(8, '08 LEGACY BOOTSTRAP', 'before Controlled (LGN), classification through Project Setup works as today',
    pg_temp.patch_sql(pg_temp.project('ZZ-139C-LGN'), '{"structure_family": "psm", "project_type_id": null, "project_category_detail": null}'));
end $s08x$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s08p$
declare L uuid := pg_temp.project('ZZ-139C-LGC');
begin
  perform pg_temp.must_fail(8, '08 LEGACY BOOTSTRAP', 'a Project Control Admin cannot bootstrap it',
    format('select public.correct_project_structure_family(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L, %L::uuid, null, %L)',
           L, L, 'other', pg_temp.id('T_PIPE'), 'Bootstrap'), 'NOT_AUTHORIZED');
end $s08p$;
select pg_temp.act(pg_temp.id('P_SA'));
do $s08s$
declare
  L uuid := pg_temp.project('ZZ-139C-LGC');
  c public.project_classification_corrections;
begin
  perform pg_temp.must_fail(8, '08 LEGACY BOOTSTRAP', 'a non-Controlled legacy project is still classified from Project Setup (NOT_CLASSIFIED unchanged)',
    format('select public.correct_project_structure_family(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L, null, null, %L)',
           pg_temp.project('ZZ-139C-LGM'), pg_temp.project('ZZ-139C-LGM'), 'psm', 'x'), 'NOT_CLASSIFIED');
  perform pg_temp.must_pass(8, '08 LEGACY BOOTSTRAP', 'the System Administrator bootstraps LGC as Other with its Project Category, atomically',
    format('select public.correct_project_structure_family(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L, %L::uuid, null, %L)',
           L, L, 'other', pg_temp.id('T_PIPE'), 'Legacy project classified at governance rollout'));
  select * into c from public.project_classification_corrections where project_id = L;
  perform pg_temp.chk(8, '08 LEGACY BOOTSTRAP', 'recorded once in the classification history as legacy_bootstrap (old family NULL)',
    (select count(*) from public.project_classification_corrections where project_id = L) = 1
    and c.correction_kind = 'legacy_bootstrap' and c.old_family is null and c.new_family = 'other'
    and c.old_project_type_id = pg_temp.id('T_INSP') and c.new_project_type_id = pg_temp.id('T_PIPE')
    and c.corrected_by = pg_temp.id('P_SA'));
  perform pg_temp.chk(8, '08 LEGACY BOOTSTRAP', 'the project is classified; no amendment and no field-change row was written',
    (select structure_family = 'other' and project_type_id = pg_temp.id('T_PIPE') from public.projects where id = L)
    and not exists (select 1 from public.project_setup_amendments where project_id = L)
    and not exists (select 1 from public.project_setup_field_changes where project_id = L));
  perform pg_temp.must_pass(8, '08 LEGACY BOOTSTRAP', 'afterwards a later Project Type change is the ordinary 2C.1 correction',
    format('select public.correct_project_structure_family(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L, null, null, %L)',
           L, L, 'psm', 'Actually a PSM project'));
  perform pg_temp.chk(8, '08 LEGACY BOOTSTRAP', 'that second row is kind correction (the bootstrap happened once)',
    (select string_agg(correction_kind || ':' || coalesce(old_family, 'null'), ',' order by corrected_at, correction_kind desc)
       from public.project_classification_corrections where project_id = L) = 'legacy_bootstrap:null,correction:other');
end $s08s$;
select pg_temp.act(pg_temp.id('P_X'));
do $s08n$
declare L uuid := pg_temp.project('ZZ-139C-LGC');
begin
  perform pg_temp.must_fail(8, '08 LEGACY BOOTSTRAP', 'once classified, a family change through Project Setup is refused (2C.1 lock)',
    pg_temp.patch_sql(L, jsonb_build_object('structure_family', 'other', 'project_type_id', pg_temp.id('T_INSP'))), '23514');
end $s08n$;
select pg_temp.owner();
do $s08o$
declare L uuid := pg_temp.project('ZZ-139C-LGC');
begin
  perform pg_temp.must_fail(8, '08 LEGACY BOOTSTRAP', 'owner: a second legacy_bootstrap row for the project is refused',
    format('insert into public.project_classification_corrections (project_id, old_family, new_family, reason, correction_kind) values (%L, null, %L, %L, %L)',
           L, 'psm', 'again', 'legacy_bootstrap'), '23505');
  perform pg_temp.must_fail(8, '08 LEGACY BOOTSTRAP', 'owner: a NULL old family is only valid for the bootstrap kind',
    format('insert into public.project_classification_corrections (project_id, old_family, new_family, reason) values (%L, null, %L, %L)',
           pg_temp.project('ZZ-139C-NF'), 'psm', 'x'), '23514');
end $s08o$;

/* ================================ 09. catalog ============================ */

do $s09$
begin
  perform pg_temp.chk(9, '09 CATALOG', 'the archived guard answers first on both new tables',
    not exists (select 1 from pg_trigger g where g.tgrelid = 'public.project_setup_finalisations'::regclass
                 and not g.tgisinternal and (g.tgtype & 3) = 3 and g.tgname < 'block_archived_setup_governance')
    and not exists (select 1 from pg_trigger g where g.tgrelid = 'public.project_reported_progress'::regclass
                 and not g.tgisinternal and (g.tgtype & 3) = 3 and g.tgname < 'block_archived_reported_progress'));
  perform pg_temp.chk(9, '09 CATALOG', 'no client role can write either table; anon cannot read them',
    not has_table_privilege('authenticated', 'public.project_reported_progress', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('service_role', 'public.project_reported_progress', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.project_setup_finalisations', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('anon', 'public.project_reported_progress', 'SELECT')
    and not has_table_privilege('anon', 'public.project_setup_finalisations', 'SELECT'));
  perform pg_temp.chk(9, '09 CATALOG', 'internal functions are not callable by clients; the write functions are',
    not has_function_privilege('authenticated', 'public.reported_progress_supersede(uuid,text,numeric,numeric,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.assert_reported_progress_writable(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_reported_progress_entry()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.finalise_project_setup(uuid,boolean,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.record_reported_progress(uuid,date,numeric,text,numeric,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.record_reported_progress(uuid,date,numeric,text,numeric,text)', 'EXECUTE'));
  perform pg_temp.chk(9, '09 CATALOG', 'there is no un-finalise path (B23)',
    not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                 and proname ~ '(unfinali|revert|reopen|undo).*setup|setup.*(unfinali|revert|reopen|undo)'));
  perform pg_temp.chk(9, '09 CATALOG', 'can_manage_project_operations() is byte-for-byte unchanged (pre-13.9 fingerprint)',
    (select md5(prosrc) from pg_proc where oid = 'public.can_manage_project_operations(uuid)'::regprocedure)
    = '05c5f58290be4341497507fffc05c2a0');
  perform pg_temp.chk(9, '09 CATALOG', 'the eight 2C.3E block_archived_project_setup guards are unchanged in number',
    (select count(*) from pg_trigger where tgname = 'block_archived_project_setup') = 8);
  perform pg_temp.chk(9, '09 CATALOG', 'no Weekly / Monthly function references the Reported Progress stream',
    not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                 and proname ~ '(weekly|monthly)' and prosrc like '%project_reported_progress%'));
end $s09$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;
