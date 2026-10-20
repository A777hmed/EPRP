-- Phase 13.9B — Project Setup Governance — Step 2: Setup Finalisation and the
-- Reported Progress stream (database foundation).
--
-- Architecture: docs/02_PLATFORM_ARCHITECTURE.md §26.14, §26.24.5–§26.24.8
-- (decisions B14, B18–B21, B23, B24); logical model: docs/06_DATABASE_SCHEMA.md
-- §10A.11.4–§10A.11.5; authority: docs/05_PERMISSION_MODEL.md §3.9.
--
-- WHAT THIS ADDS
--   0. Legacy classification bootstrap (owner closure 2026-10-17). A
--      Controlled project whose Project Type is still NULL is classified ONCE
--      through the existing System Administrator correction,
--      correct_project_structure_family(), which may now set the initial
--      family and its Project Category atomically. It is recorded once in the
--      existing project_classification_corrections history
--      (correction_kind = 'legacy_bootstrap', old_family NULL) and never as an
--      amendment. Step 1's broader exemption (any setup manager classifying a
--      Controlled legacy project through Project Setup) is withdrawn: once
--      Controlled, a NULL family changes only through this path. Projects
--      that are not Controlled classify through Project Setup exactly as
--      before. After the bootstrap the normal rules apply.
--   1. project_setup_finalisations + finalise_project_setup() — the
--      append-only, irreversible Setup Finalisation of a no_formal_schedule
--      project (B23). One per project. It creates no snapshot, figure or
--      planning governance.
--   2. project_setup_controlled_since() now returns the EARLIER of the first
--      Published Planning Snapshot and the Setup Finalisation. The approved
--      BL0 anchor remains 13.12.
--   3. project_reported_progress + record_ / correct_ / withdraw_reported_
--      progress() — the canonical append-only Reported Progress stream (B14)
--      for a Finalised no_formal_schedule project with no Published Planning
--      Snapshot. Correction and withdrawal chains are linear (one successor
--      per entry, unique), stay within one Data Date, never fork and cannot
--      cycle. A withdrawal is terminal. Future Data Dates are refused in the
--      project's time zone; a report dated before the latest valid Data Date
--      needs a reason and is marked back-dated (B20).
--   4. project_reported_progress_heads() / _latest() — the current head per
--      Data Date and the latest valid position (greatest Data Date whose head
--      is not a withdrawal). SPI does not exist here: no PV / EV / SPI column.
--
-- Every write is a hardened SECURITY DEFINER function; there are no direct
-- write grants. A BEFORE INSERT integrity trigger re-checks eligibility,
-- dates and the chain for every inserter, the owner included, so the
-- invariants do not depend on the functions alone.
--
-- UNCHANGED, by design: projects.planned_progress / actual_progress (retired,
-- never read here); Weekly and Monthly (they neither write nor own this
-- stream — referencing an entry is 13.17–13.19); publish_planning_snapshot();
-- the Step 1 registry, amendments and onboarding transitions; every existing
-- policy and authority predicate.

/* ------------------- 0. Legacy classification bootstrap ------------------- */

alter table public.project_classification_corrections
  add column correction_kind text not null default 'correction';
alter table public.project_classification_corrections
  alter column old_family drop not null;
alter table public.project_classification_corrections
  add constraint project_classification_corrections_kind_valid
    check (correction_kind in ('correction', 'legacy_bootstrap'));
-- A NULL old family is the bootstrap, and only the bootstrap.
alter table public.project_classification_corrections
  add constraint project_classification_corrections_bootstrap_shape
    check ((correction_kind = 'legacy_bootstrap') = (old_family is null));
create unique index project_classification_corrections_one_bootstrap
  on public.project_classification_corrections (project_id) where correction_kind = 'legacy_bootstrap';

comment on column public.project_classification_corrections.correction_kind is
  '13.9B Step 2. correction = the 2C.1 System Administrator correction of a locked Project Type. legacy_bootstrap = the one-time classification of a Controlled project whose Project Type was still NULL (old_family NULL), at most once per project (owner closure 2026-10-17).';

create or replace function public.correct_project_structure_family(
  p_project uuid,
  p_expected_updated_at timestamp with time zone,
  p_new_family text,
  p_project_type_id uuid,
  p_project_category_detail text,
  p_reason text
)
returns timestamp with time zone
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_reason        text;
  v_detail_in     text;
  v_allows_custom boolean;
  v_new_type_name text;
  v_type_active   boolean;
  v_type_psm      boolean;
  v_old           text;
  v_old_type      uuid;
  v_old_detail    text;
  v_old_type_name text;
  v_version       timestamptz;
  v_actor_name    text;
  v_saved_at      timestamptz;
  v_kind          text := 'correction';
