-- EPRP — restore JSONB-aware reviewer/approver detection in
-- weekly_transition_blockers(), lost to a later redefinition.
--
-- THE REGRESSION
--   20260824170325_weekly_signatory_lifecycle_guard.sql corrected
--   weekly_transition_blockers() to read "is a reviewer/approver recorded?"
--   from EITHER the immutable signatories JSONB snapshot (signatories->
--   'reviewed' / 'approved') OR the legacy single-contact columns
--   (reviewed_by_contact_id / approved_by_contact_id), because the workspace
--   writes the snapshot and a reviewer could be visibly and correctly saved
--   there while the report was still refused as having "no reviewer".
--
--   20260906000003_weekly_department_manager_approval.sql redefined the same
--   function again -- to fix an unrelated defect, counting departments
--   instead of weekly_submissions rows -- and, because CREATE OR REPLACE
--   FUNCTION has no partial form, had to restate the whole body. It restated
--   the PRE-20260824170325 reviewer/approver check (legacy columns only),
--   silently reverting the signatories fix. Every migration since has kept
--   redeclaring that same reverted body.
--
--   Net effect, live today: a Weekly report whose reviewer/approver exists
--   only in `signatories` (the canonical, immutable snapshot every current
--   UI write goes through) is refused at `approved` / `finalized` / `locked`
--   with "No reviewer recorded." / "No approver recorded.", even though the
--   report plainly shows one.
--
-- THE FIX
--   Re-merge the two corrections into one function: the DEPARTMENT counting
--   and wording from 20260906000003 (unchanged, character for character),
--   and the "signatories OR legacy column" detection from 20260824170325
--   (restored, character for character). Nothing else changes.
--
-- WHAT THIS DOES NOT TOUCH
--   * Department Manager approval authority (is_weekly_department_manager,
--     the weekly_submissions_update policy) -- untouched.
--   * Department completeness counting -- the exact 20260906000003 query,
--     unchanged: distinct departments, canonical row (discipline_id is null),
--     status = 'approved'.
--   * report_transition_allowed(), set_weekly_report_status(),
--     guard_weekly_status_change() -- untouched.
--   * Any RLS policy, any table, any column, project_contacts, profiles.role.
--   * The function's grant posture. This migration issues no GRANT/REVOKE
--     statement at all -- CREATE OR REPLACE FUNCTION never alters an existing
--     ACL, only its body, so whatever EXECUTE privileges exist today are
--     exactly what exist after this runs. The post-check below proves that
--     rather than assuming it.
--
-- A valid signatories entry is already guaranteed non-blank at write time:
-- weekly_reports_signatories_shape (20260816000001) rejects any array
-- element whose "name" is empty, so jsonb_array_length(...) > 0 is sufficient
-- evidence of "at least one valid signatory" without re-validating shape here.

/* ------------------- capture the current ACL, for the post-check ---------- */

do $capture$
declare
  v_acl text;
begin
  select coalesce(p.proacl::text, 'DEFAULT')
    into v_acl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'weekly_transition_blockers';

  if v_acl is null then
    raise exception 'Pre-check failed: public.weekly_transition_blockers() does not exist before this migration.';
  end if;

  perform set_config('eprp.migration_20260912000001.prev_acl', v_acl, false);
end;
$capture$;

/* ----------------------------- the merged fix ------------------------------ */

