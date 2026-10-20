-- ============================================================================
-- DRAFT — NOT A MIGRATION YET. Delegated report approval, foundation (A of 2).
-- ============================================================================
--
-- STATUS
--   This file deliberately lives OUTSIDE supabase/migrations so that neither
--   `supabase db reset` nor `supabase migration up` can apply it. Its final
--   timestamp is not yet reserved: the Notification Center work may hold
--   uncommitted migrations whose numbers are unknown. Before it is promoted,
--   rename it to a timestamp that sorts after BOTH the newest committed
--   migration (20260927000001_report_detail_published_narratives.sql) AND any
--   Notification Center migration, and place DRAFT_B immediately after it.
--
-- DEPENDS ON (all already applied locally; none of the pending 202609260000xx
-- or 20260927000001 migrations is required):
--   20260719000001  public.projects (status 'archived' = archived project)
--   20260729000001  public.profiles (active = account lifecycle)
--   20260824000001  public.is_system_admin()  -- active system_admin only
--
-- WHAT THIS ADDS
--   A FIFTH, independent authorization axis alongside Global Authority
--   (profiles.role), Project Responsibility (project_contacts.role),
--   Department Responsibility (project_contacts.assignment_role) and Portfolio
--   Read (portfolio_read_grants): an explicit, per-project, per-report-type
--   grant of APPROVAL authority.
--
--     scope = 'weekly'                  Weekly Reports of that project
--     scope = 'monthly'                 Monthly Reports of that project
--     scope = 'executive_contribution'  that project's Executive contribution
--                                       (never the consolidated Executive
--                                       Report)
--
--   Delegated approval is Approve / Return / Reject from Under Review only.
--   Finalize and Lock stay with Project Control. THIS FILE WIRES THE GRANT
--   INTO NOTHING: no status function, no policy and no permission predicate
--   calls the helper yet. That is a later, separately reviewed step, and the
--   post-check below fails the migration if anything already does.
--
-- WHAT IT DOES NOT DO
--   * It does not touch project_contacts. A grant is not an assignment, so
--     has_operational_project_access(), can_access_project(), the Weekly and
--     Monthly scope rules and every content/operations write predicate are
--     unaffected. A grant can never narrow a viewer's existing read scope
--     (e.g. Full Portfolio Read) or add edit, Project Setup, planning or
--     user-management rights.
--   * It does not read or change any existing row.
--
-- HOW GRANTS ARE WRITTEN
--   Only through grant_report_approval() / revoke_report_approval(), both
--   System-Admin-only. The actor is always auth.uid(): the client never
--   supplies granted_by / revoked_by. Direct INSERT/UPDATE/DELETE privileges
--   are withheld from every client role, and a trigger additionally rejects
--   any write that does not come from those two functions, any change to a
--   grant other than its one-time revocation, and every DELETE — so the
--   history survives even a service-role or table-owner mistake.
-- ============================================================================

/* ================================ The table ================================ */

create table public.report_approval_grants (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles(id) on delete restrict,
  project_id     uuid not null references public.projects(id) on delete restrict,
  scope          text not null
                   check (scope in ('weekly', 'monthly', 'executive_contribution')),
  granted_by     uuid not null references public.profiles(id) on delete restrict,
  granted_at     timestamptz not null default now(),
  grant_reason   text,
  revoked_by     uuid references public.profiles(id) on delete restrict,
  revoked_at     timestamptz,
  revoke_reason  text,
  -- Revocation is all-or-nothing and always explains itself.
  constraint report_approval_grants_revoke_complete check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null
        and revoke_reason is not null and btrim(revoke_reason) <> '')
  ),
  constraint report_approval_grants_revoke_after_grant check (
    revoked_at is null or revoked_at >= granted_at
  )
);

-- "Active" is revoked_at is null -- no separate boolean to drift from it.
-- At most one active grant per (profile, project, scope). Weekly, Monthly and
-- Executive-contribution grants are independent rows.
create unique index report_approval_grants_one_active
  on public.report_approval_grants(profile_id, project_id, scope)
  where revoked_at is null;

create index report_approval_grants_project_scope
  on public.report_approval_grants(project_id, scope)
  where revoked_at is null;

create index report_approval_grants_profile_id
  on public.report_approval_grants(profile_id);

comment on table public.report_approval_grants is
  'Delegated APPROVAL authority: one row per (profile, project, scope) grant, scope in weekly|monthly|executive_contribution. Revoked, never deleted. Independent of profiles.role, project_contacts and portfolio_read_grants: confers no read reach and no edit, setup, planning or user-management rights. Written only by grant_report_approval()/revoke_report_approval() (System Admin).';

/* ============================ Write-path guard ============================= */

