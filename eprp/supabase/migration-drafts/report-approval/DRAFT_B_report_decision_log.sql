-- ============================================================================
-- DRAFT — NOT A MIGRATION YET. Delegated report approval, foundation (B of 2).
-- ============================================================================
--
-- STATUS
--   Lives outside supabase/migrations for the same numbering reason as
--   DRAFT_A_report_approval_grants.sql. Promote it IMMEDIATELY AFTER DRAFT_A:
--   grant_id references public.report_approval_grants.
--
-- DEPENDS ON
--   DRAFT_A                          public.report_approval_grants
--   20260719000001 / 20260729000001  public.projects, public.profiles
--   20260824000001                   has_global_operational_authority(),
--                                    is_project_control_planning(),
--                                    can_manage_reporting_workflow() (latest
--                                    body: 20260922000003)
--   20260912000003                   can_access_project() (includes the Full
--                                    portfolio-read tier)
--   Weekly/Monthly report tables     public.weekly_reports, public.monthly_reports
--
-- WHAT THIS ADDS
--   An append-only record of report decisions: who (the authenticated actor,
--   never a client-supplied id), when (server time), on what (subject type and
--   id, project), from which status to which, under which authority, and --
--   for a delegated decision -- which grant authorised it.
--
--   Nothing writes to it yet. record_report_decision() is callable by NO
--   client role; the Weekly/Monthly status functions and the future Executive
--   contribution function will call it from inside their own SECURITY DEFINER
--   bodies in a later, separately reviewed migration.
--
-- IMMUTABILITY
--   * No INSERT/UPDATE/DELETE/TRUNCATE privilege for any client role.
--   * No write policy.
--   * Triggers reject every UPDATE, DELETE and TRUNCATE for every role, and
--     every INSERT that does not come through record_report_decision().
--   * grant_id / actor / project references are ON DELETE RESTRICT, and grant
--     rows are never deleted (DRAFT_A), so revoking a grant or deactivating an
--     account never erases or orphans a decision already recorded.
-- ============================================================================

/* ================================ The table ================================ */

create table public.report_decision_log (
  id                uuid primary key default gen_random_uuid(),
  subject_type      text not null
                      check (subject_type in ('weekly_report', 'monthly_report',
                                              'executive_contribution')),
  -- Polymorphic, so no FK. record_report_decision() verifies the subject
  -- exists and belongs to project_id at write time.
  subject_id        uuid not null,
  project_id        uuid not null references public.projects(id) on delete restrict,
  from_status       text not null check (btrim(from_status) <> ''),
  to_status         text not null check (btrim(to_status) <> ''),
  actor_profile_id  uuid not null references public.profiles(id) on delete restrict,
  -- Name as it was at decision time; profiles.full_name may change later.
  actor_name        text not null,
  authority         text not null
                      check (authority in ('delegated_grant', 'project_control',
                                           'global_authority', 'report_preparation')),
  grant_id          uuid references public.report_approval_grants(id) on delete restrict,
  comment           text,
  decided_at        timestamptz not null default now(),
  constraint report_decision_log_status_changes check (from_status <> to_status),
  -- A delegated decision always names its grant; nothing else ever does.
  constraint report_decision_log_grant_matches_authority check (
    (authority = 'delegated_grant') = (grant_id is not null)
  )
);

create index report_decision_log_subject
  on public.report_decision_log(subject_type, subject_id, decided_at);
create index report_decision_log_project
  on public.report_decision_log(project_id, decided_at);
create index report_decision_log_actor
  on public.report_decision_log(actor_profile_id);
create index report_decision_log_grant
  on public.report_decision_log(grant_id) where grant_id is not null;

comment on table public.report_decision_log is
  'Append-only report decision audit: subject, project, previous/new status, authenticated actor (+ name snapshot), server decision time, authority and, for delegated decisions, the grant used. Written only by record_report_decision(); never updated or deleted. Readable with project access (incl. Full portfolio read) or by the actor.';

/* ============================ Immutability guard =========================== */

