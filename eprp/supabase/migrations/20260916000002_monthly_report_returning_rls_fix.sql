-- Monthly Report P0 — fix Project Control / Planning Monthly Report creation
-- blocked by the SAME self-referential RLS lookup during INSERT ... RETURNING
-- that 20260916000001 fixed for Weekly.
--
-- ROOT CAUSE (reproduced against local Postgres 17.6, same technique as the
-- Weekly fix):
--
--   monthly_reports_select's USING clause calls monthly_report_viewable(id),
--   which internally re-queries monthly_reports BY ID
--   (monthly_report_project(id): "select project_id from monthly_reports
--   where id = p_report") to rediscover the project_id this SAME ROW
--   already carries as a column. When this policy is re-checked for the
--   RETURNING clause of an INSERT (monthlyReportService.create() issues
--   exactly `.insert(...).select("*").single()`), that nested self-lookup
--   does not see the row this SAME command just inserted and returns NULL.
--
--   can_access_project(NULL) then correctly resolves its project-scoped
--   branch to FALSE for an assigned Project Control Manager / Planning
--   contact — an EXISTS query against project_contacts with project_id =
--   NULL matches nothing. But has_full_portfolio_read() / has_published_
--   portfolio_read(), OR'd into the same expression, return SQL NULL
--   rather than FALSE for a profile with no portfolio-read grant (see
--   20260916000001 for the full three-valued-logic explanation). FALSE OR
--   NULL is NULL, and RLS treats a NULL USING result as reject — exactly
--   the observed failure, reproduced locally in a rolled-back transaction:
--   an assigned Project Control Manager's INSERT ... RETURNING on
--   monthly_reports was refused with "new row violates row-level security
--   policy for table monthly_reports", identical to the pre-fix Weekly
--   symptom.
--
--   has_global_operational_authority() does not depend on the row's
--   project_id, so System Administrator / Project Control Admin were never
--   affected — exactly why this was invisible until a genuinely
--   project-scoped identity tried to create a Monthly Report.
--
-- FIX (smallest correct layer, identical shape to the Weekly fix):
-- monthly_reports_select does not need the self-lookup at all. project_id
-- and status are already columns ON the row this policy evaluates —
-- referencing them directly removes the self-referential query entirely.
-- Semantically identical to monthly_report_viewable(id) for every
-- already-existing, already-visible row; the only case that changes is the
-- one that was broken. Verified locally (same rolled-back-transaction
-- technique): the identical INSERT ... RETURNING that failed above
-- succeeds once this policy is applied.
--
-- monthly_report_viewable(uuid) itself is UNCHANGED and still used exactly
-- as before by the four Monthly child tables (monthly_comments,
-- monthly_submissions, monthly_department_summaries, monthly_plan_items),
-- where monthly_report_id points at an ALREADY-committed monthly_reports
-- row from an earlier, separate command — those uses never had this bug
-- and do not need to change. has_full_portfolio_read()/has_published_
-- portfolio_read()/portfolio_read_tier() remain unchanged for the same
-- reason given in 20260916000001 — shared, widely-used primitives; their
-- NULL-vs-FALSE gap for a no-grant profile is a real latent correctness
-- issue, but rewriting them is out of scope for this fix and is flagged
-- there, not duplicated here.
--
-- Weekly (weekly_reports_select) is untouched by this migration — already
-- fixed by 20260916000001; this migration's own postcondition proves it.
--
-- Forward-only. No prior migration is edited.

alter policy monthly_reports_select on public.monthly_reports
  using (
    public.can_access_project(project_id)
    or (
      public.has_published_portfolio_read()
      and public.weekly_report_completed(status)
    )
  );

comment on policy monthly_reports_select on public.monthly_reports is
  'Monthly Report P0 fix: reads project_id/status directly off the row being checked instead of self-querying monthly_reports by id through monthly_report_viewable(id) — that self-lookup does not see a row this SAME command just inserted, which silently failed INSERT ... RETURNING for any project-scoped identity (Project Control / Planning, assigned Report Coordinator) even though the same identity could read the row a moment later via a separate query. Semantically identical to monthly_report_viewable(id) otherwise: can_access_project() for the operational/full-portfolio-read tiers, plus the published tier''s own finalized/locked-only branch. Mirrors 20260916000001''s identical fix for weekly_reports_select.';

/* ----------------------------- postconditions ----------------------------- */

do $post$
declare
  v_qual text;
  v_using_missing integer;
begin
  select qual into v_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'monthly_reports' and policyname = 'monthly_reports_select';

  if v_qual is null then
    raise exception 'Post-check failed: monthly_reports_select policy not found.';
  end if;
  if v_qual like '%monthly_report_viewable%' then
    raise exception 'Post-check failed: monthly_reports_select still calls monthly_report_viewable(id) — the self-referential lookup this migration removes.';
  end if;
  if v_qual not like '%can_access_project%' or v_qual not like '%project_id%' then
    raise exception 'Post-check failed: monthly_reports_select does not reference can_access_project(project_id) directly.';
  end if;

  -- monthly_report_viewable() itself must still exist, unmodified, for the
  -- four child-table policies that still legitimately need it.
  select count(*) into v_using_missing
    from pg_policies
   where schemaname = 'public'
     and tablename in ('monthly_comments', 'monthly_submissions', 'monthly_department_summaries', 'monthly_plan_items')
     and policyname like '%_select'
     and coalesce(qual, '') not like '%monthly_report_viewable%';
  if v_using_missing > 0 then
    raise exception 'Post-check failed: % Monthly child-table select polic(y/ies) no longer reference monthly_report_viewable() — this migration must not touch them.', v_using_missing;
  end if;

  -- weekly_reports_select is deliberately untouched by this migration —
  -- already fixed by 20260916000001.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'weekly_reports' and policyname = 'weekly_reports_select'
       and qual like '%can_access_project%' and qual not like '%weekly_report_viewable%'
  ) then
    raise exception 'Post-check failed: weekly_reports_select changed unexpectedly — this Monthly fix must not touch Weekly.';
  end if;

  raise notice 'Monthly Report P0 fix installed: monthly_reports_select reads project_id/status directly, no self-referential lookup during RETURNING. monthly_report_viewable() and Weekly are unchanged.';
end;
$post$;