-- Transaction-local flag set only by the two governed writers below. A client
-- cannot reach pg_catalog.set_config() through the Data API, and holds no
-- table write privilege anyway; the flag is the second, independent lock.
create function public.report_approval_grants_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Report approval grants are never deleted; revoke the grant instead.'
      using errcode = '42501';
  end if;

  if coalesce(current_setting('eprp.report_approval_grant_write', true), '') <> 'on' then
    raise exception 'Report approval grants are written only through grant_report_approval() / revoke_report_approval().'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- The only permitted change is the one-time revocation of an active grant.
    if old.revoked_at is not null then
      raise exception 'Grant % is already revoked and is immutable.', old.id
        using errcode = '42501';
    end if;
    if new.id is distinct from old.id
       or new.profile_id is distinct from old.profile_id
       or new.project_id is distinct from old.project_id
       or new.scope is distinct from old.scope
       or new.granted_by is distinct from old.granted_by
       or new.granted_at is distinct from old.granted_at
       or new.grant_reason is distinct from old.grant_reason then
      raise exception 'Only the revocation fields of a report approval grant may change.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$fn$;

create trigger report_approval_grants_guard
  before insert or update or delete on public.report_approval_grants
  for each row execute function public.report_approval_grants_guard();

create trigger report_approval_grants_no_truncate
  before truncate on public.report_approval_grants
  for each statement execute function public.report_approval_grants_guard();

/* ================================== RLS ==================================== */

alter table public.report_approval_grants enable row level security;

-- Read: your own grants, or a System Administrator. No write policy exists:
-- writes go through the SECURITY DEFINER functions below only.
create policy report_approval_grants_select on public.report_approval_grants
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select public.is_system_admin())
  );

revoke all on public.report_approval_grants from public, anon, authenticated, service_role;
grant select on public.report_approval_grants to authenticated, service_role;

/* ============================ Governed writers ============================= */

create function public.grant_report_approval(
  p_profile uuid,
  p_project uuid,
  p_scope   text,
  p_reason  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null or not public.is_system_admin() then
    raise exception 'Only an active System Administrator may grant report approval authority.'
      using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('weekly', 'monthly', 'executive_contribution') then
    raise exception 'Unknown approval scope %.', coalesce(p_scope, '(null)')
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = p_profile and pr.active) then
    raise exception 'Report approval can only be granted to an active account.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p
                  where p.id = p_project and p.status is distinct from 'archived') then
    raise exception 'Report approval can only be granted on an existing, non-archived project.'
      using errcode = '22023';
  end if;

  perform set_config('eprp.report_approval_grant_write', 'on', true);
  begin
    insert into public.report_approval_grants
      (profile_id, project_id, scope, granted_by, grant_reason)
    values
      (p_profile, p_project, p_scope, v_actor, nullif(btrim(p_reason), ''))
    returning id into v_id;
  exception when unique_violation then
    perform set_config('eprp.report_approval_grant_write', '', true);
    raise exception 'This account already holds an active % approval grant on this project.', p_scope
      using errcode = '23505';
  end;
  perform set_config('eprp.report_approval_grant_write', '', true);

  return v_id;
end;
$fn$;

comment on function public.grant_report_approval(uuid, uuid, text, text) is
  'System-Admin-only. Grants delegated approval authority for one project and one scope (weekly|monthly|executive_contribution) to an active account on a non-archived project. granted_by is always auth.uid(). Refuses a second active grant for the same (profile, project, scope).';