begin
  -- 1. Authority first: an unauthorized caller learns nothing about the project.
  if auth.uid() is null or public.current_user_role() is null
     or public.is_system_admin() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a System Admin can correct a Project Type.'
      using errcode = '42501';
  end if;

  -- 2. Mandatory, non-blank reason.
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception '[REASON_REQUIRED] A reason is required to correct a Project Type.'
      using errcode = '22023';
  end if;

  -- 3. The target must be a complete, valid classification.
  if p_project is null or p_expected_updated_at is null
     or p_new_family is null or p_new_family not in ('psm', 'other') then
    raise exception '[INVALID_TARGET] Invalid Project Type correction.' using errcode = '22023';
  end if;
  v_detail_in := nullif(btrim(coalesce(p_project_category_detail, '')), '');

  if p_new_family = 'psm' then
    -- A PSM project has no Project Category.
    if p_project_type_id is not null or v_detail_in is not null then
      raise exception '[INVALID_TARGET] A PSM project has no Project Category.'
        using errcode = '22023';
    end if;
  else
    if p_project_type_id is null then
      raise exception '[CATEGORY_REQUIRED] An Other project needs a Project Category.'
        using errcode = '23514';
    end if;
    select pt.allows_custom_name, pt.name, pt.active,
           public.is_psm_family_project_type(pt.code, pt.name)
      into v_allows_custom, v_new_type_name, v_type_active, v_type_psm
      from public.project_types pt
     where pt.id = p_project_type_id;
    if not found or v_type_active is distinct from true then
      raise exception '[CATEGORY_INVALID] Choose an active Project Category.'
        using errcode = '23514';
    end if;
    if v_type_psm then
      raise exception '[CATEGORY_PSM_FAMILY] An Other project cannot use a PSM / PSAIM Project Category.'
        using errcode = '23514';
    end if;
    if v_allows_custom and v_detail_in is null then
      raise exception '[DETAIL_REQUIRED] Specify the category name for this Project Category.'
        using errcode = '23514';
    end if;
    if not v_allows_custom and v_detail_in is not null then
      raise exception '[DETAIL_NOT_ALLOWED] This Project Category does not take a custom name.'
        using errcode = '23514';
    end if;
  end if;

  -- 4. Same lock order as every other setup writer: advisory lock, then rows.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if auth.uid() is null or public.current_user_role() is null
     or public.is_system_admin() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a System Admin can correct a Project Type.'
      using errcode = '42501';
  end if;

  select structure_family, project_type_id, project_category_detail, updated_at
    into v_old, v_old_type, v_old_detail, v_version
    from public.projects
   where id = p_project
   for update;
  if not found then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'P0002';
  end if;
  if v_version is distinct from p_expected_updated_at then
    raise exception '[STALE] The project changed since this page loaded. Reload before correcting.'
      using errcode = 'PT409';
  end if;
  if v_old is null then
    -- 13.9B Step 2: a Controlled legacy project is classified once here (the
    -- bootstrap). Any other unclassified project still classifies from
    -- Project Setup, exactly as before.
    if not public.project_setup_controlled(p_project) then
      raise exception '[NOT_CLASSIFIED] This project is not classified yet. Classify it from Project Setup instead.'
        using errcode = '22023';
    end if;
    v_kind := 'legacy_bootstrap';
  elsif v_old = p_new_family then
    raise exception '[SAME_TYPE] The project already has this Project Type.' using errcode = '22023';
  end if;

  -- 4b. (2C.1c) An Other project whose structure is still active cannot
  -- become PSM. Archived units alone do not block the correction; they stay
  -- with the project, read-only (the structure guard refuses writes on a
  -- non-Other project). Stronger guards arrive with historical references.
  if v_old = 'other' and p_new_family = 'psm' and exists (
    select 1 from public.project_structure_nodes n
     where n.project_id = p_project and n.archived_at is null
  ) then
    raise exception '[STRUCTURE_EXISTS] Archive this project''s structure units before changing it to a PSM Project.'
      using errcode = '23514';
  end if;

  select pt.name into v_old_type_name from public.project_types pt where pt.id = v_old_type;
  select p.full_name into v_actor_name from public.profiles p where p.id = auth.uid();

  -- 5. Audit BEFORE the change: the lock trigger looks for this row.
  insert into public.project_classification_corrections (
    project_id, old_family, new_family,
    old_project_type_id, new_project_type_id,
    old_project_type_name, new_project_type_name,
    old_category_detail, new_category_detail,
    reason, corrected_by, corrected_by_name, correction_kind
  ) values (
    p_project, v_old, p_new_family,
    v_old_type, p_project_type_id,
    v_old_type_name, v_new_type_name,
    v_old_detail, v_detail_in,
    v_reason, auth.uid(), v_actor_name, v_kind
  );

  -- 6. Then the project, to exactly the audited target.
  update public.projects
     set structure_family = p_new_family,
         project_type_id = p_project_type_id,
         project_category_detail = v_detail_in
   where id = p_project
   returning updated_at into v_saved_at;

  return v_saved_at;
