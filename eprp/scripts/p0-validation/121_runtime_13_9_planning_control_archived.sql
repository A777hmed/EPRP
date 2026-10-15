-- Phase 13.9 archived / read-only safety guards for Master Planning & Control
-- — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261014090000_planning_control_archived_read_only.sql against real
-- PostgreSQL, real RLS and real authenticated roles. Everything — fixtures,
-- accounts and every write — runs in ONE transaction that is ROLLED BACK.
-- Nothing persists.
--
--   1  archived project: every Planning / Milestone / Deliverable write is
--      refused for the assigned Project Control, the Project Control Admin and
--      the System Administrator — including import apply, snapshot publish,
--      Opening Position record / promote, baseline, WBS, milestones, milestone
--      progress, Weekly milestone drafts and deliverables
--   2  the owner / SECURITY DEFINER path is refused too (no bypass), on the
--      fixture and on legacy archived data
--   3  archived reads still work (the actors above, a plain viewer, legacy
--      archived projects); the archived records are byte-for-byte unchanged
--   4  active project: the same operations still succeed for the same actors
--   5  active-project authority unchanged: Reporting Coordinator and viewer
--      still refused; append-only milestone history still enforced; the
--      operations predicate itself unchanged
--   6  lifecycle: archiving a project that holds planning data still works;
--      there is still no un-archive path (2C.3E, unchanged); deleting a whole
--      archived project still cascades
--   7  catalog: guard on all 16 tables, answers first, not client-callable;
--      policies and can_manage_project_operations() byte-for-byte unchanged
--
-- HOW TO RUN (after the migration is applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/121_runtime_13_9_planning_control_archived.sql

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
grant select on ids to authenticated, anon;

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
    'refused [' || sqlstate || ']: ' || left(sqlerrm, 100));
end $$;

create or replace function pg_temp.must_pass(
  p_seq int, p_area text, p_item text, p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, true);
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, false, '[' || sqlstate || '] ' || left(sqlerrm, 110));
end $$;

-- Act as a signed-in account, or return to the owner. SET LOCAL semantics:
-- each lasts until the other is called (or the transaction ends).
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

create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select id from public.projects where code = p_code $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp join public.projects p on p.id = pp.project_id
                    where p.code = p_code and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.id(p_key text) returns uuid
language sql as $$ select id from ids where key = p_key $$;

-- Every scoped record of one project, as text: the archived fingerprint.
create or replace function pg_temp.print(p uuid) returns text language sql as $$
  select md5(coalesce(string_agg(t, E'\n' order by t), '')) from (
              select 'ps ' || to_jsonb(x)::text t from public.project_planning_settings x where x.project_id = p
    union all select 'ib ' || to_jsonb(x)::text from public.planning_import_batches x where x.project_id = p
    union all select 'ir ' || to_jsonb(x)::text from public.planning_import_rows x
               where x.batch_id in (select id from public.planning_import_batches where project_id = p)
    union all select 'wi ' || to_jsonb(x)::text from public.planning_work_items x where x.project_id = p
    union all select 'ac ' || to_jsonb(x)::text from public.planning_activities x where x.project_id = p
    union all select 'cf ' || to_jsonb(x)::text from public.planning_confirmations x
               where x.activity_id in (select id from public.planning_activities where project_id = p)
                  or x.work_item_id in (select id from public.planning_work_items where project_id = p)
    union all select 'bl ' || to_jsonb(x)::text from public.planning_baselines x where x.project_id = p
    union all select 'sn ' || to_jsonb(x)::text from public.planning_snapshots x where x.project_id = p
    union all select 'sa ' || to_jsonb(x)::text from public.planning_snapshot_activities x
               where x.snapshot_id in (select id from public.planning_snapshots where project_id = p)
    union all select 'op ' || to_jsonb(x)::text from public.planning_opening_positions x where x.project_id = p
    union all select 'mm ' || to_jsonb(x)::text from public.master_milestones x where x.project_id = p
    union all select 'mu ' || to_jsonb(x)::text from public.milestone_updates x
               where x.milestone_id in (select id from public.master_milestones where project_id = p)
    union all select 'ml ' || to_jsonb(x)::text from public.planning_milestone_links x
               where x.master_milestone_id in (select id from public.master_milestones where project_id = p)
    union all select 'wd ' || to_jsonb(x)::text from public.weekly_milestone_drafts x
               where x.weekly_report_id in (select id from public.weekly_reports where project_id = p)
    union all select 'md ' || to_jsonb(x)::text from public.master_deliverables x where x.project_id = p
    union all select 'du ' || to_jsonb(x)::text from public.deliverable_updates x
               where x.deliverable_id in (select id from public.master_deliverables where project_id = p)
  ) s
