-- ROLLBACK for 20260822000002_p1a_project_setup_write_authority.sql ONLY.
--
-- ############################################################################
-- ##  THIS RESTORES KNOWN-VULNERABLE STATE.                                 ##
-- ##                                                                        ##
-- ##  It reinstates blanket authenticated write on project_delegations,     ##
-- ##  project_disciplines and weekly_lifecycle_corrections, and returns     ##
-- ##  project_departments to the narrower predicate that produced the       ##
-- ##  half-completable setup wizard.                                        ##
-- ##                                                                        ##
-- ##  Most importantly it REOPENS project_delegations, which becomes a      ##
-- ##  direct privilege-escalation path the moment delegation authority is   ##
-- ##  implemented. Do not roll back and then proceed to that work.          ##
-- ############################################################################
--
-- No table, column, trigger, function or row is touched — policies and grants
-- only. No data changes, so there is nothing to unwind.

\set ON_ERROR_STOP on

begin;

/* -------------------------- project_delegations --------------------------- */
drop policy if exists project_delegations_select on public.project_delegations;
drop policy if exists project_delegations_insert on public.project_delegations;
drop policy if exists project_delegations_update on public.project_delegations;
drop policy if exists project_delegations_delete on public.project_delegations;

create policy project_delegations_authenticated_all on public.project_delegations
  for all to authenticated using (true) with check (true);

/* -------------------------- project_disciplines --------------------------- */
drop policy if exists project_disciplines_select on public.project_disciplines;
drop policy if exists project_disciplines_insert on public.project_disciplines;
drop policy if exists project_disciplines_update on public.project_disciplines;
drop policy if exists project_disciplines_delete on public.project_disciplines;

create policy project_disciplines_authenticated_all on public.project_disciplines
  for all to authenticated using (true) with check (true);

/* --------------------- weekly_lifecycle_corrections ----------------------- */
drop policy if exists weekly_lifecycle_corrections_select
  on public.weekly_lifecycle_corrections;

create policy weekly_lifecycle_corrections_authenticated_all
  on public.weekly_lifecycle_corrections
  for all to authenticated using (true) with check (true);

/* ------- project_departments: back to weekly_can_manage_project() --------- */
-- SELECT is not touched here, exactly as the forward migration did not touch it.
drop policy if exists project_departments_insert on public.project_departments;
drop policy if exists project_departments_update on public.project_departments;
drop policy if exists project_departments_delete on public.project_departments;

create policy project_departments_insert on public.project_departments
  for insert to authenticated
  with check (public.weekly_can_manage_project(project_id));

create policy project_departments_update on public.project_departments
  for update to authenticated
  using (public.weekly_can_manage_project(project_id))
  with check (public.weekly_can_manage_project(project_id));

create policy project_departments_delete on public.project_departments
  for delete to authenticated
  using (public.weekly_can_manage_project(project_id));

commit;

-- The GRANT statements in the forward migration are deliberately NOT reversed.
-- They were a no-op on the hosted project, which already held those privileges
-- from the platform; revoking them would take away access the platform granted
-- and that P0 pre-flight Check 3 confirmed is required.

do $verify$
declare blanket integer;
begin
  select count(*) into blanket
    from pg_policies
   where schemaname='public'
     and tablename in ('project_delegations','project_disciplines','weekly_lifecycle_corrections')
     and cmd = 'ALL' and qual = 'true';

  if blanket <> 3 then
    raise exception 'Rollback incomplete: expected 3 blanket policies restored, found %.', blanket;
  end if;

  if exists (select 1 from pg_policies
              where schemaname='public' and tablename='project_departments'
                and cmd <> 'SELECT'
                and coalesce(qual, with_check) like '%can_manage_project_setup%') then
    raise exception 'Rollback incomplete: project_departments still uses the P1-A predicate.';
  end if;

  raise notice 'Rolled back to the pre-P1-A state. project_delegations is OPEN again - do not proceed to delegation authority.';
end;
$verify$;

-- Then remove the version row so the CLI does not consider it applied:
--
-- delete from supabase_migrations.schema_migrations
--  where version = '20260822000002';