end;
$function$;

-- The Step 1 guard, without the broad legacy exemption: once Controlled, the
-- Project Type (and the classification that travels with it) changes only
-- with a System Administrator correction row from this transaction —
-- the 2C.1 correction or the one-time legacy bootstrap above.
create or replace function public.guard_project_setup_controlled()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_old jsonb;
  v_new jsonb;
  v_entry record;
  v_old_value jsonb;
  v_new_value jsonb;
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_sa_correction boolean;
begin
  if not public.project_setup_controlled(old.id) then
    return new;  -- before Controlled every field behaves exactly as today
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;

  v_sa_correction := exists (
    select 1 from public.project_classification_corrections c
     where c.project_id = new.id
       and c.transaction_id = pg_catalog.pg_current_xact_id()
       and c.new_family is not distinct from new.structure_family
       and c.new_project_type_id is not distinct from new.project_type_id
       and c.new_category_detail is not distinct from new.project_category_detail);

  for v_entry in
    select r.field_key, r.target_columns, r.field_class, r.label
      from public.project_setup_field_registry() r
     where r.kind = 'column' and r.target_table = 'projects'
  loop
    v_old_value := public.project_setup_pick(v_old, v_entry.target_columns);
    v_new_value := public.project_setup_pick(v_new, v_entry.target_columns);
    continue when v_old_value = v_new_value;

    -- The System Administrator correction keeps its own audit row (B16).
    continue when v_entry.field_key in ('structure_family', 'project_category') and v_sa_correction;

    case v_entry.field_class
      when 'free_logged' then
        insert into public.project_setup_field_changes
          (project_id, field_key, previous_value, new_value, change_source, changed_by, changed_by_name)
        values (new.id, v_entry.field_key, v_old_value, v_new_value, 'direct_edit', v_actor, v_actor_name);
      when 'lightweight' then
        if not public.project_setup_amendment_authorises(new.id, v_entry.field_key, 'applied', v_new_value) then
          raise exception '[SETUP_CONTROLLED] % is controlled once Project Setup is controlled. Amend it with a reason.',
            v_entry.label using errcode = '42501';
        end if;
      when 'governed' then
        if not public.project_setup_amendment_authorises(new.id, v_entry.field_key, 'approved', v_new_value) then
          raise exception '[SETUP_CONTROLLED] % is controlled once Project Setup is controlled. Request an amendment; another Project Control Admin or System Administrator must approve it.',
            v_entry.label using errcode = '42501';
        end if;
      when 'retired' then
        raise exception '[SETUP_FIELD_RETIRED] % is retired and can no longer be changed.',
          v_entry.label using errcode = '42501';
      when 'system_admin_correction' then
        raise exception '[SETUP_CONTROLLED] The Project Type of a controlled project is set only through the System Administrator correction.'
          using errcode = '42501';
      else
        raise exception '[SETUP_CONTROLLED] % cannot be changed here.', v_entry.label using errcode = '42501';
    end case;
  end loop;

  return new;
end;
$fn$;

-- No row used the withdrawn Step 1 source (the bootstrap is now recorded in
-- the classification history), so the value is removed from the log.
alter table public.project_setup_field_changes drop constraint project_setup_field_changes_source_valid;
alter table public.project_setup_field_changes add constraint project_setup_field_changes_source_valid
  check (change_source in ('direct_edit'));

/* --------------------------- 1. Setup Finalisation ------------------------ */

create table public.project_setup_finalisations (
  id                              uuid primary key default gen_random_uuid(),
  project_id                      uuid not null references public.projects(id) on delete cascade,
  onboarding_mode_at_finalisation text not null,
  state_before                    text not null default 'not_controlled',
  state_after                     text not null default 'controlled',
  acknowledgement                 text not null,
  note                            text,
  finalised_by                    uuid not null,
  finalised_by_name               text,
  finalised_at                    timestamptz not null default now(),
  transaction_id                  xid8 not null default pg_catalog.pg_current_xact_id(),
  source                          text not null default 'project_setup',
  constraint project_setup_finalisations_one_per_project unique (project_id),
  constraint project_setup_finalisations_mode check (onboarding_mode_at_finalisation = 'no_formal_schedule'),
  constraint project_setup_finalisations_states check (state_before = 'not_controlled' and state_after = 'controlled'),
  constraint project_setup_finalisations_ack_present check (btrim(acknowledgement) <> ''),
  constraint project_setup_finalisations_source_valid check (source in ('project_setup'))
);

