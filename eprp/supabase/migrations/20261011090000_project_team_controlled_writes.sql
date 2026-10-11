-- Phase 2C.3C finalization: project team membership writes go ONLY through
-- the controlled membership functions.
--
-- 20261007150000_project_team_membership.sql granted authenticated callers
-- INSERT / UPDATE on public.project_members under RLS, so an authorized user
-- could write rows directly and skip the functions' project-version check
-- (the stale-write protection every Project Setup save relies on). This
-- forward migration closes that path. It changes no row and no schema shape.
--
--   * Ordinary authenticated callers keep SELECT only. Direct INSERT, UPDATE
--     and DELETE are refused (DELETE was never granted).
--   * The direct-write policies are dropped: they no longer govern anything.
--   * add_project_member / update_project_member / end_project_member become
--     hardened SECURITY DEFINER functions (empty search_path, every object
--     schema-qualified, EXECUTE for authenticated only) because the caller no
--     longer holds the table privileges an invoker function would need. Each
--     one authorizes the caller explicitly — System Admin / Project Control
--     Admin, or Project Control / Planning assigned to THIS project — refuses
--     archived projects and keeps the project-version compare-and-swap.
--   * Bodies are otherwise unchanged. Every integrity trigger and constraint
--     from 20261007150000 still applies to every write.
--
-- Membership stays AUTHORITY-FREE: no authorization helper reads it, which the
-- post-check below re-proves. Nothing here broadens any permission.

/* ----------------------- Direct table DML is closed ----------------------- */

revoke insert, update, delete on table public.project_members from authenticated, anon, public;
drop policy if exists project_members_insert on public.project_members;
drop policy if exists project_members_update on public.project_members;
-- SELECT (project visibility) is unchanged.

/* ------------------------ Controlled membership writers ------------------- */

