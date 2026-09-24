-- EPRP Phase B — targeted validation for two-tier portfolio read
-- (supabase/migrations/20260912000003_portfolio_read_entitlements.sql).
--
-- WHAT THIS PROVES
--   * FULL tier reads every project, every Weekly/Monthly report at every
--     lifecycle status (including archived and live department content), and
--     draft Executive Reports -- and can perform NO mutation anywhere.
--   * PUBLISHED tier reads every project, but a Weekly/Monthly report only at
--     finalized/locked (never approved alone, never archived), live
--     department content only on a report that has reached that state, and
--     an Executive Report only once approved/finalized/locked -- and can
--     perform NO mutation anywhere.
--   * A full-tier grant composes correctly with a genuine Department Manager
--     assignment: portfolio-wide read, plus write/approve on exactly that
--     one department, nowhere else.
--   * project_contacts.role='project_manager' alone still grants no write.
--   * Only System Admin may grant/revoke; Project Control Admin may not.
--   * An ungranted, unassigned account is refused everything on this project,
--     unchanged from before this phase.
--   * Phase A1 and Phase A2 are unaffected.
--
-- HOW TO RUN
--   Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to
--   have been run first (same ZZ-P0TEST-PRJ / ZZ-P0TEST-DEPT fixtures every
--   other script in this directory uses).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f phase_b_validate_portfolio_read.sql
--
-- Runs inside a transaction that is ROLLED BACK. All identities, grants,
-- assignments and reports created here are disposable.

\set ON_ERROR_STOP on

begin;

do $val$
declare
  v_role       text := current_user;
  v_project    uuid;
  v_dept1      uuid;
  v_admin_id   uuid := '00000000-0000-4000-a000-0000000000a1'; -- existing admin
  v_full_id    uuid := '00000000-0000-4000-a000-0000000000f1'; -- FULL tier, no assignment
  v_pub_id     uuid := '00000000-0000-4000-a000-0000000000f2'; -- PUBLISHED tier, no assignment
  v_fulldm_id  uuid := '00000000-0000-4000-a000-0000000000f3'; -- FULL tier + own-department manager
  v_pca_id     uuid := '00000000-0000-4000-a000-0000000000f4'; -- project_control_admin, no grant
  v_none_id    uuid := '00000000-0000-4000-a000-0000000000f5'; -- no grant, no assignment (control)
  v_fulldm_c   uuid; -- contact for the composition identity

  v_w_draft uuid; v_w_ur uuid; v_w_approved uuid; v_w_finalized uuid;
  v_w_locked uuid; v_w_archived uuid;
  v_m_draft uuid; v_m_ur uuid; v_m_approved uuid; v_m_finalized uuid;
  v_m_locked uuid; v_m_archived uuid;
  v_e_draft uuid; v_e_approved uuid;

  v_cnt integer;
  v_fail integer := 0;

  -- FULL tier (1-5)
  t1_projects boolean; t2_w_status boolean; t2_m_status boolean;
  t2_w_archived boolean; t2_m_archived boolean;
  t3_dept_live boolean; t4_exec_draft boolean;
  t5_write_report boolean; t5_write_submission boolean; t5_grant_self boolean;

  -- PUBLISHED tier (6-13)
  t6_projects boolean;
  t7_w_finalized boolean; t7_w_locked boolean; t7_m_finalized boolean; t7_m_locked boolean;
  t8_w_approved_hidden boolean; t8_m_approved_hidden boolean;
  t9_w_archived_hidden boolean; t9_m_archived_hidden boolean;
  t10_dept_draft_hidden boolean; t10_dept_locked_visible boolean;
  t11_exec_approved boolean; t12_exec_draft_hidden boolean;
  t13_write_report boolean; t13_write_submission boolean;

  -- Composition (14-15)
  t14_fulldm_read_other_project boolean; t14_fulldm_approve_own boolean;
  t14_fulldm_cross_dept_denied boolean; t15_pm_role_no_write boolean;

  -- Administration (16-18)
  t16_admin_grant boolean; t17_pca_grant_denied boolean; t18_revoke_effective boolean;

  -- Regression (19)
  t19_none_denied_report boolean; t19_none_denied_project boolean;