comment on table public.project_setup_finalisations is
  '13.9B Step 2. The append-only, irreversible Setup Finalisation of a no_formal_schedule project (docs/06 §10A.11.4, B23). One per project. Makes Project Setup Controlled by derivation; never creates a snapshot, PV, EV, SPI or planning governance. Written only by finalise_project_setup().';

/* ----------------------- 2. Controlled derivation (v2) -------------------- */

create or replace function public.project_setup_controlled_since(p_project uuid)
returns timestamptz language sql stable security definer set search_path = '' as $fn$
  select least(
    (select min(s.published_at) from public.planning_snapshots s where s.project_id = p_project),
    (select f.finalised_at from public.project_setup_finalisations f where f.project_id = p_project));
$fn$;

comment on function public.project_setup_controlled_since(uuid) is
  '13.9B. Derived, never stored: the earliest governance anchor — the first Published Planning Snapshot or the Setup Finalisation, whichever came first. 13.12 adds the approved BL0.';

-- Integrity for every inserter, the owner included.
create function public.guard_setup_finalisation_entry()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if coalesce((select s.onboarding_mode from public.project_planning_settings s where s.project_id = new.project_id),
              'new_project') <> 'no_formal_schedule' then
    raise exception '[FINALISE_WRONG_MODE] Only a project planned without a formal schedule is finalised. Publish a Planning Snapshot for a planned project instead.'
      using errcode = '23514';
  end if;
  if public.project_setup_controlled(new.project_id) then
    raise exception '[SETUP_ALREADY_CONTROLLED] Project Setup is already controlled.' using errcode = 'PT409';
  end if;
  return new;
end;
$fn$;

create trigger block_archived_setup_governance
  before insert or update or delete on public.project_setup_finalisations
  for each row execute function public.guard_archived_project_setup();
create trigger guard_setup_finalisation_entry
  before insert on public.project_setup_finalisations
  for each row execute function public.guard_setup_finalisation_entry();
create trigger guard_setup_governance_history
  before update or delete on public.project_setup_finalisations
  for each row execute function public.guard_project_setup_governance_history();

create function public.finalise_project_setup(
  p_project uuid,
  p_confirm boolean,
  p_acknowledgement text,
  p_note text default null
) returns public.project_setup_finalisations
language plpgsql security definer set search_path = '' as $fn$
declare
  v_ack text := nullif(btrim(coalesce(p_acknowledgement, '')), '');
  v_row public.project_setup_finalisations;