create or replace function public.add_project_member(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_contact uuid,
  p_party uuid,
  p_project_role text,
  p_reports_to uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $add$
declare
  v_role text := nullif(pg_catalog.btrim(coalesce(p_project_role, '')), '');
  v_member uuid;
  v_version timestamptz;
begin
  -- Explicit authority: an active signed-in account that is System Admin /
  -- Project Control Admin, or Project Control / Planning on THIS project.
  if auth.uid() is null or public.current_user_role() is null
     or not (public.has_global_operational_authority() or public.is_project_control_planning(p_project)) then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  if p_project is null or p_expected_updated_at is null or p_contact is null then
    raise exception '[INVALID_INPUT] Project, version and person are required.' using errcode = '22023';
  end if;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its team is read-only.' using errcode = '42501';
  end if;
  if p_party is null then
    raise exception '[PARTY_REQUIRED] Choose the party this person represents.' using errcode = '23514';
  end if;
  if v_role is null or pg_catalog.length(v_role) > 80 then
    raise exception '[PROJECT_ROLE_REQUIRED] Enter a project role of up to 80 characters.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if not (public.has_global_operational_authority() or public.is_project_control_planning(p_project)) then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  update public.projects
     set updated_at = pg_catalog.clock_timestamp()
   where id = p_project and updated_at = p_expected_updated_at;
  if not found then
    raise exception '[STALE] Project Setup changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;
  if exists (select 1 from public.project_members m
              where m.project_id = p_project and m.contact_id = p_contact and m.ended_at is null) then
    raise exception '[ALREADY_MEMBER] This person is already on the project team.' using errcode = '23505';
  end if;

  -- created_by keeps its column default, auth.uid(): the signed-in caller.
  insert into public.project_members (project_id, contact_id, party_id, project_role, reports_to_member_id)
  values (p_project, p_contact, p_party, v_role, p_reports_to)
  returning id into v_member;

  select updated_at into strict v_version from public.projects where id = p_project;
  return pg_catalog.jsonb_build_object('member_id', v_member, 'version', v_version);
end;
$add$;
revoke execute on function public.add_project_member(uuid, timestamptz, uuid, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.add_project_member(uuid, timestamptz, uuid, uuid, text, uuid) to authenticated;

create or replace function public.update_project_member(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_member uuid,
  p_party uuid,
  p_project_role text,
  p_reports_to uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $update$
declare
  v_role text := nullif(pg_catalog.btrim(coalesce(p_project_role, '')), '');
  v_version timestamptz;
begin
  if auth.uid() is null or public.current_user_role() is null
     or not (public.has_global_operational_authority() or public.is_project_control_planning(p_project)) then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  if p_project is null or p_expected_updated_at is null or p_member is null then
    raise exception '[INVALID_INPUT] Project, version and member are required.' using errcode = '22023';
  end if;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its team is read-only.' using errcode = '42501';
  end if;
  if p_party is null then
    raise exception '[PARTY_REQUIRED] Choose the party this person represents.' using errcode = '23514';
  end if;
  if v_role is null or pg_catalog.length(v_role) > 80 then
    raise exception '[PROJECT_ROLE_REQUIRED] Enter a project role of up to 80 characters.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if not (public.has_global_operational_authority() or public.is_project_control_planning(p_project)) then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  update public.projects
     set updated_at = pg_catalog.clock_timestamp()
   where id = p_project and updated_at = p_expected_updated_at;
  if not found then
    raise exception '[STALE] Project Setup changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;

  -- The member must belong to THIS project: an id from another project matches nothing.
  update public.project_members
     set party_id = p_party, project_role = v_role, reports_to_member_id = p_reports_to
   where id = p_member and project_id = p_project and ended_at is null;
  if not found then
    raise exception '[NOT_FOUND] This member is no longer active on this project. Reload the page.'
      using errcode = 'P0002';
  end if;

  select updated_at into strict v_version from public.projects where id = p_project;
  return pg_catalog.jsonb_build_object('member_id', p_member, 'version', v_version);
end;
$update$;
revoke execute on function public.update_project_member(uuid, timestamptz, uuid, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.update_project_member(uuid, timestamptz, uuid, uuid, text, uuid) to authenticated;

create or replace function public.end_project_member(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_member uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $end$
declare
  v_version timestamptz;
begin
  if auth.uid() is null or public.current_user_role() is null
     or not (public.has_global_operational_authority() or public.is_project_control_planning(p_project)) then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  if p_project is null or p_expected_updated_at is null or p_member is null then
    raise exception '[INVALID_INPUT] Project, version and member are required.' using errcode = '22023';
  end if;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its team is read-only.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if not (public.has_global_operational_authority() or public.is_project_control_planning(p_project)) then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  update public.projects
     set updated_at = pg_catalog.clock_timestamp()
   where id = p_project and updated_at = p_expected_updated_at;
  if not found then
    raise exception '[STALE] Project Setup changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;

  update public.project_members
     set ended_at = pg_catalog.clock_timestamp()
   where id = p_member and project_id = p_project and ended_at is null;
  if not found then
    raise exception '[NOT_FOUND] This member is no longer active on this project. Reload the page.'
      using errcode = 'P0002';
  end if;

  select updated_at into strict v_version from public.projects where id = p_project;
  return pg_catalog.jsonb_build_object('member_id', p_member, 'version', v_version);
end;
$end$;
revoke execute on function public.end_project_member(uuid, timestamptz, uuid) from public, anon, service_role;
grant execute on function public.end_project_member(uuid, timestamptz, uuid) to authenticated;

/* ------------------------------ Post-checks ------------------------------- */

do $post$
declare
  v_helpers text;
begin
  if has_table_privilege('authenticated', 'public.project_members', 'INSERT')
     or has_table_privilege('authenticated', 'public.project_members', 'UPDATE')
     or has_table_privilege('authenticated', 'public.project_members', 'DELETE')
     or has_table_privilege('anon', 'public.project_members', 'INSERT')
     or has_table_privilege('anon', 'public.project_members', 'UPDATE')
     or has_table_privilege('anon', 'public.project_members', 'DELETE') then
    raise exception '2C.3C finalization post-check failed: direct DML on project_members is still granted.';
  end if;
  if not has_table_privilege('authenticated', 'public.project_members', 'SELECT') then
    raise exception '2C.3C finalization post-check failed: SELECT must stay granted to authenticated.';
  end if;
  if exists (select 1 from pg_catalog.pg_policies
              where schemaname = 'public' and tablename = 'project_members' and cmd <> 'SELECT') then
    raise exception '2C.3C finalization post-check failed: a write policy remains on project_members.';
  end if;
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('add_project_member', 'update_project_member', 'end_project_member')
         and p.prosecdef
         and p.proconfig @> array['search_path=""']) <> 3 then
    raise exception '2C.3C finalization post-check failed: membership writers must be SECURITY DEFINER with an empty search_path.';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('add_project_member', 'update_project_member', 'end_project_member')
                and (has_function_privilege('anon', p.oid, 'EXECUTE')
                     or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception '2C.3C finalization post-check failed: EXECUTE must be authenticated-only.';
  end if;
  -- Membership remains authority-free.
  select string_agg(p.proname, ', ' order by p.proname) into v_helpers
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
          or p.proname ~ '_accepts_department_input$')
     and p.prosrc ilike '%project_members%';
  if v_helpers is not null then
    raise exception '2C.3C finalization post-check failed: authorization helper(s) read project_members: %', v_helpers;
  end if;
end;
$post$;
