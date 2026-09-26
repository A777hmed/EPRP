-- ============================================================================
-- Executive Summary visibility — column-level protection
-- ============================================================================
--
-- Forward-only. Changes READ access to ONE column and adds two functions.
-- Row-level policies, write privileges, and every other table are unchanged.
--
-- Problem
--   `executive_reports_select` admits any authenticated user to an approved
--   Executive record, and a row grant returns EVERY column — including
--   `executive_summary`, the manually authored, portfolio-wide narrative. That
--   text is written with full access and may describe projects the reader is
--   not entitled to, so hiding it in the app is not enough: it would still be
--   in the API response.
--
-- Policy (approved)
--   * Full-portfolio authority may read the stored summary:
--       public.executive_can_manage()      system_admin / project_control_admin
--       public.has_full_portfolio_read()   active tier = 'full' grant
--   * Everyone else — published-tier readers and project-assigned users —
--     receives only the app's access-scoped auto-generated summary.
--   * No new approval flag: only the two existing mechanisms above.
--
-- Mechanism
--   1. `executive_summary_readable()` states the entitlement once.
--   2. The table-wide SELECT grant is replaced by a column list that omits
--      `executive_summary`. (A column revoke cannot override a table grant,
--      hence the replacement.) UPDATE/INSERT privileges are untouched, so an
--      authorized editor can still write the summary.
--   3. `executive_report_summary(uuid)` returns the summary to full-portfolio
--      authority and NULL to everyone else — indistinguishable from "no summary
--      stored", so nothing reveals that one exists.
--
-- Deployment order
--   The application must already read explicit columns (EXECUTIVE_RECORD_COLUMNS
--   in executive-record.ts) before this runs; any remaining `select *` on this
--   table fails with "permission denied for column executive_summary" once the
--   grant is replaced. The app works identically before and after.
--
-- Maintenance note
--   A column added to executive_reports later is NOT readable by
--   `authenticated` until it is added to the grant below. The post-check makes
--   that explicit rather than silent.
-- ============================================================================

/* ------------------------------ 1 · Entitlement --------------------------- */

create function public.executive_summary_readable()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.executive_can_manage() or public.has_full_portfolio_read();
$fn$;

comment on function public.executive_summary_readable() is
  'True only for full-portfolio authority: executive_can_manage() (system_admin / project_control_admin) or has_full_portfolio_read() (active tier=full grant). Published-tier and project-assigned users are excluded. Gates executive_report_summary().';

revoke execute on function public.executive_summary_readable() from public, anon;
grant execute on function public.executive_summary_readable() to authenticated;

/* ----------------------- 2 · Column-level read grant ---------------------- */

revoke select on public.executive_reports from public, anon, authenticated;

grant select (
  id,
  reporting_month,
  status,
  prepared_by_contact_ids,
  title,
  confidentiality,
  signatories,
  created_by,
  created_by_name,
  updated_by,
  updated_by_name,
  archived_at,
  created_at,
  updated_at
) on public.executive_reports to authenticated;

/* -------------------------- 3 · Guarded reader ---------------------------- */