begin
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_operations(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a System Administrator, a Project Control Admin or this project''s assigned Project Control can finalise Project Setup.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'P0002';
  end if;
  if coalesce(p_confirm, false) is distinct from true or v_ack is null then
    raise exception '[FINALISE_CONFIRMATION_REQUIRED] Finalising makes core Project Setup controlled and cannot be undone. Confirm this to finalise.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  perform 1 from public.projects where id = p_project for update;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its setup is read-only.' using errcode = '42501';
  end if;
  if exists (select 1 from public.project_setup_finalisations where project_id = p_project) then
    raise exception '[SETUP_ALREADY_FINALISED] Project Setup is already finalised. Finalisation cannot be repeated or undone.'
      using errcode = 'PT409';
  end if;

  insert into public.project_setup_finalisations (
    project_id, onboarding_mode_at_finalisation, acknowledgement, note, finalised_by, finalised_by_name
  ) values (
    p_project, 'no_formal_schedule', v_ack, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
    (select full_name from public.profiles where id = auth.uid())
  ) returning * into v_row;
  return v_row;
end;
$fn$;

comment on function public.finalise_project_setup(uuid, boolean, text, text) is
  '13.9B Step 2. Finalises a no_formal_schedule project that is not yet Controlled (System Administrator, Project Control Admin, assigned Project Control). Requires p_confirm = true and the acknowledgement shown. Irreversible; creates no snapshot or figure.';

/* ------------------------ 3. Reported Progress stream --------------------- */

create table public.project_reported_progress (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references public.projects(id) on delete cascade,
  data_date                date not null,
  entry_kind               text not null,
  reported_planned_percent numeric(5, 2),
  reported_actual_percent  numeric(5, 2),
  narrative                text,
  supersedes_entry_id      uuid,
  reason                   text,
  is_backdated             boolean not null default false,
  source                   text not null default 'eprp_entry',
  recorded_by              uuid not null,
  recorded_by_name         text,
  recorded_at              timestamptz not null default now(),
  transaction_id           xid8 not null default pg_catalog.pg_current_xact_id(),
  constraint project_reported_progress_id_project unique (id, project_id),
  -- A chain never leaves its project.
  constraint project_reported_progress_supersedes_fk foreign key (supersedes_entry_id, project_id)
    references public.project_reported_progress (id, project_id),
  -- One successor per entry: no fork, no competing correction, no second withdrawal.
  constraint project_reported_progress_one_successor unique (supersedes_entry_id),
  constraint project_reported_progress_kind_valid check (entry_kind in ('report', 'correction', 'withdrawal')),
  constraint project_reported_progress_chain_shape check (
    (entry_kind = 'report') = (supersedes_entry_id is null)),
  constraint project_reported_progress_not_self check (supersedes_entry_id is distinct from id),
  constraint project_reported_progress_values check (
    case entry_kind
      when 'withdrawal' then reported_actual_percent is null and reported_planned_percent is null
      else reported_actual_percent is not null
    end),
  constraint project_reported_progress_actual_range
    check (reported_actual_percent is null or reported_actual_percent between 0 and 100),
  constraint project_reported_progress_planned_range
    check (reported_planned_percent is null or reported_planned_percent between 0 and 100),
  constraint project_reported_progress_narrative check (
    entry_kind = 'withdrawal' or btrim(coalesce(narrative, '')) <> ''),
  constraint project_reported_progress_reason check (
    (entry_kind = 'report' and not is_backdated) or btrim(coalesce(reason, '')) <> ''),
  constraint project_reported_progress_backdated_report_only check (not is_backdated or entry_kind = 'report'),
  constraint project_reported_progress_source_valid check (source in ('eprp_entry'))
);

-- One original report per Data Date.
create unique index project_reported_progress_one_report_per_date
  on public.project_reported_progress (project_id, data_date) where entry_kind = 'report';
create index project_reported_progress_project_date
  on public.project_reported_progress (project_id, data_date desc, recorded_at desc);

comment on table public.project_reported_progress is
  '13.9B Step 2 / B14. The canonical append-only Reported Progress stream of a Finalised no_formal_schedule project without a Published Planning Snapshot (docs/06 §10A.11.5). Not projects.planned_progress / actual_progress, not Weekly, not Monthly. Chains: report -> correction* -> [withdrawal]; one successor per entry; same project and Data Date; a withdrawal is terminal. SPI does not exist here.';

-- Today in the project's time zone (UTC if the stored zone is not valid).
create function public.project_local_today(p_project uuid)
returns date language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_zone text := (select p.time_zone from public.projects p where p.id = p_project);
begin
  begin
    return (now() at time zone coalesce(v_zone, 'UTC'))::date;
  exception when others then
    return (now() at time zone 'UTC')::date;
  end;
end;
$fn$;

-- The greatest Data Date whose current head is not a withdrawal.
create function public.project_reported_progress_latest_date(p_project uuid)
returns date language sql stable security definer set search_path = '' as $fn$
  select max(e.data_date) from public.project_reported_progress e
   where e.project_id = p_project and e.entry_kind <> 'withdrawal'
     and not exists (select 1 from public.project_reported_progress s where s.supersedes_entry_id = e.id);
$fn$;

-- Eligibility (B19 + §26.24.5), raised as the user's sentence.
create function public.assert_reported_progress_writable(p_project uuid)
returns void language plpgsql stable security definer set search_path = '' as $fn$
begin
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its reported progress is read-only.' using errcode = '42501';
  end if;
  if coalesce((select s.onboarding_mode from public.project_planning_settings s where s.project_id = p_project),
              'new_project') <> 'no_formal_schedule' then
    raise exception '[REPORTED_PROGRESS_NOT_ALLOWED] Reported Progress is recorded only for a project planned without a formal schedule. This project''s progress comes from its Published Planning Snapshot.'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.planning_snapshots s where s.project_id = p_project) then
    raise exception '[REPORTED_PROGRESS_NOT_ALLOWED] This project has a Published Planning Snapshot; its progress comes from the snapshot, not from Reported Progress.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.project_setup_finalisations f where f.project_id = p_project) then
    raise exception '[SETUP_NOT_FINALISED] Finalise Project Setup before recording Reported Progress.' using errcode = '23514';
  end if;
end;
$fn$;

