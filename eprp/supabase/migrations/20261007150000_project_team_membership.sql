-- Phase 2C.3C: Project Team Membership and Project Reports To.
--
-- Additive. Shared by PSM, Other and legacy projects.
--
-- One global People master (public.contacts) + project-scoped membership. A
-- person is never copied: a membership row references the authoritative
-- contacts row and says, for ONE project:
--   * which Project Party they represent (EPROM / Owner / one Subcontractor);
--   * their descriptive Project Role (NOT the person's global Job Title);
--   * who they report to on THIS project (never their global manager);
--   * whether the membership is active (ended_at IS NULL) or ended.
--
-- AUTHORITY-FREE BY DESIGN. Membership grants no platform or project
-- authorization. No authorization helper reads public.project_members; a
-- post-check at the end of this migration refuses to finish if one does.
-- Fixed-role columns, project_positions, project_contacts scope rows,
-- Replace Person and every authority predicate are untouched (2C.3D).
--
-- Order (approved):
--   1. permissive table and keys;
--   2. backfill of the verified Preflight V2 dataset
--      (scripts/p0-validation/112_preflight_project_team_membership.sql);
--   3. legacy-tolerant NOT VALID rule: active rows need Party + Project Role;
--   4. integrity, security and controlled write functions.
-- Adding the triggers only after the backfill means the backfill neither
-- advances any project's setup version nor passes through runtime guards
-- written for interactive edits.

/* ---------------------- 1. Permissive table and keys ---------------------- */

create table public.project_members (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  contact_id           uuid not null references public.contacts(id) on delete restrict,
  party_id             uuid,
  project_role         text,
  reports_to_member_id uuid,
  ended_at             timestamptz,
  created_by           uuid references auth.users(id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Target of the same-project Reports To reference below.
  constraint project_members_project_identity unique (project_id, id),
  -- The Party belongs to the SAME project (project_parties has unique
  -- (project_id, id) since 2C.3A). NULL party = legacy "Needs party".
  constraint project_members_party_same_project
    foreign key (project_id, party_id)
    references public.project_parties (project_id, id),
  -- The manager is a member of the SAME project. Cross-party is allowed.
  constraint project_members_reports_to_same_project
    foreign key (project_id, reports_to_member_id)
    references public.project_members (project_id, id),
  constraint project_members_no_self_report
    check (reports_to_member_id is distinct from id),
  constraint project_members_project_role_shape
    check (project_role is null
           or (project_role = btrim(project_role) and length(project_role) between 1 and 80)),
  constraint project_members_ended_after_created
    check (ended_at is null or ended_at >= created_at)
);

-- One ACTIVE membership per person per project; leaving and rejoining keeps
-- every earlier (ended) row as history.
create unique index project_members_one_active
  on public.project_members (project_id, contact_id)
  where ended_at is null;
create index project_members_contact on public.project_members (contact_id);
create index project_members_party on public.project_members (project_id, party_id);
create index project_members_reports_to on public.project_members (project_id, reports_to_member_id);

comment on table public.project_members is
  'Phase 2C.3C. Project-scoped team membership: a person (public.contacts, never copied) on one project, the Project Party they represent, a descriptive Project Role and a project-scoped Reports To. AUTHORITY-FREE: no authorization helper may read this table. ended_at NULL = active.';
comment on column public.project_members.party_id is
  'The Project Party this person represents on this project (same project, enforced by FK). NULL only on legacy backfilled rows, shown as Needs party.';
comment on column public.project_members.project_role is
  'Descriptive project role for this project only. Not the person''s global Job Title / Position, and grants nothing. NULL only on legacy backfilled rows (Needs project role).';
comment on column public.project_members.reports_to_member_id is
  'Who this member reports to on THIS project (same project, any party). Never changes the person''s global manager. NULL = no Reports To (a warning, not an error).';
comment on column public.project_members.ended_at is
  'The single lifecycle field: NULL = active, set = ended. Ended rows are history and are never edited or deleted.';

/* ------------------- 2. Backfill: verified Preflight V2 ------------------- */
--
-- Participation evidence (one membership per project + person):
--   * the project's CURRENT fixed-role columns;
--   * project_positions rows;
--   * project_contacts rows, except a fixed-role-named row whose person is not
--     the CURRENT holder of that role (a stale mirror row is not evidence).
-- Party, from the CURRENT fixed-role columns only:
--   Project Manager / Project Control Manager / Reporting Coordinator -> EPROM,
--   Client Representative -> Owner. The Project Sponsor is not assumed.
-- contacts.organization NEVER assigns a party; a non-empty organization that
-- contradicts the role-derived party downgrades it to NULL (Needs party).
-- Holding both an EPROM role and Client Representative is a conflict (NULL).
-- Project Role and Reports To are never derived: both stay NULL.

with fixed as (
  select p.id as project_id, f.role, f.contact_id
    from public.projects p
    cross join lateral (values
      ('project_manager',         p.project_manager_id),
      ('project_control_manager', p.project_control_manager_id),
      ('client_representative',   p.client_representative_id),
      ('reporting_coordinator',   p.reporting_coordinator_id),
      ('project_sponsor',         p.project_sponsor_id)
    ) as f(role, contact_id)
   where f.contact_id is not null
), counted_contacts as (
  select pc.project_id, pc.contact_id
    from public.project_contacts pc
   where pc.role not in ('project_manager', 'project_control_manager', 'client_representative',
                         'reporting_coordinator', 'project_sponsor')
      or exists (select 1 from fixed f
                  where f.project_id = pc.project_id
                    and f.role = pc.role
                    and f.contact_id = pc.contact_id)
), participants as (
  select project_id, contact_id from fixed
  union
  select project_id, contact_id from public.project_positions
  union
  select project_id, contact_id from counted_contacts
), evidence as (
  select pr.project_id, pr.contact_id,
         exists (select 1 from fixed f
                  where f.project_id = pr.project_id and f.contact_id = pr.contact_id
                    and f.role in ('project_manager', 'project_control_manager', 'reporting_coordinator')) as eprom_role,
         exists (select 1 from fixed f
                  where f.project_id = pr.project_id and f.contact_id = pr.contact_id
                    and f.role = 'client_representative') as owner_role,
         upper(nullif(btrim(c.organization), '')) as organization,
         upper(btrim(coalesce(cl.name, ''))) as client_name,
         upper(btrim(coalesce(cl.short_name, ''))) as client_short_name,
         upper(btrim(coalesce(cl.code, ''))) as client_code
    from participants pr
    join public.contacts c on c.id = pr.contact_id
    join public.projects p on p.id = pr.project_id
    left join public.clients cl on cl.id = p.client_id
), decided as (
  select e.project_id, e.contact_id,
         case
           when e.eprom_role and e.owner_role then null
           when e.eprom_role and (e.organization is null or e.organization = 'EPROM') then 'eprom'
           when e.owner_role and (e.organization is null
                                  or e.organization in (e.client_name, e.client_short_name, e.client_code))
             then 'owner'
           else null
         end as party_kind
    from evidence e
)
insert into public.project_members (project_id, contact_id, party_id)
select d.project_id, d.contact_id, pp.id
  from decided d
  left join public.project_parties pp
    on pp.project_id = d.project_id and pp.kind = d.party_kind;

do $backfill_report$
declare
  v_total integer; v_eprom integer; v_owner integer; v_needs_party integer;
  v_needs_role integer; v_people integer; v_projects integer;
begin
  select count(*), count(distinct contact_id), count(distinct project_id),
         count(*) filter (where party_id is null),
         count(*) filter (where project_role is null)
    into v_total, v_people, v_projects, v_needs_party, v_needs_role
    from public.project_members;
  select count(*) filter (where pp.kind = 'eprom'), count(*) filter (where pp.kind = 'owner')
    into v_eprom, v_owner
    from public.project_members m join public.project_parties pp on pp.id = m.party_id;
  raise notice '2C.3C backfill: % memberships, % people, % projects; EPROM %, Owner %, Needs party %, Needs project role %.',
    v_total, v_people, v_projects, v_eprom, v_owner, v_needs_party, v_needs_role;
  if exists (select 1 from public.project_members
              where party_id is not null and project_id <> (select pp.project_id from public.project_parties pp where pp.id = party_id)) then
    raise exception '2C.3C backfill post-check failed: a membership references another project''s party.';
  end if;
  if exists (select 1 from public.project_members
              where project_role is not null or reports_to_member_id is not null or ended_at is not null) then
    raise exception '2C.3C backfill post-check failed: Project Role / Reports To / ended_at must not be derived.';
  end if;
end;
$backfill_report$;

/* ------------- 3. Legacy-tolerant rule: active rows are complete ---------- */
--
-- NOT VALID: the backfilled legacy rows above keep NULL Party / Project Role
-- and display "Needs party" / "Needs project role". Every INSERT and every
-- UPDATE is checked, so an edited legacy member must be completed, while
-- ENDING one (ended_at set) is allowed without completing it.
alter table public.project_members
  add constraint project_members_active_requires_party_and_role
  check (ended_at is not null or (party_id is not null and project_role is not null))
  not valid;

/* ------------------ 4a. Integrity triggers (any write path) --------------- */

create function public.guard_project_member_write() returns trigger
language plpgsql security invoker set search_path = '' as $guard$
declare
  v_target_ended timestamptz;
  v_target_found boolean;
begin
  if tg_op = 'INSERT' then
    -- A membership always starts active; ending is a separate operation.
    if new.ended_at is not null then
      raise exception '[MEMBER_MUST_START_ACTIVE] A new project membership must be active.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.contacts c
                    where c.id = new.contact_id and c.active and c.archived_at is null) then
      raise exception '[INACTIVE_PERSON] Only an active person can join a project team.' using errcode = '23514';
    end if;
  else
    if new.id is distinct from old.id or new.project_id is distinct from old.project_id
       or new.contact_id is distinct from old.contact_id or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception '[MEMBER_IDENTITY_IMMUTABLE] A membership keeps its project and person.' using errcode = '23514';
    end if;
    if old.ended_at is not null then
      raise exception '[MEMBER_ENDED] An ended membership is history and cannot be changed.' using errcode = '23514';
    end if;
    if new.ended_at is not null then
      -- Ending changes nothing else and never orphans a reporting line.
      if new.party_id is distinct from old.party_id
         or new.project_role is distinct from old.project_role
         or new.reports_to_member_id is distinct from old.reports_to_member_id then
        raise exception '[END_IS_SEPARATE] End a membership on its own, without other changes.' using errcode = '23514';
      end if;
      if exists (select 1 from public.project_members m
                  where m.project_id = old.project_id and m.reports_to_member_id = old.id
                    and m.ended_at is null) then
        raise exception '[HAS_ACTIVE_REPORTS] Reassign the members who report to this person before ending their membership.' using errcode = '23514';
      end if;
    end if;
  end if;

  if public.project_is_archived(new.project_id) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its team is read-only.' using errcode = '42501';
  end if;

  if new.ended_at is null and new.reports_to_member_id is not null
     and (tg_op = 'INSERT' or new.reports_to_member_id is distinct from old.reports_to_member_id) then
    -- Named explicitly; project_members_no_self_report is the backstop.
    if new.reports_to_member_id = new.id then
      raise exception '[SELF_REPORT] A member cannot report to themselves.' using errcode = '23514';
    end if;
    select true, m.ended_at into v_target_found, v_target_ended
      from public.project_members m
     where m.id = new.reports_to_member_id and m.project_id = new.project_id;
    if v_target_found is distinct from true or v_target_ended is not null then
      raise exception '[REPORTS_TO_INACTIVE] Reports To must be an active member of this project.' using errcode = '23514';
    end if;
    -- Walk up from the chosen manager; reaching this member is a cycle.
    -- UNION (not UNION ALL) terminates even over a malformed existing chain.
    if exists (
      with recursive chain(id) as (
        select new.reports_to_member_id
        union
        select m.reports_to_member_id
          from public.project_members m
          join chain on m.id = chain.id
         where m.reports_to_member_id is not null
      )
      select 1 from chain where chain.id = new.id
    ) then
      raise exception '[REPORTS_TO_CYCLE] This Reports To would create a reporting loop.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$guard$;
revoke execute on function public.guard_project_member_write() from public, anon, authenticated, service_role;

-- History is never physically deleted. A parent-project cascade still removes
-- the project's rows (the project itself is gone).
create function public.guard_project_member_delete() returns trigger
language plpgsql security invoker set search_path = '' as $delete$
begin
  if exists (select 1 from public.projects p where p.id = old.project_id) then
    raise exception '[MEMBER_HISTORY_PRESERVED] Project team history is never deleted. End the membership instead.' using errcode = '23514';
  end if;
  return old;
end;
$delete$;
revoke execute on function public.guard_project_member_delete() from public, anon, authenticated, service_role;

-- Historical integrity wins over subcontractor removal: a Party with any
-- current or ended membership cannot be hard-deleted. The plain sentence is
-- what Project Information shows; no database detail reaches the screen.
create function public.guard_project_party_team_history() returns trigger
language plpgsql security invoker set search_path = '' as $party$
begin
  if exists (select 1 from public.projects p where p.id = old.project_id)
     and exists (select 1 from public.project_members m
                  where m.project_id = old.project_id and m.party_id = old.id) then
    raise exception 'This subcontractor cannot be removed because project team history exists.'
      using errcode = '23503';
  end if;
  return old;
end;
$party$;
revoke execute on function public.guard_project_party_team_history() from public, anon, authenticated, service_role;

create trigger guard_project_party_team_history before delete on public.project_parties
  for each row execute function public.guard_project_party_team_history();

-- BEFORE row triggers fire alphabetically: the guard refuses before the
-- shared setup-version trigger advances the project.
create trigger guard_project_member_write before insert or update on public.project_members
  for each row execute function public.guard_project_member_write();
create trigger guard_project_member_delete before delete on public.project_members
  for each row execute function public.guard_project_member_delete();
-- Reuse the committed setup lock / version protocol: a membership change makes
-- every older Project Setup page stale, exactly like a parties or structure write.
create trigger lock_project_setup_statement before insert or update or delete on public.project_members
  for each statement execute function public.lock_project_setup_statement();
create trigger invalidate_setup_project_version before insert or update or delete on public.project_members
  for each row execute function public.invalidate_setup_project_version();
create trigger set_updated_at before update on public.project_members
  for each row execute function public.set_updated_at();

/* ------------------------- 4b. Row level security ------------------------- */

alter table public.project_members enable row level security;
revoke all on table public.project_members from public, anon, authenticated, service_role;
-- No DELETE privilege for anyone: membership history is ended, never deleted.
grant select, insert, update on table public.project_members to authenticated, service_role;

-- Read follows project visibility, like project_parties.
create policy project_members_select on public.project_members
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_members.project_id));
-- Write uses the EXISTING Project Responsibility authority unchanged: System
-- Admin / Project Control Admin, or the project's own assigned Project
-- Control / Planning — so an assigned user manages only their own projects.
create policy project_members_insert on public.project_members
  for insert to authenticated
  with check (public.can_manage_project_responsibilities(project_id));