create function public.report_decision_log_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op <> 'INSERT' then
    raise exception 'The report decision log is append-only (% refused).', tg_op
      using errcode = '42501';
  end if;

  if coalesce(current_setting('eprp.report_decision_write', true), '') <> 'on' then
    raise exception 'Report decisions are recorded only through record_report_decision().'
      using errcode = '42501';
  end if;

  -- The actor and the time are the server's, never the caller's.
  if new.actor_profile_id is distinct from (select auth.uid()) then
    raise exception 'A report decision must be recorded as the authenticated actor.'
      using errcode = '42501';
  end if;
  new.decided_at := now();

  return new;
end;
$fn$;

create trigger report_decision_log_guard
  before insert or update or delete on public.report_decision_log
  for each row execute function public.report_decision_log_guard();

create trigger report_decision_log_no_truncate
  before truncate on public.report_decision_log
  for each statement execute function public.report_decision_log_guard();

/* ================================== RLS ==================================== */

alter table public.report_decision_log enable row level security;

-- Read: anyone who can read the project (assignments, Project Control, global
-- authority, Full portfolio read -- all inside can_access_project()), plus the
-- actor for their own decisions (e.g. a delegated approver whose grant was
-- later revoked). The Published tier is deliberately NOT included.
create policy report_decision_log_select on public.report_decision_log
  for select to authenticated
  using (
    public.can_access_project(project_id)
    or actor_profile_id = (select auth.uid())
  );

revoke all on public.report_decision_log from public, anon, authenticated, service_role;
grant select on public.report_decision_log to authenticated, service_role;

/* ============================== The recorder =============================== */