-- Integrity for every inserter, the owner included: eligibility, the Data
-- Date, the back-dated flag and the chain.
create function public.guard_reported_progress_entry()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_target public.project_reported_progress;
  v_latest date;
begin
  perform public.assert_reported_progress_writable(new.project_id);

  if new.entry_kind = 'report' then
    if new.data_date > public.project_local_today(new.project_id) then
      raise exception '[DATA_DATE_IN_FUTURE] The Data Date cannot be later than today in the project''s time zone.'
        using errcode = '22023';
    end if;
    -- Server-set, never trusted from the caller (B20).
    v_latest := public.project_reported_progress_latest_date(new.project_id);
    new.is_backdated := v_latest is not null and new.data_date < v_latest;
    if new.is_backdated and btrim(coalesce(new.reason, '')) = '' then
      raise exception '[BACKDATE_REASON_REQUIRED] This Data Date is earlier than the latest reported Data Date (%). A reason is required.',
        v_latest using errcode = '22023';
    end if;
  else
    select * into v_target from public.project_reported_progress where id = new.supersedes_entry_id;
    if not found or v_target.project_id <> new.project_id then
      raise exception '[NOT_FOUND] Reported Progress entry not found.' using errcode = 'P0002';
    end if;
    if v_target.entry_kind = 'withdrawal' then
      raise exception '[ENTRY_WITHDRAWN] This Reported Progress entry was withdrawn. A withdrawal is final.'
        using errcode = 'PT409';
    end if;
    if exists (select 1 from public.project_reported_progress s where s.supersedes_entry_id = v_target.id) then
      raise exception '[ENTRY_NOT_CURRENT] This entry has already been corrected or withdrawn. Act on its latest version.'
        using errcode = 'PT409';
    end if;
    -- A chain stays on its Data Date.
    new.data_date := v_target.data_date;
    new.is_backdated := false;
  end if;
  return new;
end;
$fn$;

create function public.guard_archived_reported_progress()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  -- Both ends of an UPDATE count (13.9 pattern).
  if (tg_op <> 'INSERT' and public.project_is_archived(old.project_id))
     or (tg_op <> 'DELETE' and public.project_is_archived(new.project_id)) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its reported progress is read-only.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

create trigger block_archived_reported_progress
  before insert or update or delete on public.project_reported_progress
  for each row execute function public.guard_archived_reported_progress();
create trigger guard_reported_progress_entry
  before insert on public.project_reported_progress
  for each row execute function public.guard_reported_progress_entry();
create trigger guard_setup_governance_history
  before update or delete on public.project_reported_progress
  for each row execute function public.guard_project_setup_governance_history();

/* ------------------- 4. Reported Progress write functions ----------------- */

create function public.reported_progress_check_values(
  p_actual numeric, p_planned numeric, p_narrative text
) returns void language plpgsql immutable set search_path = '' as $fn$
begin
  if p_actual is null or p_actual < 0 or p_actual > 100 then
    raise exception '[INVALID_VALUE] Reported actual progress is required, from 0 to 100 %%.' using errcode = '22023';
  end if;
  if p_planned is not null and (p_planned < 0 or p_planned > 100) then
    raise exception '[INVALID_VALUE] Reported planned progress must be from 0 to 100 %%.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_narrative, '')) = '' then
    raise exception '[NARRATIVE_REQUIRED] Explain the reported position.' using errcode = '22023';
  end if;
end;
$fn$;

create function public.record_reported_progress(
  p_project uuid,
  p_data_date date,
  p_reported_actual_percent numeric,
  p_narrative text,
  p_reported_planned_percent numeric default null,
  p_reason text default null
) returns public.project_reported_progress
language plpgsql security definer set search_path = '' as $fn$
declare
  v_row public.project_reported_progress;
begin
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_operations(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a System Administrator, a Project Control Admin or this project''s assigned Project Control can record Reported Progress.'
      using errcode = '42501';
  end if;
  if p_data_date is null then
    raise exception '[INVALID_VALUE] A Data Date is required.' using errcode = '22023';
  end if;
  perform public.reported_progress_check_values(p_reported_actual_percent, p_reported_planned_percent, p_narrative);

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if exists (select 1 from public.project_reported_progress e
              where e.project_id = p_project and e.data_date = p_data_date and e.entry_kind = 'report') then
    raise exception '[REPORTED_PROGRESS_DATE_EXISTS] Progress is already reported for this Data Date. Correct that entry instead.'
      using errcode = 'PT409';
  end if;
  begin
    insert into public.project_reported_progress (
      project_id, data_date, entry_kind, reported_planned_percent, reported_actual_percent, narrative,
      reason, recorded_by, recorded_by_name
    ) values (
      p_project, p_data_date, 'report', p_reported_planned_percent, p_reported_actual_percent, btrim(p_narrative),
      nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), (select full_name from public.profiles where id = auth.uid())
    ) returning * into v_row;
  exception when unique_violation then
    raise exception '[REPORTED_PROGRESS_DATE_EXISTS] Progress is already reported for this Data Date. Correct that entry instead.'
      using errcode = 'PT409';
  end;
  return v_row;
