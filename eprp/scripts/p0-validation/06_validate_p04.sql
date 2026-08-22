-- EPRP P0.4 validation — Monthly compiles approved Weekly data only.
--
-- WHAT THIS PROVES
--   An unapproved Weekly cannot become Monthly content, an approved one can,
--   manual Monthly content is unaffected, editing a compiled row still works,
--   and recompiling is idempotent.
--
-- NEEDS NO TEST ACCOUNT: every check runs as the owning role, because the guard
-- is a TRIGGER, not a policy. That is the point of C1 — a policy-based guard
-- would let the owner straight through.
--
-- HOW TO RUN
--   psql "<pooler connection string>" -f 06_validate_p04.sql
--
-- Runs inside a transaction that is ROLLED BACK.

\set ON_ERROR_STOP on

begin;

do $val$
declare
  v_project  uuid;
  v_dept     uuid;
  v_monthly  uuid;
  v_wk_draft uuid;
  v_wk_ok    uuid;
  v_e_draft  uuid;
  v_e_ok     uuid;
  v_id       uuid;
  v_count    integer;
  v_fail     integer := 0;
  c1 boolean; c2 boolean; c3 boolean; c4 boolean; c5 boolean; c6 boolean;
begin
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'Fixtures missing. Run 01_setup_test_fixtures.sql first.';
  end if;
  select id into v_dept from public.departments where code = 'ZZ-P0TEST-DEPT';

  insert into public.monthly_reports
    (report_number, project_id, reporting_month, status)
  values ('ZZ-P0TEST-M09', v_project, date_trunc('month', current_date)::date, 'draft')
  returning id into v_monthly;

  -- An UNAPPROVED Weekly with one flagged entry.
  insert into public.weekly_reports
    (report_number, project_id, status, week_number, period_start, period_end)
  values ('ZZ-P0TEST-W10', v_project, 'collecting', 10, current_date, current_date + 6)
  returning id into v_wk_draft;

  insert into public.weekly_entries
    (weekly_report_id, department_id, category, priority, description, include_in_monthly)
  values (v_wk_draft, v_dept, 'general', 'low',
          'Unapproved entry - must not compile', true)
  returning id into v_e_draft;

  -- An APPROVED Weekly with one flagged entry.
  insert into public.weekly_reports
    (report_number, project_id, status, week_number, period_start, period_end)
  values ('ZZ-P0TEST-W11', v_project, 'approved', 11, current_date + 7, current_date + 13)
  returning id into v_wk_ok;

  insert into public.weekly_entries
    (weekly_report_id, department_id, category, priority, description, include_in_monthly)
  values (v_wk_ok, v_dept, 'general', 'low',
          'Approved entry - must compile', true)
  returning id into v_e_ok;

  /* ================= C1: unapproved source refused (trigger) ============== */

  begin
    insert into public.monthly_comments
      (monthly_report_id, source_weekly_entry_id, source_weekly_report_id,
       source_kind, original_text)
    values (v_monthly, v_e_draft, v_wk_draft, 'weekly', 'should be refused');
    c1 := false;
  exception when check_violation then
    c1 := true;
  end;

  /* ============ C2: entry-only reference cannot evade the check =========== */

  begin
    insert into public.monthly_comments
      (monthly_report_id, source_weekly_entry_id, source_kind, original_text)
    values (v_monthly, v_e_draft, 'weekly', 'should also be refused');
    c2 := false;
  exception when check_violation then
    c2 := true;
  end;

  /* ==================== C3: approved source is accepted =================== */

  begin
    insert into public.monthly_comments
      (monthly_report_id, source_weekly_entry_id, source_weekly_report_id,
       source_kind, original_text)
    values (v_monthly, v_e_ok, v_wk_ok, 'weekly', 'Approved entry - must compile')
    returning id into v_id;
    c3 := true;
  exception when others then
    c3 := false;
  end;

  /* ============== C4: manual Monthly content is unaffected =============== */

  begin
    insert into public.monthly_comments
      (monthly_report_id, source_kind, original_text)
    values (v_monthly, 'monthly_manual', 'Manual Monthly addition');
    c4 := true;
  exception when others then
    c4 := false;
  end;

  /* ====== C5: editing a compiled row still works (provenance, not edit) === */

  begin
    update public.monthly_comments
       set presentation_text = 'edited after compilation'
     where id = v_id;
    c5 := true;
  exception when others then
    c5 := false;
  end;

  /* ================== C6: recompiling does not duplicate ================= */

  insert into public.monthly_comments
    (monthly_report_id, source_weekly_entry_id, source_weekly_report_id,
     source_kind, original_text)
  values (v_monthly, v_e_ok, v_wk_ok, 'weekly', 'Approved entry - must compile')
  on conflict (source_weekly_entry_id) do nothing;

  select count(*) into v_count
    from public.monthly_comments
   where monthly_report_id = v_monthly and source_weekly_entry_id = v_e_ok;
  c6 := (v_count = 1);

  /* ============ Census: pre-existing rows from ineligible Weeklies ======== */

  select count(*) into v_count
    from public.monthly_comments mc
    join public.weekly_reports w on w.id = mc.source_weekly_report_id
   where not public.report_status_is_approved(w.status)
     and mc.monthly_report_id <> v_monthly;

  /* ================================ Report =============================== */

  if c1 then raise notice 'PASS  C1 unapproved Weekly source refused at the data boundary';
  else raise notice 'FAIL  C1 unapproved Weekly compiled into Monthly'; v_fail := v_fail + 1; end if;

  if c2 then raise notice 'PASS  C2 entry-only reference could not evade the check';
  else raise notice 'FAIL  C2 guard bypassed by omitting source_weekly_report_id'; v_fail := v_fail + 1; end if;

  if c3 then raise notice 'PASS  C3 approved Weekly source accepted';
  else raise notice 'FAIL  C3 approved Weekly was refused - the rule is too strict'; v_fail := v_fail + 1; end if;

  if c4 then raise notice 'PASS  C4 manual Monthly content unaffected';
  else raise notice 'FAIL  C4 manual Monthly content was blocked'; v_fail := v_fail + 1; end if;

  if c5 then raise notice 'PASS  C5 compiled row still editable (guard governs provenance only)';
  else raise notice 'FAIL  C5 compiled row became uneditable'; v_fail := v_fail + 1; end if;

  if c6 then raise notice 'PASS  C6 recompiling did not duplicate (idempotent)';
  else raise notice 'FAIL  C6 duplicate compiled row created'; v_fail := v_fail + 1; end if;

  raise notice '---';
  raise notice 'INFO  % pre-existing Monthly row(s) elsewhere come from a Weekly that is not currently approved.', v_count;
  raise notice '      These are PRESERVED by design. Review before the next Monthly issue.';

  raise notice '---';
  if v_fail = 0 then
    raise notice 'P0.4 VALIDATION: ALL 6 CHECKS PASSED';
  else
    raise notice 'P0.4 VALIDATION: % CHECK(S) FAILED - DO NOT ACCEPT', v_fail;
  end if;
end;
$val$;

rollback;