create or replace function public.weekly_transition_blockers(
  p_report uuid, p_to text
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_total        integer;
  v_approved     integer;
  v_has_reviewer boolean;
  v_has_approver boolean;
  v_out          text[] := '{}';
begin
  -- Reviewer/approver "recorded" from EITHER evidence shape, restored from
  -- 20260824170325: the immutable signatories snapshot (>= 1 entry in the
  -- relevant array) OR the legacy single-contact column. Either alone is
  -- sufficient; neither is required over the other.
  select
    coalesce(jsonb_array_length(signatories->'reviewed'), 0) > 0
      or reviewed_by_contact_id is not null,
    coalesce(jsonb_array_length(signatories->'approved'), 0) > 0
      or approved_by_contact_id is not null
    into v_has_reviewer, v_has_approver
    from public.weekly_reports
   where id = p_report;

  /*
   * Departments, not rows -- unchanged from 20260906000003.
   *
   * v_total    every department with any submission row on this Weekly.
   * v_approved departments whose CANONICAL row (discipline_id is null) is
   *            approved. A department in scope with no canonical row raises
   *            the total and not the approvals, because the submission that
   *            would be approved does not exist.
   */
  select count(distinct department_id),
         count(distinct department_id) filter (
           where discipline_id is null and status = 'approved')
    into v_total, v_approved
    from public.weekly_submissions
   where weekly_report_id = p_report
     and department_id is not null;

  if p_to in ('under_review', 'approved', 'finalized', 'locked') then
    if v_total = 0 then
      v_out := array_append(v_out, 'No department submissions exist for this report.');
    elsif v_approved < v_total then
      v_out := array_append(v_out, format(
        '%s of %s department%s approved - every department in the Weekly scope must be approved by its Department Manager.',
        v_approved, v_total, case when v_total = 1 then '' else 's' end));
    end if;
  end if;

  if p_to in ('approved', 'finalized', 'locked') and not v_has_reviewer then
    v_out := array_append(v_out, 'No reviewer recorded.');
  end if;

  if p_to in ('finalized', 'locked') and not v_has_approver then
    v_out := array_append(v_out, 'No approver recorded.');
  end if;

  return v_out;
end;
$fn$;

comment on function public.weekly_transition_blockers(uuid, text) is
  'Weekly lifecycle blockers. Department completeness counts departments, not rows (20260906000003). Reviewer and approver are read from the immutable signatories snapshot OR the legacy contact-id columns, either sufficient (restores 20260824170325, reverted without comment by a later redeclaration of this function).';

/* -------------------------- Post-condition checks -------------------------- */

do $post$
declare
  v_prev_acl text;
  v_curr_acl text;
  v_lang     text;
  v_vol      char;
  v_sec      boolean;
  v_search   text[];
begin
  select coalesce(p.proacl::text, 'DEFAULT'), l.lanname, p.provolatile,
         p.prosecdef, p.proconfig
    into v_curr_acl, v_lang, v_vol, v_sec, v_search
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where n.nspname = 'public'
     and p.proname = 'weekly_transition_blockers';

  if v_curr_acl is null then
    raise exception 'Post-check failed: public.weekly_transition_blockers() is missing after this migration.';
  end if;

  -- Grant posture is byte-for-byte unchanged. CREATE OR REPLACE FUNCTION never
  -- alters an existing ACL; this proves it rather than assuming it.
  v_prev_acl := current_setting('eprp.migration_20260912000001.prev_acl', true);
  if v_prev_acl is distinct from v_curr_acl then
    raise exception 'Post-check failed: weekly_transition_blockers() ACL changed (before=%, after=%).',
      v_prev_acl, v_curr_acl;
  end if;

  -- Shape unchanged: still plpgsql, still stable, still security definer,
  -- still pinned to search_path = public. A drift here would silently change
  -- how the function resolves unqualified names or who it runs as.
  if v_lang <> 'plpgsql' or v_vol <> 's' or v_sec is not true
     or v_search is distinct from array['search_path=public'] then
    raise exception
      'Post-check failed: weekly_transition_blockers() language/volatility/security/search_path drifted (lang=%, volatile=%, secdef=%, config=%).',
      v_lang, v_vol, v_sec, v_search;
  end if;

  raise notice 'weekly_transition_blockers() restored to signatories-aware reviewer/approver detection; department counting unchanged; ACL and function shape unchanged (%).', v_curr_acl;
end;
$post$;