end;
$fn$;

-- Shared by correct / withdraw: the target, its authority and the lock.
create function public.reported_progress_supersede(
  p_entry uuid, p_kind text, p_actual numeric, p_planned numeric, p_narrative text, p_reason text
) returns public.project_reported_progress
language plpgsql security definer set search_path = '' as $fn$
declare
  v_project uuid := (select e.project_id from public.project_reported_progress e where e.id = p_entry);
  v_row public.project_reported_progress;
begin
  if auth.uid() is null or public.current_user_role() is null
     or v_project is null or public.can_manage_project_operations(v_project) is distinct from true then
    -- An unauthorised caller learns nothing about whether the entry exists.
    raise exception '[NOT_AUTHORIZED] Only a System Administrator, a Project Control Admin or this project''s assigned Project Control can change Reported Progress.'
      using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception '[REASON_REQUIRED] A reason is required to % a Reported Progress entry.',
      case p_kind when 'correction' then 'correct' else 'withdraw' end using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  begin
    insert into public.project_reported_progress (
      project_id, data_date, entry_kind, reported_planned_percent, reported_actual_percent, narrative,
      supersedes_entry_id, reason, recorded_by, recorded_by_name
    ) select
      e.project_id, e.data_date, p_kind, p_planned, p_actual, nullif(btrim(coalesce(p_narrative, '')), ''),
      e.id, btrim(p_reason), auth.uid(), (select full_name from public.profiles where id = auth.uid())
      from public.project_reported_progress e where e.id = p_entry
    returning * into v_row;
  exception when unique_violation then
    raise exception '[ENTRY_NOT_CURRENT] This entry has already been corrected or withdrawn. Act on its latest version.'
      using errcode = 'PT409';
  end;
  return v_row;
end;
$fn$;

create function public.correct_reported_progress(
  p_entry uuid,
  p_reported_actual_percent numeric,
  p_narrative text,
  p_reason text,
  p_reported_planned_percent numeric default null
) returns public.project_reported_progress
language plpgsql security definer set search_path = '' as $fn$
begin
  perform public.reported_progress_check_values(p_reported_actual_percent, p_reported_planned_percent, p_narrative);
  return public.reported_progress_supersede(p_entry, 'correction', p_reported_actual_percent,
                                            p_reported_planned_percent, p_narrative, p_reason);
end;
$fn$;

create function public.withdraw_reported_progress(
  p_entry uuid,
  p_reason text,
  p_narrative text default null
) returns public.project_reported_progress
language plpgsql security definer set search_path = '' as $fn$
begin
  return public.reported_progress_supersede(p_entry, 'withdrawal', null, null, p_narrative, p_reason);
end;
$fn$;

comment on function public.record_reported_progress(uuid, date, numeric, text, numeric, text) is
  '13.9B Step 2 / B19–B21. Records an original report for a Data Date (one per date). Not in the future (project time zone); a date before the latest valid Data Date needs p_reason and is marked back-dated.';
comment on function public.correct_reported_progress(uuid, numeric, text, text, numeric) is
  '13.9B Step 2. Supersedes the CURRENT head of an entry''s chain with a correction (same Data Date), with a reason. A superseded or withdrawn entry is refused (PT409).';
comment on function public.withdraw_reported_progress(uuid, text, text) is
  '13.9B Step 2. Supersedes the current head with a terminal withdrawal, with a reason.';

/* ----------------------------- 5. Read helpers ---------------------------- */

-- SECURITY INVOKER: the caller's RLS applies.
create function public.project_reported_progress_heads(p_project uuid)
returns setof public.project_reported_progress language sql stable set search_path = '' as $fn$
  select e.* from public.project_reported_progress e
   where e.project_id = p_project
     and not exists (select 1 from public.project_reported_progress s where s.supersedes_entry_id = e.id)
   order by e.data_date desc;
$fn$;

create function public.project_reported_progress_latest(p_project uuid)
returns setof public.project_reported_progress language sql stable set search_path = '' as $fn$
  select h.* from public.project_reported_progress_heads(p_project) h
   where h.entry_kind <> 'withdrawal'
   order by h.data_date desc
   limit 1;
