-- EPRP — POST-WAVE-2 BEHAVIOURAL SMOKE TEST.
--
-- ############################################################################
-- ##  THIS ONE WRITES.  It is NOT read-only.                                ##
-- ##                                                                        ##
-- ##  Everything happens inside a transaction that ends in ROLLBACK, so no  ##
-- ##  row survives and no data is modified. But rows ARE created and        ##
-- ##  deleted inside the transaction, and sequence values are consumed.     ##
-- ##                                                                        ##
-- ##  OPTIONAL. 83_verify_wave2.sql proves the guards are installed and     ##
-- ##  enabled without writing anything. This proves they FIRE, which is a   ##
-- ##  different claim and cannot be made read-only.                         ##
-- ##                                                                        ##
-- ##  Run it only if you want that proof. Skipping it is a reasonable       ##
-- ##  choice — the UI smoke test covers the positive path.                  ##
-- ############################################################################
--
-- WHAT IT PROVES
--   1. A direct status UPDATE is refused, even for the owning role.
--   2. An illegal transition is refused by shape.
--   3. A legal transition with unmet conditions is refused.
--   4. Compiling from a non-approved Weekly is refused.
--   5. Manual Monthly content is unaffected.
--
-- It creates its own throwaway rows prefixed ZZ-SMOKE and touches nothing else.
--
-- HOW TO RUN
--   Dashboard -> SQL Editor -> paste -> Run. Read the NOTICE output.

\set ON_ERROR_STOP on

begin;

do $smoke$
declare
  v_project uuid; v_dept uuid; v_report uuid; v_monthly uuid; v_entry uuid;
  v_fail int := 0;
  s1 bool; s2 bool; s3 bool; s4 bool; s5 bool;
begin
  -- Any project will do; this only needs valid foreign keys.
  select id into v_project from public.projects where active order by created_at limit 1;
  if v_project is null then raise exception 'No project available for the smoke test.'; end if;
  select department_id into v_dept from public.project_departments
   where project_id = v_project limit 1;

  insert into public.weekly_reports
    (report_number, project_id, status, week_number, period_start, period_end)
  values ('ZZ-SMOKE-W1', v_project, 'collecting', 99, current_date, current_date + 6)
  returning id into v_report;

  /* 1 — direct status UPDATE must be refused, owner included ---------------- */
  begin
    update public.weekly_reports set status = 'finalized' where id = v_report;
    s1 := false;
  exception when insufficient_privilege then s1 := true;
            when others then s1 := false;
  end;

  /* 2 — illegal transition refused by shape --------------------------------- */
  begin
    perform public.set_weekly_report_status(v_report, 'locked');
    s2 := false;
  exception when check_violation then s2 := true;
            when insufficient_privilege then s2 := true;  -- authority checked first
            when others then s2 := false;
  end;

  /* 3 — legal shape, unmet stage condition, refused ------------------------- */
  begin
    perform public.set_weekly_report_status(v_report, 'under_review');
    s3 := false;
  exception when check_violation then s3 := true;
            when insufficient_privilege then s3 := true;
            when others then s3 := false;
  end;

  /* 4 — compiling from a NON-approved Weekly is refused --------------------- */
  insert into public.weekly_entries
    (weekly_report_id, department_id, category, priority, description, include_in_monthly)
  values (v_report, v_dept, 'general', 'low', 'ZZ-SMOKE unapproved', true)
  returning id into v_entry;

  insert into public.monthly_reports
    (report_number, project_id, reporting_month, status)
  values ('ZZ-SMOKE-M1', v_project, date_trunc('month', current_date)::date, 'draft')
  returning id into v_monthly;

  begin
    insert into public.monthly_comments
      (monthly_report_id, source_weekly_entry_id, source_weekly_report_id,
       source_kind, original_text)
    values (v_monthly, v_entry, v_report, 'weekly', 'ZZ-SMOKE should be refused');
    s4 := false;
  exception when check_violation then s4 := true;
            when others then s4 := false;
  end;

  /* 5 — manual Monthly content still accepted ------------------------------- */
  begin
    insert into public.monthly_comments
      (monthly_report_id, source_kind, original_text)
    values (v_monthly, 'monthly_manual', 'ZZ-SMOKE manual addition');
    s5 := true;
  exception when others then s5 := false;
  end;

  if s1 then raise notice 'PASS  S1 direct status UPDATE refused (guard fires)';
  else raise notice 'FAIL  S1 direct status write SUCCEEDED - guard not firing'; v_fail := v_fail + 1; end if;

  if s2 then raise notice 'PASS  S2 illegal transition refused';
  else raise notice 'FAIL  S2 illegal transition allowed'; v_fail := v_fail + 1; end if;

  if s3 then raise notice 'PASS  S3 unmet stage condition refused';
  else raise notice 'FAIL  S3 stage condition not enforced'; v_fail := v_fail + 1; end if;

  if s4 then raise notice 'PASS  S4 compile from non-approved Weekly refused';
  else raise notice 'FAIL  S4 unapproved Weekly compiled'; v_fail := v_fail + 1; end if;

  if s5 then raise notice 'PASS  S5 manual Monthly content still accepted';
  else raise notice 'FAIL  S5 manual Monthly content blocked'; v_fail := v_fail + 1; end if;

  raise notice '---';
  if v_fail = 0 then raise notice 'WAVE 2 BEHAVIOURAL SMOKE: ALL 5 PASSED';
  else raise notice 'WAVE 2 BEHAVIOURAL SMOKE: % FAILED', v_fail; end if;
  raise notice 'Everything above is rolled back. No row survives this test.';
end;
$smoke$;

rollback;