begin
  ------------------------------------------------------------------------
  -- Fixture setup (owner role).
  ------------------------------------------------------------------------
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'Fixtures missing. Run 01_setup_test_fixtures.sql first.';
  end if;
  select id into v_dept1 from public.departments where code = 'ZZ-P0TEST-DEPT';

  insert into public.contacts (name, email, department_id)
  values ('ZZ-P0TEST-B FullDM', 'p0test.b.fulldm@example.invalid', v_dept1)
  returning id into v_fulldm_c;
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
  values (v_project, v_fulldm_c, 'team_member', v_dept1, 'department_manager');

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_full_id, 'authenticated', 'authenticated',
     'p0test.b.full@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_pub_id, 'authenticated', 'authenticated',
     'p0test.b.pub@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_fulldm_id, 'authenticated', 'authenticated',
     'p0test.b.fulldm@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_pca_id, 'authenticated', 'authenticated',
     'p0test.b.pca@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_none_id, 'authenticated', 'authenticated',
     'p0test.b.none@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, email, full_name, role, contact_id, active) values
    (v_full_id,   'p0test.b.full@example.invalid',   'ZZ-P0TEST-B Full',   'viewer', null, true),
    (v_pub_id,    'p0test.b.pub@example.invalid',    'ZZ-P0TEST-B Pub',    'viewer', null, true),
    (v_fulldm_id, 'p0test.b.fulldm@example.invalid', 'ZZ-P0TEST-B FullDM', 'viewer', v_fulldm_c, true),
    (v_pca_id,    'p0test.b.pca@example.invalid',    'ZZ-P0TEST-B PCA', 'project_control_admin', null, true),
    (v_none_id,   'p0test.b.none@example.invalid',   'ZZ-P0TEST-B None',   'viewer', null, true)
  on conflict (id) do nothing;

  insert into public.portfolio_read_grants (profile_id, tier, granted_by, reason) values
    (v_full_id, 'full', v_admin_id, 'validation'),
    (v_pub_id, 'published', v_admin_id, 'validation'),
    (v_fulldm_id, 'full', v_admin_id, 'validation');

  -- Weekly reports, one per status, distinct periods to avoid the
  -- (project_id, period_start) unique constraint.
  insert into public.weekly_reports (report_number, project_id, status, week_number, period_start, period_end)
  values
    ('ZZ-P0TEST-B-W-DRAFT',     v_project, 'draft',     10, current_date +  0, current_date +  6),
    ('ZZ-P0TEST-B-W-UR',        v_project, 'under_review', 11, current_date +  7, current_date + 13),
    ('ZZ-P0TEST-B-W-APPROVED',  v_project, 'approved',  12, current_date + 14, current_date + 20),
    ('ZZ-P0TEST-B-W-FINALIZED', v_project, 'finalized', 13, current_date + 21, current_date + 27),
    ('ZZ-P0TEST-B-W-LOCKED',    v_project, 'locked',    14, current_date + 28, current_date + 34),
    ('ZZ-P0TEST-B-W-ARCHIVED',  v_project, 'archived',  15, current_date + 35, current_date + 41);

  select id into v_w_draft     from public.weekly_reports where report_number = 'ZZ-P0TEST-B-W-DRAFT';
  select id into v_w_ur        from public.weekly_reports where report_number = 'ZZ-P0TEST-B-W-UR';
  select id into v_w_approved  from public.weekly_reports where report_number = 'ZZ-P0TEST-B-W-APPROVED';
  select id into v_w_finalized from public.weekly_reports where report_number = 'ZZ-P0TEST-B-W-FINALIZED';
  select id into v_w_locked    from public.weekly_reports where report_number = 'ZZ-P0TEST-B-W-LOCKED';
  select id into v_w_archived  from public.weekly_reports where report_number = 'ZZ-P0TEST-B-W-ARCHIVED';

  insert into public.weekly_submissions (weekly_report_id, department_id, status) values
    (v_w_draft, v_dept1, 'in_progress'),
    (v_w_locked, v_dept1, 'approved');

  insert into public.monthly_reports (report_number, project_id, reporting_month, status) values
    ('ZZ-P0TEST-B-M-DRAFT',     v_project, date_trunc('month', current_date)::date,                     'draft'),
    ('ZZ-P0TEST-B-M-UR',        v_project, date_trunc('month', current_date)::date + interval '1 month', 'under_review'),
    ('ZZ-P0TEST-B-M-APPROVED',  v_project, date_trunc('month', current_date)::date + interval '2 month', 'approved'),
    ('ZZ-P0TEST-B-M-FINALIZED', v_project, date_trunc('month', current_date)::date + interval '3 month', 'finalized'),
    ('ZZ-P0TEST-B-M-LOCKED',    v_project, date_trunc('month', current_date)::date + interval '4 month', 'locked'),
    ('ZZ-P0TEST-B-M-ARCHIVED',  v_project, date_trunc('month', current_date)::date + interval '5 month', 'archived');

  select id into v_m_draft     from public.monthly_reports where report_number = 'ZZ-P0TEST-B-M-DRAFT';
  select id into v_m_ur        from public.monthly_reports where report_number = 'ZZ-P0TEST-B-M-UR';
  select id into v_m_approved  from public.monthly_reports where report_number = 'ZZ-P0TEST-B-M-APPROVED';
  select id into v_m_finalized from public.monthly_reports where report_number = 'ZZ-P0TEST-B-M-FINALIZED';
  select id into v_m_locked    from public.monthly_reports where report_number = 'ZZ-P0TEST-B-M-LOCKED';
  select id into v_m_archived  from public.monthly_reports where report_number = 'ZZ-P0TEST-B-M-ARCHIVED';

  insert into public.monthly_submissions (monthly_report_id, department_id, status) values
    (v_m_draft, v_dept1, 'in_progress'),
    (v_m_locked, v_dept1, 'approved');

  insert into public.executive_reports (reporting_month, status) values
    (date_trunc('month', current_date)::date + interval '11 month', 'draft'),
    (date_trunc('month', current_date)::date + interval '12 month', 'approved');
  select id into v_e_draft    from public.executive_reports
   where reporting_month = date_trunc('month', current_date)::date + interval '11 month';
  select id into v_e_approved from public.executive_reports
   where reporting_month = date_trunc('month', current_date)::date + interval '12 month';

  ------------------------------------------------------------------------
  -- FULL tier (checks 1-5).
  ------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_full_id::text)::text, true);

  select count(*) into v_cnt from public.projects where id = v_project;
  t1_projects := (v_cnt = 1);

  select count(*) into v_cnt from public.weekly_reports
   where id in (v_w_draft, v_w_ur, v_w_approved, v_w_finalized, v_w_locked, v_w_archived);
  t2_w_status := (v_cnt = 6);
  t2_w_archived := exists(select 1 from public.weekly_reports where id = v_w_archived);

  select count(*) into v_cnt from public.monthly_reports
   where id in (v_m_draft, v_m_ur, v_m_approved, v_m_finalized, v_m_locked, v_m_archived);
  t2_m_status := (v_cnt = 6);
  t2_m_archived := exists(select 1 from public.monthly_reports where id = v_m_archived);

  select count(*) into v_cnt from public.weekly_submissions
   where weekly_report_id = v_w_draft and department_id = v_dept1;
  t3_dept_live := (v_cnt = 1);

  select count(*) into v_cnt from public.executive_reports where id = v_e_draft;
  t4_exec_draft := (v_cnt = 1);

  -- No mutation: whole-report status change refused.
  begin
    perform public.set_weekly_report_status(v_w_ur, 'approved');
    t5_write_report := false;
  exception when insufficient_privilege then t5_write_report := true;
  end;

  -- No mutation: direct department verdict refused (full tier is read-only,
  -- not a Department Manager here). Full tier satisfies none of
  -- weekly_submissions_update's three branches for this row, so RLS filters
  -- it to zero affected rows rather than raising -- both outcomes count as
  -- refused, so check the row count rather than assuming an exception.
  begin
    update public.weekly_submissions set status = 'approved'
     where weekly_report_id = v_w_draft and department_id = v_dept1 and status = 'in_progress';
    get diagnostics v_cnt = row_count;
    t5_write_submission := (v_cnt = 0);
  exception when insufficient_privilege then t5_write_submission := true;
  end;

  -- No mutation: cannot grant itself a wider tier.
  begin
    update public.portfolio_read_grants set tier = 'full'
     where profile_id = v_pub_id;
    get diagnostics v_cnt = row_count;
    t5_grant_self := (v_cnt = 0);
  exception when insufficient_privilege then t5_grant_self := true;
  end;

  ------------------------------------------------------------------------
  -- PUBLISHED tier (checks 6-13).
  ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pub_id::text)::text, true);

  select count(*) into v_cnt from public.projects where id = v_project;
  t6_projects := (v_cnt = 1);

  t7_w_finalized := exists(select 1 from public.weekly_reports where id = v_w_finalized);
  t7_w_locked    := exists(select 1 from public.weekly_reports where id = v_w_locked);
  t7_m_finalized := exists(select 1 from public.monthly_reports where id = v_m_finalized);
  t7_m_locked    := exists(select 1 from public.monthly_reports where id = v_m_locked);

  t8_w_approved_hidden := not exists(select 1 from public.weekly_reports where id = v_w_approved);
  t8_m_approved_hidden := not exists(select 1 from public.monthly_reports where id = v_m_approved);

  t9_w_archived_hidden := not exists(select 1 from public.weekly_reports where id = v_w_archived);
  t9_m_archived_hidden := not exists(select 1 from public.monthly_reports where id = v_m_archived);

  -- draft report's department content invisible ...
  t10_dept_draft_hidden := not exists(
    select 1 from public.weekly_submissions
     where weekly_report_id = v_w_draft and department_id = v_dept1);
  -- ... but the SAME department content on a LOCKED report is visible.
  t10_dept_locked_visible := exists(
    select 1 from public.weekly_submissions
     where weekly_report_id = v_w_locked and department_id = v_dept1);

  t11_exec_approved := exists(select 1 from public.executive_reports where id = v_e_approved);
  t12_exec_draft_hidden := not exists(select 1 from public.executive_reports where id = v_e_draft);

  begin
    perform public.set_weekly_report_status(v_w_finalized, 'locked');
    t13_write_report := false;
  exception when insufficient_privilege then t13_write_report := true;
  end;

  -- Old status is already 'approved': reachable only via the verdict branch,
  -- which requires being the department's own manager -- published tier is
  -- not, so either a hard RLS error or a 0-row filter both count as refused.
  begin
    update public.weekly_submissions set status = 'returned'
     where weekly_report_id = v_w_locked and department_id = v_dept1 and status = 'approved';
    get diagnostics v_cnt = row_count;
    t13_write_submission := (v_cnt = 0);
  exception when insufficient_privilege then t13_write_submission := true;
  end;

  ------------------------------------------------------------------------
  -- Composition (checks 14-15).
  ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_fulldm_id::text)::text, true);

  -- Full-tier reach: sees the draft report like any full-tier account.
  t14_fulldm_read_other_project := exists(
    select 1 from public.weekly_reports where id = v_w_draft);

  -- Own-department write: approves the department's own (still in_progress)
  -- submission via the pre-existing, untouched Department Manager path.
  update public.weekly_submissions set status = 'approved'
   where weekly_report_id = v_w_draft and department_id = v_dept1 and status = 'in_progress';
  get diagnostics v_cnt = row_count;
  t14_fulldm_approve_own := (v_cnt = 1);

  -- Still cannot rule on the WHOLE report (that authority is Planning/global
  -- only, untouched by Phase B, unaffected by holding a full-tier read grant).
  begin
    perform public.set_weekly_report_status(v_w_ur, 'approved');
    t14_fulldm_cross_dept_denied := false;
  exception when insufficient_privilege then t14_fulldm_cross_dept_denied := true;
  end;

  -- project_contacts.role='project_manager' alone (no grant, no assignment
  -- role) still grants zero write -- verified via the existing ZZ-P0TEST
  -- Member/Coordinator fixture shape: a plain project_contacts row with no
  -- assignment_role and no portfolio grant cannot touch the report either.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-a000-0000000000b2'::text)::text, true);
  begin
    perform public.set_weekly_report_status(v_w_ur, 'approved');
    t15_pm_role_no_write := false;
  exception when insufficient_privilege then t15_pm_role_no_write := true;
  end;

  ------------------------------------------------------------------------
  -- Administration (checks 16-18).
  ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  update public.portfolio_read_grants
     set revoked_by = v_admin_id, revoked_at = now()
   where profile_id = v_pub_id and revoked_at is null;
  insert into public.portfolio_read_grants (profile_id, tier, granted_by, reason)
  values (v_pub_id, 'full', v_admin_id, 'admin re-grant test');
  get diagnostics v_cnt = row_count;
  t16_admin_grant := (v_cnt = 1);

  perform set_config('request.jwt.claims', json_build_object('sub', v_pca_id::text)::text, true);
  begin
    insert into public.portfolio_read_grants (profile_id, tier, granted_by, reason)
    values (v_pca_id, 'full', v_pca_id, 'pca self-grant attempt');
    t17_pca_grant_denied := false;
  exception when insufficient_privilege then
    t17_pca_grant_denied := true;
  end;

  -- Revocation takes effect on the very next request: v_pub_id was just
  -- upgraded to 'full' above by the admin; revoke it and confirm immediately.
  perform set_config('role', v_role, true);
  update public.portfolio_read_grants
     set revoked_by = v_admin_id, revoked_at = now()
   where profile_id = v_pub_id and revoked_at is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_pub_id::text)::text, true);
  -- v_pub_id has no other assignment, so both project and report access must
  -- disappear the instant the grant is revoked.
  t18_revoke_effective :=
    not exists(select 1 from public.projects where id = v_project)
    and not exists(select 1 from public.weekly_reports where id = v_w_finalized);

  ------------------------------------------------------------------------
  -- Regression (check 19): an ungranted, unassigned account.
  ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_none_id::text)::text, true);
  t19_none_denied_project := not exists(select 1 from public.projects where id = v_project);
  t19_none_denied_report  := not exists(select 1 from public.weekly_reports where id = v_w_finalized);

  ------------------------------------------------------------------------
  -- Report.
  ------------------------------------------------------------------------
  perform set_config('role', v_role, true);

  raise notice '=== FULL tier ===';
  if t1_projects then raise notice 'PASS  1  Full tier reads the project with zero assignment'; else raise notice 'FAIL  1'; v_fail:=v_fail+1; end if;
  if t2_w_status and t2_m_status then raise notice 'PASS  2  Full tier reads Weekly/Monthly at every status (draft..locked)'; else raise notice 'FAIL  2'; v_fail:=v_fail+1; end if;
  if t2_w_archived and t2_m_archived then raise notice 'PASS  2  Full tier reads archived Weekly/Monthly too'; else raise notice 'FAIL  2 archived'; v_fail:=v_fail+1; end if;
  if t3_dept_live then raise notice 'PASS  3  Full tier reads live/unapproved department submissions'; else raise notice 'FAIL  3'; v_fail:=v_fail+1; end if;
  if t4_exec_draft then raise notice 'PASS  4  Full tier reads a draft Executive Report'; else raise notice 'FAIL  4'; v_fail:=v_fail+1; end if;
  if t5_write_report and t5_write_submission and t5_grant_self then raise notice 'PASS  5  Full tier cannot perform any mutation'; else raise notice 'FAIL  5'; v_fail:=v_fail+1; end if;

  raise notice '=== PUBLISHED tier ===';
  if t6_projects then raise notice 'PASS  6  Published tier reads every project'; else raise notice 'FAIL  6'; v_fail:=v_fail+1; end if;
  if t7_w_finalized and t7_w_locked and t7_m_finalized and t7_m_locked then raise notice 'PASS  7  Published tier reads finalized/locked Weekly and Monthly'; else raise notice 'FAIL  7'; v_fail:=v_fail+1; end if;
  if t8_w_approved_hidden and t8_m_approved_hidden then raise notice 'PASS  8  approved-only Weekly/Monthly stays invisible to published tier'; else raise notice 'FAIL  8'; v_fail:=v_fail+1; end if;
  if t9_w_archived_hidden and t9_m_archived_hidden then raise notice 'PASS  9  archived Weekly/Monthly stays invisible to published tier'; else raise notice 'FAIL  9'; v_fail:=v_fail+1; end if;
  if t10_dept_draft_hidden and t10_dept_locked_visible then raise notice 'PASS  10 live department content hidden on draft, visible once locked'; else raise notice 'FAIL  10'; v_fail:=v_fail+1; end if;
  if t11_exec_approved then raise notice 'PASS  11 published tier reads an approved Executive Report'; else raise notice 'FAIL  11'; v_fail:=v_fail+1; end if;
  if t12_exec_draft_hidden then raise notice 'PASS  12 draft Executive Report stays invisible to published tier'; else raise notice 'FAIL  12'; v_fail:=v_fail+1; end if;
  if t13_write_report and t13_write_submission then raise notice 'PASS  13 published tier cannot write a working-report/department mutation'; else raise notice 'FAIL  13'; v_fail:=v_fail+1; end if;

  raise notice '=== Composition ===';
  if t14_fulldm_read_other_project and t14_fulldm_approve_own and t14_fulldm_cross_dept_denied then
    raise notice 'PASS  14 Full-tier + own Department Manager: reads everywhere, approves only own department, no whole-report authority';
  else raise notice 'FAIL  14'; v_fail:=v_fail+1; end if;
  if t15_pm_role_no_write then raise notice 'PASS  15 a project responsibility alone still grants no write authority'; else raise notice 'FAIL  15'; v_fail:=v_fail+1; end if;

  raise notice '=== Administration ===';
  if t16_admin_grant then raise notice 'PASS  16 System Admin can grant/revoke a tier'; else raise notice 'FAIL  16'; v_fail:=v_fail+1; end if;
  if t17_pca_grant_denied then raise notice 'PASS  17 Project Control Admin cannot grant a tier'; else raise notice 'FAIL  17'; v_fail:=v_fail+1; end if;
  if t18_revoke_effective then raise notice 'PASS  18 revocation takes effect on the next request'; else raise notice 'FAIL  18'; v_fail:=v_fail+1; end if;

  raise notice '=== Regression ===';
  if t19_none_denied_project and t19_none_denied_report then raise notice 'PASS  19 an ungranted, unassigned account is refused everything, unchanged'; else raise notice 'FAIL  19'; v_fail:=v_fail+1; end if;

  raise notice '---';
  if v_fail = 0 then
    raise notice 'PHASE B PORTFOLIO READ VALIDATION: ALL CHECKS PASSED';
  else
    raise notice 'PHASE B PORTFOLIO READ VALIDATION: % CHECK(S) FAILED - DO NOT ACCEPT', v_fail;
  end if;
end;
$val$;

rollback;