$fn$;

comment on function public.project_reported_progress_latest(uuid) is
  '13.9B Step 2. The latest valid Reported Progress position: the head (no successor) with the greatest Data Date that is not a withdrawal. Always labelled "Reported — not planning governed"; SPI "N/A".';

/* --------------------------- 6. RLS and grants ---------------------------- */

alter table public.project_setup_finalisations enable row level security;
alter table public.project_reported_progress enable row level security;

create policy project_setup_finalisations_select on public.project_setup_finalisations
  for select to authenticated using (public.can_access_project(project_id));
create policy project_reported_progress_select on public.project_reported_progress
  for select to authenticated using (public.can_access_project(project_id));

revoke all on public.project_setup_finalisations from public, anon, authenticated, service_role;
revoke all on public.project_reported_progress from public, anon, authenticated, service_role;
grant select on public.project_setup_finalisations to authenticated, service_role;
grant select on public.project_reported_progress to authenticated, service_role;

do $grants$
declare
  v_internal constant text[] := array[
    'public.guard_setup_finalisation_entry()',
    'public.guard_reported_progress_entry()',
    'public.guard_archived_reported_progress()',
    'public.project_local_today(uuid)',
    'public.project_reported_progress_latest_date(uuid)',
    'public.assert_reported_progress_writable(uuid)',
    'public.reported_progress_check_values(numeric,numeric,text)',
    'public.reported_progress_supersede(uuid,text,numeric,numeric,text,text)'];
  v_client constant text[] := array[
    'public.finalise_project_setup(uuid,boolean,text,text)',
    'public.record_reported_progress(uuid,date,numeric,text,numeric,text)',
    'public.correct_reported_progress(uuid,numeric,text,text,numeric)',
    'public.withdraw_reported_progress(uuid,text,text)',
    'public.project_reported_progress_heads(uuid)',
    'public.project_reported_progress_latest(uuid)'];
  v_fn text;
begin
  foreach v_fn in array v_internal loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
  foreach v_fn in array v_client loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;
end;
$grants$;

/* ---------------------------- 7. Post-checks ------------------------------ */

do $post$
begin
  -- Archived guards answer first on both new tables.
  if exists (select 1 from pg_catalog.pg_trigger g
              where g.tgrelid = 'public.project_setup_finalisations'::regclass and not g.tgisinternal
                and (g.tgtype & 3) = 3 and g.tgname < 'block_archived_setup_governance')
     or exists (select 1 from pg_catalog.pg_trigger g
              where g.tgrelid = 'public.project_reported_progress'::regclass and not g.tgisinternal
                and (g.tgtype & 3) = 3 and g.tgname < 'block_archived_reported_progress') then
    raise exception '13.9B Step 2 post-check failed: a trigger fires before an archived guard.';
  end if;

  -- No PV / EV / SPI in the stream, and no use of the retired typed progress.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'project_reported_progress'
                and column_name ~ '(^|_)(spi|pv|ev|planned_value|earned_value)($|_)') then
    raise exception '13.9B Step 2 post-check failed: Reported Progress must not carry PV / EV / SPI.';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('record_reported_progress', 'reported_progress_supersede', 'guard_reported_progress_entry',
                                  'finalise_project_setup', 'project_reported_progress_heads', 'project_reported_progress_latest')
                and p.prosrc ~ '(planned_progress|actual_progress)[^_]') then
    raise exception '13.9B Step 2 post-check failed: the retired typed progress is read by the stream.';
  end if;

  -- No client write path.
  if has_table_privilege('authenticated', 'public.project_reported_progress', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.project_setup_finalisations', 'INSERT,UPDATE,DELETE')
     or has_function_privilege('authenticated', 'public.reported_progress_supersede(uuid,text,numeric,numeric,text,text)', 'EXECUTE') then
    raise exception '13.9B Step 2 post-check failed: a governance write is reachable by a client.';
  end if;

  -- The Controlled derivation reads both anchors.
  if (select prosrc from pg_catalog.pg_proc where oid = 'public.project_setup_controlled_since(uuid)'::regprocedure)
       !~ 'project_setup_finalisations' then
    raise exception '13.9B Step 2 post-check failed: Controlled does not read the Setup Finalisation.';
  end if;

  -- Scope boundary unchanged.
  if (select prosrc from pg_catalog.pg_proc where oid = 'public.can_manage_project_operations(uuid)'::regprocedure)
       ~ 'project_is_archived|project_setup' then
    raise exception '13.9B Step 2 post-check failed: can_manage_project_operations() was changed.';
  end if;
end;
$post$;

notify pgrst, 'reload schema';