$$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  v_code text;
  P uuid;
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regprocedure('public.guard_archived_project_planning()') is null then
    raise exception 'guard_archived_project_planning() not found — apply 20261014090000_planning_control_archived_read_only.sql first.';
  end if;

  -- Three PSM projects: ACT stays active; ARC and DEL are archived below.
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-139-' || s, 'ZZ 13.9 ' || s, p.client_id, p.planned_start_date, p.planned_finish_date, 'active', 'psm'
    from public.projects p, (values ('ACT'), ('ARC'), ('DEL')) v(s)
   where p.id = v_template;

  -- People and accounts: X = assigned Project Control / Planning, Y = assigned
  -- Reporting Coordinator, V = a plain viewer, PCA = Project Control Admin.
  -- The System Administrator is an existing account (identity only).
  insert into public.contacts (name, email, active)
  select 'ZZ 139 ' || s, 'zz.139.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('Y'), ('V'), ('PCA')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-a000-0000000139' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.139.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('Y', '02'), ('V', '03'), ('PCA', '04')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-a000-0000000139' || v.n)::uuid, 'zz.139.' || lower(v.s) || '@example.invalid',
         'ZZ 139 ' || v.s, v.role, pg_temp.person('ZZ 139 ' || v.s), true
    from (values ('X', '01', 'viewer'), ('Y', '02', 'viewer'), ('V', '03', 'viewer'),
                 ('PCA', '04', 'project_control_admin')) v(s, n, role);
  insert into ids(key, id) values
    ('P_X', '00000000-0000-4000-a000-000000013901'), ('P_Y', '00000000-0000-4000-a000-000000013902'),
    ('P_V', '00000000-0000-4000-a000-000000013903'), ('P_PCA', '00000000-0000-4000-a000-000000013904'),
    ('P_SA', (select id from public.profiles where role = 'system_admin' and active and contact_id is not null
               order by created_at limit 1));
  if pg_temp.id('P_SA') is null then
    raise exception 'No active System Administrator with a contact exists in the local dataset.';
  end if;

  -- Named Project Control and Reporting Coordinator on every fixture project.
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-139-' || p.s), pg_temp.person('ZZ 139 ' || m.s), pg_temp.party('ZZ-139-' || p.s, 'eprom'), m.role
    from (values ('ACT'), ('ARC'), ('DEL')) p(s),
         (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-139-' || p.s), pg_temp.person('ZZ 139 ' || m.s), m.role
    from (values ('ACT'), ('ARC'), ('DEL')) p(s),
         (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects
     set project_control_manager_id = pg_temp.person('ZZ 139 X'),
         reporting_coordinator_id = pg_temp.person('ZZ 139 Y')
   where code in ('ZZ-139-ACT', 'ZZ-139-ARC', 'ZZ-139-DEL');

  -- The same Planning / Milestone / Deliverable seed on each project.
  foreach v_code in array array['ACT', 'ARC', 'DEL'] loop
    P := pg_temp.project('ZZ-139-' || v_code);
    insert into public.project_planning_settings (project_id, onboarding_mode)
    values (P, case v_code when 'ARC' then 'existing_active_project' else 'new_project' end);
    insert into public.planning_work_items (project_id, code, name, weight_percent)
    values (P, 'WI-1', 'ZZ RBI', 10) returning id into strict P;  -- reuse P briefly for the id
    insert into ids(key, id) values (v_code || '_WI1', P);
    P := pg_temp.project('ZZ-139-' || v_code);
    insert into public.planning_activities (project_id, work_item_id, code, external_id, name)
    values (P, pg_temp.id(v_code || '_WI1'), 'A-1', 'EXT-A1', 'ZZ Data collection');
    insert into public.planning_activities (project_id, work_item_id, code, external_id, name, is_milestone)
    values (P, pg_temp.id(v_code || '_WI1'), 'MS-1', 'EXT-MS1', 'ZZ RBI Final Report Approved', true);
    insert into ids(key, id) values
      (v_code || '_A1', (select id from public.planning_activities where project_id = P and code = 'A-1')),
      (v_code || '_MS1', (select id from public.planning_activities where project_id = P and code = 'MS-1'));
    insert into public.planning_import_batches (project_id, source_type, file_name, status, data_date, row_count)
    values (P, 'eprp_excel', 'zz139-seed.xlsx', 'validated', '2026-10-01', 1);
    insert into ids(key, id) values (v_code || '_BATCH',
      (select id from public.planning_import_batches where project_id = P and file_name = 'zz139-seed.xlsx'));
    insert into public.planning_import_rows (batch_id, row_number, external_id, name)
    values (pg_temp.id(v_code || '_BATCH'), 1, 'EXT-A1', 'ZZ Data collection');
    insert into public.planning_confirmations (activity_id, action, field_name, new_value, reason)
    values (pg_temp.id(v_code || '_A1'), 'confirm', 'row', '{}', 'Confirmed as imported.');
    insert into public.planning_baselines (project_id, name, baseline_date) values (P, 'ZZ BL0', '2026-09-01');
    insert into public.planning_opening_positions (project_id, data_date, planned_progress_percent, actual_progress_percent, source)
    values (P, '2026-10-01', 30, 25, 'ZZ prior contractor S-curve');
    insert into ids(key, id) values (v_code || '_OP', (select id from public.planning_opening_positions where project_id = P));
    insert into public.master_milestones (project_id, code, name, planned_date, baseline_date)
    values (P, 'M-1', 'ZZ VDU RBI Final Report Approved', '2026-12-15', '2026-12-01'),
           (P, 'M-2', 'ZZ Mechanical Completion', '2027-02-01', '2027-02-01');
    insert into ids(key, id) values
      (v_code || '_M1', (select id from public.master_milestones where project_id = P and code = 'M-1')),
      (v_code || '_M2', (select id from public.master_milestones where project_id = P and code = 'M-2'));
    insert into public.planning_milestone_links (master_milestone_id, activity_id)
    values (pg_temp.id(v_code || '_M1'), pg_temp.id(v_code || '_MS1'));
    insert into ids(key, id) values (v_code || '_LINK',
      (select id from public.planning_milestone_links where master_milestone_id = pg_temp.id(v_code || '_M1')));
    insert into public.master_deliverables (project_id, code, title, milestone_id)
    values (P, 'D-1', 'ZZ VDU RBI Report', pg_temp.id(v_code || '_M1'));
    insert into ids(key, id) values (v_code || '_D1',
      (select id from public.master_deliverables where project_id = P and code = 'D-1'));
  end loop;

  -- Update streams and a Weekly report (ACT and ARC only: DEL is deleted later,
  -- and update streams / reports RESTRICT a project delete by design).
  foreach v_code in array array['ACT', 'ARC'] loop
    P := pg_temp.project('ZZ-139-' || v_code);
    insert into public.milestone_updates (milestone_id, source, status, progress_percent, approval_status, approved_at)
    values (pg_temp.id(v_code || '_M1'), 'planning', 'in_progress', 10, 'approved', now());
    insert into public.milestone_updates (milestone_id, source, status, progress_percent)
    values (pg_temp.id(v_code || '_M1'), 'planning', 'in_progress', 20);
    insert into ids(key, id) values (v_code || '_PU',
      (select id from public.milestone_updates where milestone_id = pg_temp.id(v_code || '_M1') and approval_status = 'pending'));
    insert into ids(key, id) values (v_code || '_AU',
      (select id from public.milestone_updates where milestone_id = pg_temp.id(v_code || '_M1') and approval_status = 'approved'));
    insert into public.deliverable_updates (deliverable_id, source) values (pg_temp.id(v_code || '_D1'), 'planning');
    insert into ids(key, id) values (v_code || '_DU',
      (select id from public.deliverable_updates where deliverable_id = pg_temp.id(v_code || '_D1')));
    insert into public.weekly_reports (report_number, project_id, week_number, period_start, period_end)
    values ('ZZ139-' || v_code || '-W41', P, 41, '2026-10-04', '2026-10-10');
    insert into ids(key, id) values (v_code || '_WR',
      (select id from public.weekly_reports where report_number = 'ZZ139-' || v_code || '-W41'));
  end loop;
end;
$fix$;

-- Weekly milestone drafts need an authenticated contact: written by X.
do $drafts$
begin
  perform pg_temp.act(pg_temp.id('P_X'));
  insert into public.weekly_milestone_drafts (weekly_report_id, milestone_id, status, progress_percent)
  values (pg_temp.id('ACT_WR'), pg_temp.id('ACT_M1'), 'in_progress', 15),
         (pg_temp.id('ARC_WR'), pg_temp.id('ARC_M1'), 'in_progress', 15);
  perform pg_temp.owner();
  insert into ids(key, id) values
    ('ACT_DRAFT', (select id from public.weekly_milestone_drafts where weekly_report_id = pg_temp.id('ACT_WR'))),
    ('ARC_DRAFT', (select id from public.weekly_milestone_drafts where weekly_report_id = pg_temp.id('ARC_WR')));
end $drafts$;

/* ====== 6. lifecycle: archiving a project with planning data still works ===== */

do $archive$
begin
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_pass(6, '06 LIFECYCLE', 'the assigned Project Control can still archive a project that holds Planning / Milestone / Deliverable data',
    format('update public.projects set status = %L, active = false, archived_at = now() where id = %L', 'archived', pg_temp.project('ZZ-139-ARC')));
  perform pg_temp.must_pass(6, '06 LIFECYCLE', 'and the DEL project (deleted later)',
    format('update public.projects set status = %L, active = false, archived_at = now() where id = %L', 'archived', pg_temp.project('ZZ-139-DEL')));
  perform pg_temp.owner();
end $archive$;

insert into ids(key, note) values ('ARC_PRINT', pg_temp.print(pg_temp.project('ZZ-139-ARC')));
insert into ids(key, note)
select 'LEGACY_PRINT', md5(coalesce(string_agg(pg_temp.print(p.id), ',' order by p.id), ''))
  from public.projects p where p.status = 'archived' and p.code not like 'ZZ-139-%';

/* ===== 1. archived: every Planning / Milestone / Deliverable write refused ==== */

do $arc$
declare
  A uuid := pg_temp.project('ZZ-139-ARC');
  WI uuid := pg_temp.id('ARC_WI1');
  A1 uuid := pg_temp.id('ARC_A1');
  BATCH uuid := pg_temp.id('ARC_BATCH');
  OP uuid := pg_temp.id('ARC_OP');
  M1 uuid := pg_temp.id('ARC_M1');
  M2 uuid := pg_temp.id('ARC_M2');
  PU uuid := pg_temp.id('ARC_PU');
  D1 uuid := pg_temp.id('ARC_D1');
  DU uuid := pg_temp.id('ARC_DU');
  WR uuid := pg_temp.id('ARC_WR');
  DR uuid := pg_temp.id('ARC_DRAFT');
  LNK uuid := pg_temp.id('ARC_LINK');
  E constant text := 'PROJECT_ARCHIVED';
  v_actor record;
  t text;
begin
  for v_actor in
    select * from (values (1, 'assigned Project Control', pg_temp.id('P_X')),
                          (2, 'Project Control Admin', pg_temp.id('P_PCA')),
                          (3, 'System Administrator', pg_temp.id('P_SA'))) a(n, label, profile)
     order by n
  loop
    perform pg_temp.act(v_actor.profile);
    t := ' — ' || v_actor.label;

    -- Planning: WBS, activities, import upload / validate / apply, baseline, settings.
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'add a WBS node' || t,
      format('insert into public.planning_work_items (project_id, code, name) values (%L, %L, %L)', A, 'WI-NEW', 'x'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'edit a WBS node' || t,
      format('update public.planning_work_items set name = %L where id = %L', 'changed', WI), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'add an activity' || t,
      format('insert into public.planning_activities (project_id, work_item_id, code, name) values (%L, %L, %L, %L)', A, WI, 'A-NEW', 'x'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'edit an activity (apply imported progress)' || t,
      format('update public.planning_activities set percent_complete_physical = 55 where id = %L', A1), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'upload a Primavera / Excel import batch' || t,
      format('insert into public.planning_import_batches (project_id, source_type, file_name, data_date) values (%L, %L, %L, %L)',
             A, 'p6', 'zz139-new.xlsx', '2026-10-08'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'change an import batch (validate / reject)' || t,
      format('update public.planning_import_batches set status = %L, rejection_reason = %L where id = %L', 'rejected', 'x', BATCH), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'add a raw import row' || t,
      format('insert into public.planning_import_rows (batch_id, row_number, external_id, name) values (%L, 99, %L, %L)', BATCH, 'EXT-99', 'x'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'apply an import decision (confirmation)' || t,
      format('insert into public.planning_confirmations (activity_id, action, field_name, new_value, reason) values (%L, %L, %L, %L, %L)',
             A1, 'adjust', 'percent_complete_physical', '55', 'x'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'create a baseline / re-baseline' || t,
      format('insert into public.planning_baselines (project_id, name, baseline_date) values (%L, %L, %L)', A, 'ZZ BL1', '2026-10-01'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · PLANNING', 'change Planning settings' || t,
      format('update public.project_planning_settings set default_import_source = %L where project_id = %L', 'p6', A), E);

    -- Opening Position and snapshot publishing (SECURITY DEFINER RPC included).
    perform pg_temp.must_fail(1, '01 ARCHIVED · SNAPSHOT', 'record an Opening Position' || t,
      format('insert into public.planning_opening_positions (project_id, data_date, planned_progress_percent, actual_progress_percent, source) values (%L, %L, 31, 26, %L)',
             A, '2026-10-02', 'x'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · SNAPSHOT', 'edit the draft Opening Position' || t,
      format('update public.planning_opening_positions set source = %L where id = %L', 'changed', OP), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · SNAPSHOT', 'promote the Opening Position to Snapshot V1 (publish RPC)' || t,
      format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_opening_position_id => %L::uuid)', A, OP), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · SNAPSHOT', 'publish a snapshot from the validated import batch (apply import)' || t,
      format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_import_batch_id => %L::uuid)', A, BATCH), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · SNAPSHOT', 'publish a manual snapshot with a Data Date' || t,
      format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date)', A, '2026-10-10'), E);

    -- Milestones: definitions, linkage, progress, decision, reconciliation, Weekly drafts.
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'create a governed milestone' || t,
      format('insert into public.master_milestones (project_id, code, name) values (%L, %L, %L)', A, 'M-NEW', 'x'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'edit a governed milestone (re-plan)' || t,
      format('update public.master_milestones set planned_date = %L where id = %L', '2027-01-15', M1), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'archive a governed milestone' || t,
      format('update public.master_milestones set active = false, archived_at = now() where id = %L', M2), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'link a milestone to a planning activity' || t,
      format('insert into public.planning_milestone_links (master_milestone_id, activity_id) values (%L, %L)', M2, A1), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'remove a milestone link' || t,
      format('delete from public.planning_milestone_links where id = %L', LNK), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'append milestone progress' || t,
      format('insert into public.milestone_updates (milestone_id, source, status, progress_percent, submitted_by_contact_id) values (%L, %L, %L, 35, public.current_contact_id())',
             M1, 'planning', 'in_progress'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'decide (approve) a pending milestone update' || t,
      format('update public.milestone_updates set approval_status = %L where id = %L', 'approved', PU), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'reconcile milestone progress' || t,
      format('insert into public.milestone_updates (milestone_id, source, status, progress_percent, as_of_date, reconciliation_reason, approval_status, approved_at, submitted_by_contact_id) values (%L, %L, %L, 40, %L, %L, %L, now(), public.current_contact_id())',
             M1, 'reconciliation', 'in_progress', '2026-10-10', 'x', 'approved'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'add a Weekly milestone draft' || t,
      format('insert into public.weekly_milestone_drafts (weekly_report_id, milestone_id, status, progress_percent) values (%L, %L, %L, 10)', WR, M2, 'in_progress'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'edit a Weekly milestone draft' || t,
      format('update public.weekly_milestone_drafts set progress_percent = 50 where id = %L', DR), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · MILESTONES', 'delete a Weekly milestone draft' || t,
      format('delete from public.weekly_milestone_drafts where id = %L', DR), E);

    -- Deliverables.
    perform pg_temp.must_fail(1, '01 ARCHIVED · DELIVERABLES', 'create a deliverable' || t,
      format('insert into public.master_deliverables (project_id, code, title) values (%L, %L, %L)', A, 'D-NEW', 'x'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · DELIVERABLES', 'edit a deliverable' || t,
      format('update public.master_deliverables set title = %L where id = %L', 'changed', D1), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · DELIVERABLES', 'submit a deliverable update' || t,
      format('insert into public.deliverable_updates (deliverable_id, source, submitted_by_contact_id) values (%L, %L, public.current_contact_id())', D1, 'planning'), E);
    perform pg_temp.must_fail(1, '01 ARCHIVED · DELIVERABLES', 'decide a pending deliverable update' || t,
      format('update public.deliverable_updates set approval_status = %L where id = %L', 'approved', DU), E);

    perform pg_temp.owner();
  end loop;
end $arc$;

/* ==== 2. the owner / SECURITY DEFINER path is refused too (no bypass) ==== */

do $owner$
declare
  A uuid := pg_temp.project('ZZ-139-ARC');
  E constant text := 'PROJECT_ARCHIVED';
  v_legacy uuid := (select s.id from public.planning_snapshots s join public.projects p on p.id = s.project_id
                     where p.status = 'archived' and p.code not like 'ZZ-139-%' order by s.published_at limit 1);
begin
  perform pg_temp.chk(2, '02 OWNER PATH', 'runs as the database owner (RLS bypassed — only the guard can refuse)',
    current_user = 'postgres');
  perform pg_temp.must_fail(2, '02 OWNER PATH', 'edit a baseline', format('update public.planning_baselines set name = %L where project_id = %L', 'x', A), E);
  perform pg_temp.must_fail(2, '02 OWNER PATH', 'delete raw import rows',
    format('delete from public.planning_import_rows where batch_id = %L', pg_temp.id('ARC_BATCH')), E);
  perform pg_temp.must_fail(2, '02 OWNER PATH', 'delete an import decision',
    format('delete from public.planning_confirmations where activity_id = %L', pg_temp.id('ARC_A1')), E);
  perform pg_temp.must_fail(2, '02 OWNER PATH', 'change a milestone link',
    format('update public.planning_milestone_links set activity_id = %L where id = %L', pg_temp.id('ARC_A1'), pg_temp.id('ARC_LINK')), E);
  perform pg_temp.must_fail(2, '02 OWNER PATH', 'insert a milestone update (the path the Weekly finalization hook uses)',
    format('insert into public.milestone_updates (milestone_id, source, status, progress_percent) values (%L, %L, %L, 50)',
           pg_temp.id('ARC_M1'), 'planning', 'in_progress'), E);
  perform pg_temp.must_fail(2, '02 OWNER PATH', 'delete a governed milestone',
    format('delete from public.master_milestones where id = %L', pg_temp.id('ARC_M2')), E);
  perform pg_temp.must_fail(2, '02 OWNER PATH', 'delete a deliverable update',
    format('delete from public.deliverable_updates where id = %L', pg_temp.id('ARC_DU')), E);
  perform pg_temp.must_fail(2, '02 OWNER PATH', 'delete the Planning settings',
    format('delete from public.project_planning_settings where project_id = %L', A), E);
  if v_legacy is not null then
    perform pg_temp.must_fail(2, '02 OWNER PATH', 'legacy archived project: change a published snapshot',
      format('update public.planning_snapshots set label = %L where id = %L', 'x', v_legacy), E);
    perform pg_temp.must_fail(2, '02 OWNER PATH', 'legacy archived project: delete a published snapshot',
      format('delete from public.planning_snapshots where id = %L', v_legacy), E);
  else
    perform pg_temp.chk(2, '02 OWNER PATH', 'legacy archived snapshot available to test', false, 'no archived project holds a snapshot');
  end if;
end $owner$;

/* ===== 3. archived reads still work; archived records are unchanged ====== */

do $reads$
declare
  A uuid := pg_temp.project('ZZ-139-ARC');
  v_actor record;
  v_ok boolean;
begin
  for v_actor in
    select * from (values (1, 'assigned Project Control', pg_temp.id('P_X')),
                          (2, 'Project Control Admin', pg_temp.id('P_PCA')),
                          (3, 'System Administrator', pg_temp.id('P_SA'))) a(n, label, profile)
     order by n
  loop
    perform pg_temp.act(v_actor.profile);
    v_ok := exists (select 1 from public.project_planning_settings where project_id = A)
        and exists (select 1 from public.planning_work_items where project_id = A)
        and (select count(*) from public.planning_activities where project_id = A) = 2
        and exists (select 1 from public.planning_import_batches where project_id = A)
        and exists (select 1 from public.planning_import_rows where batch_id = pg_temp.id('ARC_BATCH'))
        and exists (select 1 from public.planning_confirmations where activity_id = pg_temp.id('ARC_A1'))
        and exists (select 1 from public.planning_baselines where project_id = A)
        and exists (select 1 from public.planning_opening_positions where project_id = A)
        and exists (select 1 from public.planning_milestone_links where id = pg_temp.id('ARC_LINK'))
        and (select count(*) from public.master_milestones where project_id = A) = 2
        and (select count(*) from public.milestone_updates where milestone_id = pg_temp.id('ARC_M1')) = 2
        and exists (select 1 from public.weekly_milestone_drafts where id = pg_temp.id('ARC_DRAFT'))
        and exists (select 1 from public.master_deliverables where project_id = A)
        and exists (select 1 from public.deliverable_updates where id = pg_temp.id('ARC_DU'));
    perform pg_temp.chk(3, '03 ARCHIVED READS', 'every Planning / Milestone / Deliverable record stays readable — ' || v_actor.label, v_ok);
    perform pg_temp.owner();
  end loop;

  perform pg_temp.act(pg_temp.id('P_V'));
  perform pg_temp.chk(3, '03 ARCHIVED READS', 'a plain viewer still reads the archived milestone and deliverable registers and approved progress',
    (select count(*) from public.master_milestones where project_id = A) = 2
    and exists (select 1 from public.master_deliverables where project_id = A)
    and exists (select 1 from public.milestone_updates where id = pg_temp.id('ARC_AU')));
  perform pg_temp.owner();

  perform pg_temp.act(pg_temp.id('P_SA'));
  perform pg_temp.chk(3, '03 ARCHIVED READS', 'legacy archived projects: historical snapshots and milestones stay readable',
    exists (select 1 from public.planning_snapshots s join public.projects p on p.id = s.project_id
             where p.status = 'archived' and p.code not like 'ZZ-139-%')
    and exists (select 1 from public.master_milestones m join public.projects p on p.id = m.project_id
                 where p.status = 'archived' and p.code not like 'ZZ-139-%'));
  perform pg_temp.owner();

  perform pg_temp.chk(3, '03 ARCHIVED READS', 'the archived project''s records are byte-for-byte unchanged after every refused write',
    pg_temp.print(A) = (select note from ids where key = 'ARC_PRINT'));
  perform pg_temp.chk(3, '03 ARCHIVED READS', 'legacy archived projects'' records are byte-for-byte unchanged',
    (select md5(coalesce(string_agg(pg_temp.print(p.id), ',' order by p.id), ''))
       from public.projects p where p.status = 'archived' and p.code not like 'ZZ-139-%')
    = (select note from ids where key = 'LEGACY_PRINT'));
end $reads$;

/* ===== 4. active project: the same operations still succeed ============== */

do $act$
declare
  P uuid := pg_temp.project('ZZ-139-ACT');
  WI uuid := pg_temp.id('ACT_WI1');
  A1 uuid := pg_temp.id('ACT_A1');
  BATCH uuid := pg_temp.id('ACT_BATCH');
  OP uuid := pg_temp.id('ACT_OP');
  M1 uuid := pg_temp.id('ACT_M1');
  M2 uuid := pg_temp.id('ACT_M2');
  D1 uuid := pg_temp.id('ACT_D1');
  WR uuid := pg_temp.id('ACT_WR');
  v_actor record;
  s text;
  t text;
begin
  for v_actor in
    select * from (values (1, 'X', 'assigned Project Control', pg_temp.id('P_X')),
                          (2, 'PCA', 'Project Control Admin', pg_temp.id('P_PCA')),
                          (3, 'SA', 'System Administrator', pg_temp.id('P_SA'))) a(n, suffix, label, profile)
     order by n
  loop
    perform pg_temp.act(v_actor.profile);
    s := v_actor.suffix;
    t := ' — ' || v_actor.label;

    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'add a WBS node' || t,
      format('insert into public.planning_work_items (project_id, code, name) values (%L, %L, %L)', P, 'WI-' || s, 'x'));
    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'edit a WBS node' || t,
      format('update public.planning_work_items set name = %L where id = %L', 'ZZ RBI ' || s, WI));
    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'add an activity' || t,
      format('insert into public.planning_activities (project_id, work_item_id, code, external_id, name) values (%L, %L, %L, %L, %L)',
             P, WI, 'A-' || s, 'EXT-' || s, 'x'));
    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'edit an activity (apply imported progress)' || t,
      format('update public.planning_activities set percent_complete_physical = 40 where id = %L', A1));
    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'upload an import batch' || t,
      format('insert into public.planning_import_batches (project_id, source_type, file_name, data_date) values (%L, %L, %L, %L)',
             P, 'p6', 'zz139-' || s || '.xlsx', '2026-10-08'));
    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'validate that import batch' || t,
      format('update public.planning_import_batches set status = %L, validated_at = now() where project_id = %L and file_name = %L',
             'validated', P, 'zz139-' || s || '.xlsx'));
    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'add a raw import row' || t,
      format('insert into public.planning_import_rows (batch_id, row_number, external_id, name) values (%L, %s, %L, %L)',
             BATCH, 10 + v_actor.n, 'EXT-R' || s, 'x'));
    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'apply an import decision (confirmation)' || t,
      format('insert into public.planning_confirmations (activity_id, action, field_name, new_value, reason) values (%L, %L, %L, %L, %L)',
             A1, 'adjust', 'percent_complete_physical', '40', 'ZZ ' || s));
    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'create a baseline' || t,
      format('insert into public.planning_baselines (project_id, name, baseline_date) values (%L, %L, %L)', P, 'ZZ BL ' || s, '2026-10-01'));
    perform pg_temp.must_pass(4, '04 ACTIVE · PLANNING', 'change Planning settings' || t,
      format('update public.project_planning_settings set default_import_source = %L where project_id = %L', 'p6', P));
    perform pg_temp.must_pass(4, '04 ACTIVE · SNAPSHOT', 'edit the draft Opening Position' || t,
      format('update public.planning_opening_positions set source = %L where id = %L', 'ZZ source ' || s, OP));
    perform pg_temp.must_pass(4, '04 ACTIVE · SNAPSHOT', 'publish a manual snapshot (publish RPC)' || t,
      format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date)', P, '2026-10-10'));

    perform pg_temp.must_pass(4, '04 ACTIVE · MILESTONES', 'create a governed milestone' || t,
      format('insert into public.master_milestones (project_id, code, name) values (%L, %L, %L)', P, 'M-' || s, 'x'));
    perform pg_temp.must_pass(4, '04 ACTIVE · MILESTONES', 'edit a governed milestone (re-plan)' || t,
      format('update public.master_milestones set planned_date = %L where id = %L', '2027-01-15', M1));
    perform pg_temp.must_pass(4, '04 ACTIVE · MILESTONES', 'link a milestone to a planning activity' || t,
      format('insert into public.planning_milestone_links (master_milestone_id, activity_id) select %L, id from public.planning_activities where project_id = %L and code = %L',
             M2, P, 'A-' || s));
    perform pg_temp.must_pass(4, '04 ACTIVE · MILESTONES', 'append milestone progress' || t,
      format('insert into public.milestone_updates (milestone_id, source, status, progress_percent, submitted_by_contact_id) values (%L, %L, %L, 35, public.current_contact_id())',
             M1, 'planning', 'in_progress'));
    perform pg_temp.must_pass(4, '04 ACTIVE · MILESTONES', 'decide (approve) that milestone update' || t,
      format('update public.milestone_updates set approval_status = %L where milestone_id = %L and approval_status = %L and submitted_by_contact_id = public.current_contact_id()',
             'approved', M1, 'pending'));
    perform pg_temp.must_pass(4, '04 ACTIVE · MILESTONES', 'add a Weekly milestone draft' || t,
      format('insert into public.weekly_milestone_drafts (weekly_report_id, milestone_id, status, progress_percent) select %L, id, %L, 10 from public.master_milestones where project_id = %L and code = %L',
             WR, 'in_progress', P, 'M-' || s));
    perform pg_temp.must_pass(4, '04 ACTIVE · MILESTONES', 'edit that Weekly milestone draft' || t,
      format('update public.weekly_milestone_drafts set progress_percent = 30 where weekly_report_id = %L and milestone_id = (select id from public.master_milestones where project_id = %L and code = %L)',
             WR, P, 'M-' || s));

    perform pg_temp.must_pass(4, '04 ACTIVE · DELIVERABLES', 'create a deliverable' || t,
      format('insert into public.master_deliverables (project_id, code, title) values (%L, %L, %L)', P, 'D-' || s, 'x'));
    perform pg_temp.must_pass(4, '04 ACTIVE · DELIVERABLES', 'edit a deliverable' || t,
      format('update public.master_deliverables set title = %L where id = %L', 'ZZ VDU RBI Report ' || s, D1));
    perform pg_temp.must_pass(4, '04 ACTIVE · DELIVERABLES', 'submit a deliverable update' || t,
      format('insert into public.deliverable_updates (deliverable_id, source, submitted_by_contact_id) values (%L, %L, public.current_contact_id())', D1, 'planning'));
    perform pg_temp.must_pass(4, '04 ACTIVE · DELIVERABLES', 'decide that deliverable update' || t,
      format('update public.deliverable_updates set approval_status = %L where deliverable_id = %L and approval_status = %L and submitted_by_contact_id = public.current_contact_id()',
             'approved', D1, 'pending'));

    perform pg_temp.owner();
  end loop;

  -- One-off writes, once per project: import publish, link removal, draft removal.
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_pass(4, '04 ACTIVE · SNAPSHOT', 'publish a snapshot from the validated import batch (apply import) — assigned Project Control',
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_import_batch_id => %L::uuid)', P, BATCH));
  perform pg_temp.must_pass(4, '04 ACTIVE · MILESTONES', 'remove a milestone link — assigned Project Control',
    format('delete from public.planning_milestone_links where id = %L', pg_temp.id('ACT_LINK')));
  perform pg_temp.must_pass(4, '04 ACTIVE · MILESTONES', 'delete a Weekly milestone draft — assigned Project Control',
    format('delete from public.weekly_milestone_drafts where id = %L', pg_temp.id('ACT_DRAFT')));
  perform pg_temp.owner();

  perform pg_temp.chk(4, '04 ACTIVE', 'the active project''s writes really landed (3 actors)',
    (select count(*) from public.planning_work_items where project_id = P) = 4
    and (select count(*) from public.master_milestones where project_id = P) = 5
    and (select count(*) from public.master_deliverables where project_id = P) = 4
    and (select count(*) from public.planning_snapshots where project_id = P) = 4
    and (select count(*) from public.milestone_updates where milestone_id = M1 and approval_status = 'approved') = 4);
end $act$;

/* ===== 5. active-project authority unchanged ============================== */

do $authority$
declare
  P uuid := pg_temp.project('ZZ-139-ACT');
  A uuid := pg_temp.project('ZZ-139-ARC');
  v_row record;
begin
  for v_row in
    select * from (values ('assigned Project Control', pg_temp.id('P_X'), true),
                          ('Project Control Admin', pg_temp.id('P_PCA'), true),
                          ('System Administrator', pg_temp.id('P_SA'), true),
                          ('assigned Reporting Coordinator', pg_temp.id('P_Y'), false),
                          ('plain viewer', pg_temp.id('P_V'), false)) a(label, profile, expected)
  loop
    perform pg_temp.act(v_row.profile);
    perform pg_temp.chk(5, '05 AUTHORITY', 'can_manage_project_operations() on the active project is unchanged — ' || v_row.label,
      coalesce(public.can_manage_project_operations(P), false) = v_row.expected);
    perform pg_temp.chk(5, '05 AUTHORITY', 'can_manage_project_operations() on the archived project is unchanged (the boundary is the guard, not the predicate) — ' || v_row.label,
      coalesce(public.can_manage_project_operations(A), false) = v_row.expected);
    perform pg_temp.owner();
  end loop;

  perform pg_temp.act(pg_temp.id('P_Y'));
  perform pg_temp.must_fail(5, '05 AUTHORITY', 'the Reporting Coordinator is still refused a governed milestone on the active project (RLS, not the archive guard)',
    format('insert into public.master_milestones (project_id, code, name) values (%L, %L, %L)', P, 'M-RC', 'x'), 'row-level security');
  perform pg_temp.must_fail(5, '05 AUTHORITY', 'the Reporting Coordinator is still refused a WBS node on the active project',
    format('insert into public.planning_work_items (project_id, code, name) values (%L, %L, %L)', P, 'WI-RC', 'x'), 'row-level security');
  perform pg_temp.owner();
  perform pg_temp.act(pg_temp.id('P_V'));
  perform pg_temp.must_fail(5, '05 AUTHORITY', 'a plain viewer is still refused a deliverable on the active project',
    format('insert into public.master_deliverables (project_id, code, title) values (%L, %L, %L)', P, 'D-V', 'x'), 'row-level security');
  perform pg_temp.owner();

  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_fail(5, '05 AUTHORITY', 'append-only history still enforced: an approved milestone update cannot be edited (active project)',
    format('update public.milestone_updates set progress_percent = 99 where id = %L', pg_temp.id('ACT_AU')), 'cannot be edited');
  perform pg_temp.owner();
end $authority$;

/* ===== 6. lifecycle: no un-archive path; whole-project delete cascades ===== */

do $lifecycle$
declare
  D uuid := pg_temp.project('ZZ-139-DEL');
begin
  perform pg_temp.act(pg_temp.id('P_SA'));
  perform pg_temp.must_fail(6, '06 LIFECYCLE', 'there is still no un-archive path: setting an archived project back to active is refused (2C.3E, unchanged)',
    format('update public.projects set status = %L, active = true, archived_at = null where id = %L', 'active', pg_temp.project('ZZ-139-ARC')),
    'PROJECT_ARCHIVED');
  perform pg_temp.owner();

  perform pg_temp.must_pass(6, '06 LIFECYCLE', 'deleting a whole archived project still cascades through its planning, milestone and deliverable records',
    format('delete from public.projects where id = %L', D));
  perform pg_temp.chk(6, '06 LIFECYCLE', 'and leaves none of them behind',
    not exists (select 1 from public.planning_work_items where id = pg_temp.id('DEL_WI1'))
    and not exists (select 1 from public.master_milestones where id = pg_temp.id('DEL_M1'))
    and not exists (select 1 from public.master_deliverables where id = pg_temp.id('DEL_D1'))
    and not exists (select 1 from public.planning_import_batches where id = pg_temp.id('DEL_BATCH')));
end $lifecycle$;

/* ================================ 7. catalog ============================== */

do $catalog$
declare
  v_tables text[] := array[
    'project_planning_settings', 'planning_import_batches', 'planning_import_rows',
    'planning_work_items', 'planning_activities', 'planning_confirmations',
    'planning_baselines', 'planning_milestone_links', 'planning_snapshots',
    'planning_snapshot_activities', 'planning_opening_positions',
    'master_milestones', 'milestone_updates', 'weekly_milestone_drafts',
    'master_deliverables', 'deliverable_updates'];
begin
  perform pg_temp.chk(7, '07 CATALOG', 'the guard is a BEFORE INSERT / UPDATE / DELETE row trigger on all 16 tables',
    (select count(*) from pg_trigger g
      where g.tgname = 'block_archived_project_planning' and not g.tgisinternal
        and g.tgtype = (1 | 2 | 4 | 8 | 16)
        and g.tgrelid::regclass::text = any (select 'public.' || t from unnest(v_tables) t union select t from unnest(v_tables) t)) = 16);
  perform pg_temp.chk(7, '07 CATALOG', 'it answers before every other BEFORE row trigger on each table',
    not exists (select 1 from pg_trigger g join pg_trigger o on o.tgrelid = g.tgrelid
                 where g.tgname = 'block_archived_project_planning' and not o.tgisinternal
                   and (o.tgtype & 3) = 3 and o.tgname < g.tgname));
  perform pg_temp.chk(7, '07 CATALOG', 'the guard function is not callable by anon, authenticated or service_role',
    not has_function_privilege('anon', 'public.guard_archived_project_planning()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_archived_project_planning()', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.guard_archived_project_planning()', 'EXECUTE'));
  perform pg_temp.chk(7, '07 CATALOG', 'every policy on the 16 tables is byte-for-byte unchanged (44 policies, pre-13.9 fingerprint)',
    (select count(*) || '|' || md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                                               E'\n' order by tablename, policyname))
       from pg_policies where schemaname = 'public' and tablename = any (v_tables))
    = '44|86f1323db3600887c00f42a0aa0c1960');
  perform pg_temp.chk(7, '07 CATALOG', 'can_manage_project_operations() is byte-for-byte unchanged (pre-13.9 fingerprint)',
    (select md5(prosrc) from pg_proc where oid = 'public.can_manage_project_operations(uuid)'::regprocedure)
    = '05c5f58290be4341497507fffc05c2a0');
  perform pg_temp.chk(7, '07 CATALOG', 'the 2C.3E archived setup guards are still installed',
    (select count(*) from pg_trigger where tgname = 'block_archived_project_setup') = 8);
end $catalog$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;
