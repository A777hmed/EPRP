-- Weekly Report P0 — fix Project Control Manager Weekly Report creation
-- blocked by a self-referential RLS lookup during INSERT ... RETURNING.
--
-- ROOT CAUSE (reproduced and traced against local Postgres 17.6 with an
-- instrumented copy of the policy predicate):
--
--   weekly_reports_select's USING clause calls weekly_report_viewable(id),
--   which internally re-queries weekly_reports BY ID
--   (weekly_report_project(id): "select project_id from weekly_reports
--   where id = p_report") to rediscover the project_id this SAME ROW
--   already carries as a column. When this policy is re-checked for the
--   RETURNING clause of an INSERT (PostgREST's `.insert().select().single()`
--   issues exactly this form), that nested self-lookup does not see the
--   row this SAME command just inserted and returns NULL — confirmed by
--   direct instrumentation: `weekly_report_project(id)` traced NULL, while
--   a plain follow-up SELECT of the same row a moment later resolves it
--   correctly.
--
--   can_access_project(NULL) then correctly resolves its project-scoped
--   branch (has_operational_project_access) to a clean FALSE for a
--   Project Control Manager — an EXISTS query against project_contacts
--   with project_id = NULL matches nothing, and EXISTS is always true or
--   false, never NULL. But has_full_portfolio_read() / has_published_
--   portfolio_read(), OR'd into the same expression, were traced
--   returning SQL NULL rather than FALSE for the ordinary case of a
--   profile with no portfolio-read grant at all — portfolio_read_tier()'s
--   underlying query returns no row for such a profile, and a bare
--   `= 'full'` / `in ('full','published')` against that NULL is NULL, not
--   false, in three-valued SQL logic. FALSE OR NULL is NULL, so the whole
--   USING expression evaluates to NULL, and RLS treats a NULL USING
--   result as "reject" — exactly the observed failure.
--
--   has_global_operational_authority() does not depend on the row's
--   project_id at all, so the same RETURNING check trivially resolves
--   TRUE for a System Administrator / Project Control Admin regardless of
--   the NULL — which is exactly why this was invisible until a genuinely
--   project-scoped identity (an assigned Project Control Manager, not a
--   global admin) tried to create a Weekly Report through the real app.
--
-- FIX (smallest correct layer): weekly_reports_select does not need the
-- self-lookup at all. project_id and status are already columns ON the
-- row this policy evaluates — referencing them directly removes the
-- self-referential query entirely, so the result can never depend on
-- same-command row visibility during RETURNING. Semantically identical to
-- weekly_report_viewable(id) for every already-existing, already-visible
-- row (project_id/status read off the row directly vs. re-selected by id
-- are the same value whenever the self-lookup would have succeeded) — the
-- only case that changes is the one that was broken.
--
-- weekly_report_viewable(uuid) itself is UNCHANGED and still used exactly
-- as before by the four Weekly child tables (weekly_entries,
-- weekly_activities, weekly_submissions, weekly_plan_items), where
-- weekly_report_id points at an ALREADY-committed weekly_reports row from
-- an earlier, separate command — those uses never had this bug (the
-- referenced row is not the one being inserted in the same command) and
-- do not need to change. has_full_portfolio_read()/has_published_
-- portfolio_read()/portfolio_read_tier() are also UNCHANGED: they are
-- shared, widely-used authorization primitives (projects, milestones,
-- deliverables, Monthly, and more), and rewriting them is a materially
-- larger change than this P0 needs — the NULL-vs-FALSE behaviour they
-- were traced exhibiting for a no-grant profile is a real latent
-- correctness gap, flagged separately as its own follow-up rather than
-- folded into this fix.
--
-- monthly_reports_select has the exact same shape
-- (monthly_report_viewable(id)) and is very likely subject to the
-- identical latent bug for an analogous non-admin identity creating a
-- Monthly Report — Monthly is explicitly out of scope for this P0 and is
-- deliberately not touched here; flagged separately.
--
-- Forward-only. No prior migration is edited.

alter policy weekly_reports_select on public.weekly_reports
  using (
    public.can_access_project(project_id)
    or (
      public.has_published_portfolio_read()
      and public.weekly_report_completed(status)
    )
  );

comment on policy weekly_reports_select on public.weekly_reports is
  'Weekly Report P0 fix: reads project_id/status directly off the row being checked instead of self-querying weekly_reports by id through weekly_report_viewable(id) — that self-lookup does not see a row this SAME command just inserted, which silently failed INSERT ... RETURNING (and the equivalent .insert().select()) for any project-scoped identity (Project Control Manager, Reporting Coordinator, any project_contacts assignment) even though the same identity could read the row a moment later via a separate query. Semantically identical to weekly_report_viewable(id) otherwise: can_access_project() for the operational/full-portfolio-read tiers, plus the published tier''s own finalized/locked-only branch.';

/* ----------------------------- postconditions ----------------------------- */

do $post$
declare
  v_qual text;
  v_using_missing integer;
begin
  select qual into v_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'weekly_reports' and policyname = 'weekly_reports_select';

  if v_qual is null then
    raise exception 'Post-check failed: weekly_reports_select policy not found.';
  end if;
  if v_qual like '%weekly_report_viewable%' then
    raise exception 'Post-check failed: weekly_reports_select still calls weekly_report_viewable(id) — the self-referential lookup this migration removes.';
  end if;
  if v_qual not like '%can_access_project%' or v_qual not like '%project_id%' then
    raise exception 'Post-check failed: weekly_reports_select does not reference can_access_project(project_id) directly.';
  end if;

  -- weekly_report_viewable() itself must still exist, unmodified, for the
  -- four child-table policies that still legitimately need it.
  select count(*) into v_using_missing
    from pg_policies
   where schemaname = 'public'
     and tablename in ('weekly_entries', 'weekly_activities', 'weekly_submissions', 'weekly_plan_items')
     and policyname like '%_select'
     and coalesce(qual, '') not like '%weekly_report_viewable%';
  if v_using_missing > 0 then
    raise exception 'Post-check failed: % Weekly child-table select polic(y/ies) no longer reference weekly_report_viewable() — this migration must not touch them.', v_using_missing;
  end if;

  -- monthly_reports_select is deliberately untouched by this P0 fix.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'monthly_reports' and policyname = 'monthly_reports_select'
       and qual like '%monthly_report_viewable%'
  ) then
    raise exception 'Post-check failed: monthly_reports_select changed unexpectedly — this P0 fix must not touch Monthly.';
  end if;

  raise notice 'Weekly Report P0 fix installed: weekly_reports_select reads project_id/status directly, no self-referential lookup during RETURNING. weekly_report_viewable() and Monthly are unchanged.';
end;
$post$;