create function public.revoke_report_approval(
  p_grant  uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not public.is_system_admin() then
    raise exception 'Only an active System Administrator may revoke report approval authority.'
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to revoke report approval authority.'
      using errcode = '22023';
  end if;

  perform set_config('eprp.report_approval_grant_write', 'on', true);
  update public.report_approval_grants
     set revoked_at = now(),
         revoked_by = v_actor,
         revoke_reason = btrim(p_reason)
   where id = p_grant
     and revoked_at is null;
  if not found then
    perform set_config('eprp.report_approval_grant_write', '', true);
    raise exception 'No active report approval grant %.', p_grant
      using errcode = 'P0002';
  end if;
  perform set_config('eprp.report_approval_grant_write', '', true);
end;
$fn$;

comment on function public.revoke_report_approval(uuid, text) is
  'System-Admin-only. Revokes one active report approval grant (revoked_by = auth.uid(), reason required). The row is kept for audit; revocation takes effect at the next authorization check because the helper reads the live row.';

/* ================================ The helper =============================== */

-- Returns the caller's CURRENT grant id, or NULL. Evaluated live on every
-- call, so revocation, account deactivation and project archiving all take
-- effect immediately -- including for a session that was already signed in.
create function public.current_report_approval_grant(
  p_project uuid,
  p_scope   text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select g.id
    from public.report_approval_grants g
    join public.profiles pr on pr.id = g.profile_id
    join public.projects p  on p.id = g.project_id
   where g.profile_id = (select auth.uid())
     and g.project_id = p_project
     and g.scope = p_scope
     and g.revoked_at is null
     and pr.active
     and p.status is distinct from 'archived'
   limit 1;
$fn$;

create function public.has_report_approval_grant(
  p_project uuid,
  p_scope   text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.current_report_approval_grant(p_project, p_scope) is not null;
$fn$;

comment on function public.current_report_approval_grant(uuid, text) is
  'The signed-in caller''s active approval grant for (project, scope), or NULL. Requires an active profile and a non-archived project. APPROVAL ONLY: must be consumed solely by controlled report status-transition functions, never by a table policy or a content/operations/setup/user-management predicate (enforced by post-check).';
comment on function public.has_report_approval_grant(uuid, text) is
  'Boolean form of current_report_approval_grant(). Same restrictions.';

/* ============================== Function ACLs ============================== */

revoke execute on function public.report_approval_grants_guard() from public, anon, authenticated;
revoke execute on function public.grant_report_approval(uuid, uuid, text, text) from public, anon;
revoke execute on function public.revoke_report_approval(uuid, text) from public, anon;
revoke execute on function public.current_report_approval_grant(uuid, text) from public, anon;
revoke execute on function public.has_report_approval_grant(uuid, text) from public, anon;

-- Writers: signed-in callers only (the body re-checks System Admin). Helpers:
-- signed-in callers only; they answer only for auth.uid(), so service_role
-- (no auth.uid()) would always get NULL/false and is not granted them.
grant execute on function public.grant_report_approval(uuid, uuid, text, text) to authenticated;
grant execute on function public.revoke_report_approval(uuid, text) to authenticated;
grant execute on function public.current_report_approval_grant(uuid, text) to authenticated;
grant execute on function public.has_report_approval_grant(uuid, text) to authenticated;

/* -------------------------------- Post-check ------------------------------- */

do $post$
declare
  v_count integer;
  v_names text;
begin
  if not (select relrowsecurity from pg_class
           where oid = 'public.report_approval_grants'::regclass) then
    raise exception 'Post-check failed: report_approval_grants has RLS disabled.';
  end if;

  -- Exactly one policy, SELECT, and it is not blanket.
  select count(*) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'report_approval_grants';
  if v_count <> 1 then
    raise exception 'Post-check failed: expected exactly 1 policy on report_approval_grants, found %.', v_count;
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'report_approval_grants'
                and (cmd <> 'SELECT' or qual = 'true')) then
    raise exception 'Post-check failed: report_approval_grants has a write or blanket policy.';
  end if;

  -- No client role may write the table directly.
  if has_table_privilege('anon', 'public.report_approval_grants', 'SELECT')
     or has_table_privilege('anon', 'public.report_approval_grants', 'INSERT')
     or has_table_privilege('authenticated', 'public.report_approval_grants', 'INSERT')
     or has_table_privilege('authenticated', 'public.report_approval_grants', 'UPDATE')
     or has_table_privilege('authenticated', 'public.report_approval_grants', 'DELETE')
     or has_table_privilege('authenticated', 'public.report_approval_grants', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.report_approval_grants', 'DELETE') then
    raise exception 'Post-check failed: a client role holds a direct write privilege on report_approval_grants.';
  end if;

  -- anon cannot call any of the new functions.
  if has_function_privilege('anon', 'public.grant_report_approval(uuid, uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.revoke_report_approval(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.current_report_approval_grant(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.has_report_approval_grant(uuid, text)', 'EXECUTE') then
    raise exception 'Post-check failed: anon can execute a report approval function.';
  end if;

  -- THE isolation proof: no policy anywhere references the grant table or
  -- helpers ...
  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename <> 'report_approval_grants'
     and (coalesce(qual, '') ~ '(report_approval_grant|has_report_approval_grant)'
          or coalesce(with_check, '') ~ '(report_approval_grant|has_report_approval_grant)');
  if v_count > 0 then
    raise exception 'Post-check failed: % polic(y/ies) outside report_approval_grants reference approval grants.', v_count;
  end if;

  -- ... and no function other than this file's own does. When the status
  -- transition functions are wired in later, THAT migration widens this
  -- allowlist by name -- and only by those names.
  select string_agg(p.proname, ', ' order by p.proname) into v_names
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ '(report_approval_grants|current_report_approval_grant|has_report_approval_grant)'
     and p.proname not in ('report_approval_grants_guard', 'grant_report_approval',
                           'revoke_report_approval', 'current_report_approval_grant',
                           'has_report_approval_grant');
  if v_names is not null then
    raise exception 'Post-check failed: unexpected function(s) reference approval grants: %.', v_names;
  end if;

  raise notice 'report_approval_grants ready: System-Admin writers only, own/admin read, live helper, referenced by no policy or predicate.';
end;
$post$;
