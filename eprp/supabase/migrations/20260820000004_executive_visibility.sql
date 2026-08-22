-- EPRP P0.2 addendum — Executive visibility follows the Tier B principle.
--
-- LOCKED DECISION (owner, 2026-08-20), recorded at
-- docs/02_PLATFORM_ARCHITECTURE.md 24.2.3:
--   Draft / in-progress Executive content stays scoped to its authorized
--   project and reporting users. Approved / finalized / locked Executive
--   content becomes platform-wide read-only. Draft Executive narrative is
--   never exposed platform-wide. Write and manage authority is unchanged.
--
-- WHAT WAS INCONSISTENT
--   executive_reports  select using (true)
--                      -> EVERY authenticated account could read every
--                         Executive report INCLUDING drafts, and
--                         executive_summary is the leadership narrative itself.
--   executive_notes    select using (project_id is null
--                                    or weekly_can_access_project(project_id))
--                      -> a PORTFOLIO note (project_id IS NULL) was readable by
--                         every authenticated account, at any state.
--
--   Two tables in the same module, two different rules, and both leaked draft
--   Executive narrative platform-wide in different ways.
--
-- THE CHANGE — SELECT POLICIES ONLY
--   No write policy, table, column, trigger or row is touched. The Executive
--   module is not redesigned. executive_can_manage() keeps its current meaning.
--
--   executive_reports: authors always; everyone else from APPROVED onward,
--     using the same report_status_is_approved() helper as every other tier so
--     "approved" has one definition platform-wide. The status CHECK on this
--     table admits draft|under_review|approved|locked|archived, so in practice
--     the gate opens at 'approved' and 'locked'. 'finalized' is accepted by the
--     helper and simply never occurs here -- that is one shared definition doing
--     its job, not a mismatch.
--
--   executive_notes: NARROWED. See below.
--
-- WHY executive_notes IS NARROWED RATHER THAN OPENED
--   The table has NO status column and no link to a report, so there is no
--   approval state to gate on. Under the locked decision an Executive note is
--   therefore in-progress narrative for its whole life, and "do not expose draft
--   Executive narrative platform-wide" applies unconditionally.
--
--   This is the ONE non-additive change in the P0.2 group: portfolio notes
--   (project_id IS NULL) go from readable-by-everyone to readable by Executive
--   authors only. Project notes keep exactly the reach they have today.
--
--   Safe because nothing outside the Executive module reads this table --
--   src/features/executive-reports/executive-notes.ts is the only consumer --
--   and every /executive-reports route is already gated by
--   getExecutiveViewerContext(), whose admitted role set is identical to
--   executive_can_manage(). No screen loses data it currently shows.
--
--   If notes should later become publishable, the correct fix is to give them a
--   lifecycle, not to widen a policy over content that has none.
--
-- KNOWN, NOT ADDRESSED HERE
--   Approved Executive reports are now readable platform-wide at the DATA
--   boundary, but every /executive-reports route is still gated to three roles
--   by canViewExecutivePortfolio(). The data rule is correct; the UI gate is
--   narrower. Aligning it is P1 UI work and deliberately outside P0.

/* --------------------------- Lockout pre-check ---------------------------- */

do $pre$
declare admins integer;
begin
  select count(*) into admins from public.profiles
   where role = 'system_admin' and active;
  -- P1.0: the lockout risk this guard exists for requires accounts to lock
  -- out. On an empty profiles table there are none, so the check is skipped
  -- rather than failing a fresh environment. Protection is unchanged whenever
  -- any profile exists.
  if admins = 0 and exists (select 1 from public.profiles) then
    raise exception
      'Refusing to rewrite Executive read policies: no active system_admin profile exists.';
  end if;
  if not exists (select 1 from public.profiles) then
    raise notice 'Fresh environment: no profiles exist yet, so no account can be locked out. Lockout check not applicable.';
  end if;
  raise notice 'Lockout pre-check passed: % active system_admin profile(s).', admins;
end;
$pre$;

/* ----------------------------- executive_reports -------------------------- */

drop policy if exists executive_reports_select on public.executive_reports;

create policy executive_reports_select on public.executive_reports
  for select to authenticated
  using (
    public.executive_can_manage()
    or public.report_status_is_approved(status)
  );

/* ------------------------------ executive_notes --------------------------- */

drop policy if exists executive_notes_select on public.executive_notes;

create policy executive_notes_select on public.executive_notes
  for select to authenticated
  using (
    public.executive_can_manage()
    or (
      project_id is not null
      and public.weekly_can_access_project(project_id)
    )
  );

/* -------------------------- Post-condition checks ------------------------- */

do $post$
declare
  open_reads integer;
  writes_changed integer;
  qual_reports text;
  qual_notes text;
begin
  -- 1. Neither table may carry an unconditionally open SELECT any more.
  select count(*) into open_reads
    from pg_policies
   where schemaname = 'public'
     and tablename in ('executive_reports', 'executive_notes')
     and cmd = 'SELECT' and qual = 'true';

  if open_reads > 0 then
    raise exception 'Post-check failed: % Executive table(s) still readable unconditionally - draft narrative would stay exposed.', open_reads;
  end if;

  -- 2. executive_reports must gate on the SHARED approved definition.
  select qual into qual_reports
    from pg_policies
   where schemaname = 'public' and tablename = 'executive_reports' and cmd = 'SELECT';

  if qual_reports is null or qual_reports not like '%report_status_is_approved%' then
    raise exception 'Post-check failed: executive_reports_select does not use the shared approved definition.';
  end if;

  -- 3. executive_notes must NOT have gained an approved/publication clause --
  --    it has no lifecycle to gate on, so such a clause could only be wrong.
  select qual into qual_notes
    from pg_policies
   where schemaname = 'public' and tablename = 'executive_notes' and cmd = 'SELECT';

  if qual_notes like '%report_status_is_approved%' then
    raise exception 'Post-check failed: executive_notes has no status column; it must not gate on report status.';
  end if;

  -- 4. 24.2.2 - read changes must not have touched write authority.
  select count(*) into writes_changed
    from pg_policies
   where schemaname = 'public'
     and tablename in ('executive_reports', 'executive_notes')
     and cmd <> 'SELECT'
     and qual is distinct from 'executive_can_manage()'
     and with_check is distinct from 'executive_can_manage()';

  if writes_changed > 0 then
    raise exception 'Post-check failed: % Executive write policy/policies no longer gate on executive_can_manage().', writes_changed;
  end if;

  raise notice 'P0.2 addendum applied: Executive reads follow the publication principle; write authority unchanged.';
end;
$post$;