create policy project_members_update on public.project_members
  for update to authenticated
  using (public.can_manage_project_responsibilities(project_id))
  with check (public.can_manage_project_responsibilities(project_id));

/* ------------------- 4c. Controlled write functions ----------------------- */
--
-- SECURITY INVOKER: the caller's own RLS and privileges apply; the functions
-- add the explicit authority / archive checks, the friendly validation and
-- the project-version compare-and-swap used by every Project Setup save.

create function public.add_project_member(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_contact uuid,
  p_party uuid,
  p_project_role text,
  p_reports_to uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $add$
declare
  v_role text := nullif(btrim(coalesce(p_project_role, '')), '');
  v_member uuid;
  v_version timestamptz;
begin
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_responsibilities(p_project) is distinct from true then
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
  if v_role is null or length(v_role) > 80 then
    raise exception '[PROJECT_ROLE_REQUIRED] Enter a project role of up to 80 characters.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if public.can_manage_project_responsibilities(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  update public.projects
     set updated_at = clock_timestamp()
   where id = p_project and updated_at = p_expected_updated_at;
  if not found then
    raise exception '[STALE] Project Setup changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;
  if exists (select 1 from public.project_members m
              where m.project_id = p_project and m.contact_id = p_contact and m.ended_at is null) then
    raise exception '[ALREADY_MEMBER] This person is already on the project team.' using errcode = '23505';
  end if;

  insert into public.project_members (project_id, contact_id, party_id, project_role, reports_to_member_id)
  values (p_project, p_contact, p_party, v_role, p_reports_to)
  returning id into v_member;

  select updated_at into strict v_version from public.projects where id = p_project;
  return jsonb_build_object('member_id', v_member, 'version', v_version);
end;
$add$;
revoke execute on function public.add_project_member(uuid, timestamptz, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.add_project_member(uuid, timestamptz, uuid, uuid, text, uuid) to authenticated;

-- Party, Project Role and Reports To are saved together: an edited legacy
-- member must be completed (Party + Project Role) before it can be saved.
create function public.update_project_member(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_member uuid,
  p_party uuid,
  p_project_role text,
  p_reports_to uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $update$
declare
  v_role text := nullif(btrim(coalesce(p_project_role, '')), '');
  v_version timestamptz;
begin
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_responsibilities(p_project) is distinct from true then
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
  if v_role is null or length(v_role) > 80 then
    raise exception '[PROJECT_ROLE_REQUIRED] Enter a project role of up to 80 characters.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if public.can_manage_project_responsibilities(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  update public.projects
     set updated_at = clock_timestamp()
   where id = p_project and updated_at = p_expected_updated_at;
  if not found then
    raise exception '[STALE] Project Setup changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;

  update public.project_members
     set party_id = p_party, project_role = v_role, reports_to_member_id = p_reports_to
   where id = p_member and project_id = p_project and ended_at is null;
  if not found then
    raise exception '[NOT_FOUND] This member is no longer active on this project. Reload the page.'
      using errcode = 'P0002';
  end if;

  select updated_at into strict v_version from public.projects where id = p_project;
  return jsonb_build_object('member_id', p_member, 'version', v_version);
end;
$update$;
revoke execute on function public.update_project_member(uuid, timestamptz, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.update_project_member(uuid, timestamptz, uuid, uuid, text, uuid) to authenticated;

-- Ending is its own operation and needs no Party / Project Role, so an
-- incomplete legacy membership can be ended as it is.
create function public.end_project_member(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_member uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $end$
declare
  v_version timestamptz;
begin
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_responsibilities(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  if p_project is null or p_expected_updated_at is null or p_member is null then
    raise exception '[INVALID_INPUT] Project, version and member are required.' using errcode = '22023';
  end if;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its team is read-only.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if public.can_manage_project_responsibilities(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] You cannot manage this project''s team.' using errcode = '42501';
  end if;
  update public.projects
     set updated_at = clock_timestamp()
   where id = p_project and updated_at = p_expected_updated_at;
  if not found then
    raise exception '[STALE] Project Setup changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;

  update public.project_members
     set ended_at = clock_timestamp()
   where id = p_member and project_id = p_project and ended_at is null;
  if not found then
    raise exception '[NOT_FOUND] This member is no longer active on this project. Reload the page.'
      using errcode = 'P0002';
  end if;

  select updated_at into strict v_version from public.projects where id = p_project;
  return jsonb_build_object('member_id', p_member, 'version', v_version);
end;
$end$;
revoke execute on function public.end_project_member(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.end_project_member(uuid, timestamptz, uuid) to authenticated;

/* ------------------------------ Post-checks ------------------------------- */

do $post$
declare
  v_helpers text;
  v_policies text;
begin
  -- Membership grants no authority: no authorization helper reads it.
  select string_agg(p.proname, ', ' order by p.proname) into v_helpers
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
          or p.proname ~ '_accepts_department_input$')
     and p.prosrc ilike '%project_members%';
  if v_helpers is not null then
    raise exception '2C.3C post-check failed: authorization helper(s) read project_members: %', v_helpers;
  end if;
  -- No other table's policy may derive access from membership either.
  select string_agg(schemaname || '.' || tablename || ':' || policyname, ', ') into v_policies
    from pg_catalog.pg_policies
   where tablename <> 'project_members'
     and (coalesce(qual, '') ilike '%project_members%' or coalesce(with_check, '') ilike '%project_members%');
  if v_policies is not null then
    raise exception '2C.3C post-check failed: policies read project_members: %', v_policies;
  end if;
  if exists (select 1 from public.project_members
              group by project_id, contact_id having count(*) filter (where ended_at is null) > 1) then
    raise exception '2C.3C post-check failed: more than one active membership for a person on a project.';
  end if;
  if (select count(*) from pg_catalog.pg_policies where tablename = 'project_members' and cmd = 'DELETE') <> 0 then
    raise exception '2C.3C post-check failed: project_members must have no DELETE policy.';
  end if;
end;
$post$;