create function public.record_report_decision(
  p_subject_type text,
  p_subject_id   uuid,
  p_project      uuid,
  p_from         text,
  p_to           text,
  p_authority    text,
  p_grant        uuid default null,
  p_comment      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor      uuid := (select auth.uid());
  v_actor_name text;
  v_subject_ok boolean;
  v_scope      text;
  v_id         uuid;
begin
  if v_actor is null then
    raise exception 'A report decision requires an authenticated actor.'
      using errcode = '42501';
  end if;

  select pr.full_name into v_actor_name
    from public.profiles pr
   where pr.id = v_actor and pr.active;
  if v_actor_name is null then
    raise exception 'A report decision requires an active account.'
      using errcode = '42501';
  end if;

  -- The subject must exist and belong to the stated project.
  v_scope := case p_subject_type
               when 'weekly_report'          then 'weekly'
               when 'monthly_report'         then 'monthly'
               when 'executive_contribution' then 'executive_contribution'
             end;
  if v_scope is null then
    raise exception 'Unknown decision subject type %.', coalesce(p_subject_type, '(null)')
      using errcode = '22023';
  end if;
  if p_subject_type = 'weekly_report' then
    select exists (select 1 from public.weekly_reports r
                    where r.id = p_subject_id and r.project_id = p_project)
      into v_subject_ok;
  elsif p_subject_type = 'monthly_report' then
    select exists (select 1 from public.monthly_reports r
                    where r.id = p_subject_id and r.project_id = p_project)
      into v_subject_ok;
  else
    -- Executive contributions do not exist yet; the migration that creates
    -- them replaces this function and adds the check.
    raise exception 'Executive contribution decisions are not available yet.'
      using errcode = '0A000';
  end if;
  if not v_subject_ok then
    raise exception 'Decision subject % does not belong to project %.', p_subject_id, p_project
      using errcode = '22023';
  end if;

  -- The claimed authority must be one the actor actually holds right now.
  if p_authority = 'delegated_grant' then
    if p_grant is null
       or p_grant is distinct from public.current_report_approval_grant(p_project, v_scope) then
      raise exception 'The stated approval grant is not an active % grant of this actor on this project.', v_scope
        using errcode = '42501';
    end if;
  elsif p_grant is not null then
    raise exception 'Only a delegated decision may reference an approval grant.'
      using errcode = '22023';
  elsif p_authority = 'global_authority' then
    if not public.has_global_operational_authority() then
      raise exception 'Actor does not hold global operational authority.' using errcode = '42501';
    end if;
  elsif p_authority = 'project_control' then
    if not public.is_project_control_planning(p_project) then
      raise exception 'Actor is not Project Control on this project.' using errcode = '42501';
    end if;
  elsif p_authority = 'report_preparation' then
    if not public.can_manage_reporting_workflow(p_project) then
      raise exception 'Actor may not manage this project''s reporting workflow.' using errcode = '42501';
    end if;
  else
    raise exception 'Unknown decision authority %.', coalesce(p_authority, '(null)')
      using errcode = '22023';
  end if;

  perform set_config('eprp.report_decision_write', 'on', true);
  insert into public.report_decision_log
    (subject_type, subject_id, project_id, from_status, to_status,
     actor_profile_id, actor_name, authority, grant_id, comment)
  values
    (p_subject_type, p_subject_id, p_project, p_from, p_to,
     v_actor, v_actor_name, p_authority, p_grant, nullif(btrim(p_comment), ''))
  returning id into v_id;
  perform set_config('eprp.report_decision_write', '', true);

  return v_id;
end;
$fn$;

comment on function public.record_report_decision(text, uuid, uuid, text, text, text, uuid, text) is
  'INTERNAL. Appends one report decision as auth.uid(), after verifying the subject belongs to the project and that the actor currently holds the claimed authority (for delegated_grant: that exact active grant). Not executable by any client role; called only from controlled status-transition functions.';

/* ============================== Function ACLs ============================== */

revoke execute on function public.report_decision_log_guard() from public, anon, authenticated, service_role;
revoke execute on function public.record_report_decision(text, uuid, uuid, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;

/* -------------------------------- Post-check ------------------------------- */

do $post$
declare
  v_count integer;
begin
  if not (select relrowsecurity from pg_class
           where oid = 'public.report_decision_log'::regclass) then
    raise exception 'Post-check failed: report_decision_log has RLS disabled.';
  end if;

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'report_decision_log';
  if v_count <> 1 or exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'report_decision_log'
          and (cmd <> 'SELECT' or qual = 'true')) then
    raise exception 'Post-check failed: report_decision_log must have exactly one non-blanket SELECT policy.';
  end if;

  if has_table_privilege('anon', 'public.report_decision_log', 'SELECT')
     or has_table_privilege('authenticated', 'public.report_decision_log', 'INSERT')
     or has_table_privilege('authenticated', 'public.report_decision_log', 'UPDATE')
     or has_table_privilege('authenticated', 'public.report_decision_log', 'DELETE')
     or has_table_privilege('authenticated', 'public.report_decision_log', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.report_decision_log', 'INSERT')
     or has_table_privilege('service_role', 'public.report_decision_log', 'UPDATE')
     or has_table_privilege('service_role', 'public.report_decision_log', 'DELETE') then
    raise exception 'Post-check failed: a client role holds a direct write privilege on report_decision_log.';
  end if;

  if has_function_privilege('anon', 'public.record_report_decision(text, uuid, uuid, text, text, text, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_report_decision(text, uuid, uuid, text, text, text, uuid, text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.record_report_decision(text, uuid, uuid, text, text, text, uuid, text)', 'EXECUTE') then
    raise exception 'Post-check failed: a client role can execute record_report_decision().';
  end if;

  select count(*) into v_count
    from pg_trigger
   where tgrelid = 'public.report_decision_log'::regclass
     and not tgisinternal
     and tgname in ('report_decision_log_guard', 'report_decision_log_no_truncate')
     and tgenabled <> 'D';
  if v_count <> 2 then
    raise exception 'Post-check failed: report_decision_log immutability triggers missing or disabled.';
  end if;

  -- Grant isolation still holds after this file: the recorder only VALIDATES
  -- a claimed grant; it is the one consumer added here, and still no policy
  -- references approval grants.
  if exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc ~ '(report_approval_grants|current_report_approval_grant|has_report_approval_grant)'
          and p.proname not in ('report_approval_grants_guard', 'grant_report_approval',
                                'revoke_report_approval', 'current_report_approval_grant',
                                'has_report_approval_grant', 'record_report_decision'))
     or exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename <> 'report_approval_grants'
          and (coalesce(qual, '') ~ 'report_approval_grant'
               or coalesce(with_check, '') ~ 'report_approval_grant')) then
    raise exception 'Post-check failed: approval grants are referenced outside the approved functions.';
  end if;

  raise notice 'report_decision_log ready: append-only, recorder not client-callable, project-scoped read.';
end;
$post$;