-- SECURITY DEFINER is required: the caller no longer holds SELECT on the
-- column. But a definer function owned by the migration role also BYPASSES
-- executive_reports' row-level security (the table does not FORCE RLS), so row
-- visibility is re-stated here explicitly rather than inherited:
--
--   1 · a signed-in caller only (anon never reaches the row);
--   2 · the row must be one executive_reports_select would show this caller —
--       its USING clause, verbatim (20260912000003_portfolio_read_entitlements);
--   3 · and the caller must hold full-portfolio summary entitlement.
--
-- (2) and (3) are both required. Today (3) implies (2) — both entitled groups
-- hold an explicit branch of the row policy — so (2) grants nothing new; it is
-- there so that if the row policy is ever narrowed, this function narrows with
-- it the moment its mirrored predicate is updated, instead of silently keeping
-- the old reach. A repository test fails if the two predicates diverge.
create function public.executive_report_summary(p_report_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.executive_summary
    from public.executive_reports r
   where r.id = p_report_id
     and (select auth.uid()) is not null
     and (
       public.executive_can_manage()
       or public.report_status_is_approved(r.status)
       or public.has_full_portfolio_read()
     )
     and public.executive_summary_readable();
$fn$;

comment on function public.executive_report_summary(uuid) is
  'The stored Executive Summary for one record, returned only to a signed-in caller who may see the row under executive_reports_select (re-stated, since SECURITY DEFINER bypasses RLS) AND holds executive_summary_readable(); NULL otherwise (indistinguishable from no summary). The only read path for executive_reports.executive_summary by authenticated users.';

revoke execute on function public.executive_report_summary(uuid) from public, anon;
grant execute on function public.executive_report_summary(uuid) to authenticated;

/* ------------------------------- Post-check ------------------------------- */

do $$
declare
  v_missing text;
begin
  -- The summary is no longer directly readable by any client role.
  if has_column_privilege('authenticated', 'public.executive_reports', 'executive_summary', 'SELECT') then
    raise exception 'Post-check failed: authenticated can still SELECT executive_reports.executive_summary.';
  end if;
  if has_column_privilege('anon', 'public.executive_reports', 'executive_summary', 'SELECT') then
    raise exception 'Post-check failed: anon can SELECT executive_reports.executive_summary.';
  end if;

  -- Editing is preserved: authorized editors still WRITE the summary
  -- (executive_reports_update still limits who may, unchanged).
  if not has_column_privilege('authenticated', 'public.executive_reports', 'executive_summary', 'UPDATE') then
    raise exception 'Post-check failed: authenticated lost UPDATE on executive_summary; editing would break.';
  end if;

  -- Every OTHER column stays readable, so nothing else changes for anyone.
  select string_agg(c.column_name, ', ' order by c.ordinal_position)
    into v_missing
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'executive_reports'
     and c.column_name <> 'executive_summary'
     and not has_column_privilege('authenticated', 'public.executive_reports', c.column_name, 'SELECT');
  if v_missing is not null then
    raise exception 'Post-check failed: executive_reports column(s) not granted to authenticated: %. Add them to the column grant.', v_missing;
  end if;

  -- Both functions run as definer with a pinned search_path, and anon cannot call them.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('executive_summary_readable', 'executive_report_summary')
       and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))
  ) then
    raise exception 'Post-check failed: summary functions must be SECURITY DEFINER with search_path pinned to empty.';
  end if;
  -- Neither function is executable anonymously. Supabase's default privileges
  -- grant EXECUTE to anon on creation; the revokes above must have removed it.
  if has_function_privilege('anon', 'public.executive_report_summary(uuid)', 'EXECUTE') then
    raise exception 'Post-check failed: anon can execute executive_report_summary().';
  end if;
  if has_function_privilege('anon', 'public.executive_summary_readable()', 'EXECUTE') then
    raise exception 'Post-check failed: anon can execute executive_summary_readable().';
  end if;
  if not has_function_privilege('authenticated', 'public.executive_report_summary(uuid)', 'EXECUTE') then
    raise exception 'Post-check failed: authenticated cannot execute executive_report_summary().';
  end if;

  -- executive_report_summary() mirrors ONE permissive SELECT policy. A second
  -- SELECT policy, or any RESTRICTIVE policy, would make that mirror incomplete,
  -- so its presence stops the migration for review.
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'executive_reports' and cmd in ('SELECT', 'ALL')) <> 1 then
    raise exception 'Post-check failed: expected exactly one SELECT policy on executive_reports; re-derive executive_report_summary() row check.';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'executive_reports' and permissive = 'RESTRICTIVE') then
    raise exception 'Post-check failed: a RESTRICTIVE policy exists on executive_reports; executive_report_summary() does not mirror it.';
  end if;
  -- The live policy still references the three helpers the function mirrors.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'executive_reports' and policyname = 'executive_reports_select'
       and qual like '%executive_can_manage()%'
       and qual like '%report_status_is_approved(status)%'
       and qual like '%has_full_portfolio_read()%'
  ) then
    raise exception 'Post-check failed: executive_reports_select no longer matches the predicate executive_report_summary() mirrors.';
  end if;

  raise notice 'Executive Summary visibility applied: executive_summary readable only through executive_report_summary() for full-portfolio authority; row policies and Executive Notes unchanged.';
end;
$$;
