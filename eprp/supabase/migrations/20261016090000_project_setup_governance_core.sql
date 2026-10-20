-- Phase 13.9B — Project Setup Governance — Step 1: governance core.
--
-- Architecture: docs/02_PLATFORM_ARCHITECTURE.md §26.24 (decisions B11–B24 in
-- §26.19); logical model: docs/06_DATABASE_SCHEMA.md §10A.11; authority:
-- docs/05_PERMISSION_MODEL.md §3.9.
--
-- WHAT THIS ADDS
--   1. project_setup_field_registry() — the one authoritative, code-defined
--      classification of every Project Setup field (mirrored in TypeScript by
--      src/features/projects/setup-governance.ts and proved equal by a source
--      test). Not master data: nobody can edit it.
--   2. project_setup_controlled_since() / project_setup_controlled() — the
--      derived Controlled state. In Step 1 the only anchor is the first
--      Published Planning Snapshot. Step 2 adds the Setup Finalisation; 13.12
--      adds the approved BL0. Nothing is stored, nothing is backfilled, and
--      Controlled never reverts (snapshots have no delete path).
--   3. project_setup_amendments — append-only amendment requests, with
--      request / decide / withdraw functions. Lightweight amendments apply in
--      the request transaction; governed ones wait for a DIFFERENT Project
--      Control Admin or System Administrator (B12). Stale detection is
--      value-based. One pending request per (project, field).
--   4. guard_project_setup_controlled — a BEFORE UPDATE guard on projects.
--      Once Controlled, a changed lightweight / governed column is accepted
--      only if THIS transaction wrote the matching applied / approved
--      amendment (the 2C.1 transaction-binding pattern); retired columns
--      cannot change; free columns change and are logged. Old values are
--      compared with new ones, so a form that re-sends unchanged hidden
--      columns passes.
--   5. guard_onboarding_mode_setup_controlled — the same rule for
--      project_planning_settings.onboarding_mode, with the B18 transition
--      matrix (project_onboarding_transition_rule()).
--   6. project_setup_field_changes — the minimal append-only log of free
--      field changes after Controlled (no generic audit system exists yet;
--      §19's Audit Trail will absorb it).
--   7. publish_planning_snapshot() gains p_confirm_setup_control: the first
--      governance anchor needs explicit confirmation (B15). Publishing and
--      Opening Position promotion are refused while the onboarding mode is
--      no_formal_schedule (owner decision 2026-10-16). The archived refusal
--      still answers first. Everything else in the function is unchanged.
--
-- UNCHANGED, by design: every existing table, column, policy and authority
-- predicate; the Project Type correction (correct_project_structure_family(),
-- System Administrator only, its own audit — B16); the one-time
-- classification of a legacy project (NULL family) through Project Setup,
-- which is part of the Project Type path and is logged here; every structure
-- relation (Departments, Systems, Programs & Studies, the Other-project
-- structure — governed from Step 4); every setup save of a project that is
-- not Controlled. No existing row is written, repaired or normalised.
--
-- ARCHIVED (B24, 13.9 / 2C.3E pattern): both new tables carry the 2C.3E
-- guard_archived_project_setup() as their first BEFORE trigger, so a request,
-- decision or withdrawal on an archived project is refused for every role and
-- a pending request is never altered by the archive.

/* --------------------------- 1. Field registry ---------------------------- */

-- One row per field_key. kind = column: target_columns are the stored
-- columns of target_table that the key governs (changed together). kind =
-- relation: a relation whose governance is enforced elsewhere (enforced_from).
-- future_class / future_slice record the approved later state; they are NOT
-- enforced before that slice ships.
create function public.project_setup_field_registry()
returns table (
  field_key text, kind text, target_table text, target_columns text[],
  field_class text, future_class text, future_slice text, enforced_from text,
  label text, impact_code text, impact_warning text
)
language sql immutable parallel safe set search_path = '' as $registry$
  select * from (values
    -- FREE / LOGGED (direct edit; logged in project_setup_field_changes once Controlled)
    ('status', 'column', 'projects', array['status'], 'free_logged', null, null, '13.9B-1', 'Project Lifecycle Status', null, null),
    ('current_phase_id', 'column', 'projects', array['current_phase_id'], 'free_logged', null, null, '13.9B-1', 'Project Lifecycle Phase', null, null),
    ('portfolio_group_id', 'column', 'projects', array['portfolio_group_id'], 'free_logged', null, null, '13.9B-1', 'Portfolio / Reporting Group', null, null),
    ('description', 'column', 'projects', array['description'], 'free_logged', null, null, '13.9B-1', 'Description', null, null),
    ('project_manager_id', 'column', 'projects', array['project_manager_id'], 'free_logged', null, null, '13.9B-1', 'Project Manager', null, null),
    ('project_control_manager_id', 'column', 'projects', array['project_control_manager_id'], 'free_logged', null, null, '13.9B-1', 'Project Control Manager', null, null),
    ('client_representative_id', 'column', 'projects', array['client_representative_id'], 'free_logged', null, null, '13.9B-1', 'Client Representative', null, null),
    ('reporting_coordinator_id', 'column', 'projects', array['reporting_coordinator_id'], 'free_logged', null, null, '13.9B-1', 'Reporting Coordinator', null, null),
    ('project_sponsor_id', 'column', 'projects', array['project_sponsor_id'], 'free_logged', null, null, '13.9B-1', 'Project Sponsor', null, null),
    ('site', 'column', 'projects', array['site'], 'free_logged', null, null, '13.9B-1', 'Site', null, null),
    ('country', 'column', 'projects', array['country'], 'free_logged', null, null, '13.9B-1', 'Country', null, null),
    ('city', 'column', 'projects', array['city'], 'free_logged', null, null, '13.9B-1', 'City', null, null),
    ('client_contact_name', 'column', 'projects', array['client_contact_name'], 'free_logged', null, null, '13.9B-1', 'Client Contact Name', null, null),
    ('client_contact_email', 'column', 'projects', array['client_contact_email'], 'free_logged', null, null, '13.9B-1', 'Client Contact Email', null, null),
    ('client_contact_phone', 'column', 'projects', array['client_contact_phone'], 'free_logged', null, null, '13.9B-1', 'Client Contact Phone', null, null),
    ('project_logo_ref', 'column', 'projects', array['project_logo_ref'], 'free_logged', null, null, '13.9B-1', 'Project Logo', null, null),
    ('client_logo_ref', 'column', 'projects', array['client_logo_ref'], 'free_logged', null, null, '13.9B-1', 'Client Logo', null, null),
    ('report_header_title', 'column', 'projects', array['report_header_title'], 'free_logged', null, null, '13.9B-1', 'Report Header Title', null, null),
    ('report_footer_text', 'column', 'projects', array['report_footer_text'], 'free_logged', null, null, '13.9B-1', 'Report Footer Text', null, null),
    ('report_reference_prefix', 'column', 'projects', array['report_reference_prefix'], 'free_logged', null, null, '13.9B-1', 'Report Reference Prefix', null, null),
    ('default_language', 'column', 'projects', array['default_language'], 'free_logged', null, null, '13.9B-1', 'Default Language', null, null),
    ('include_qr_code', 'column', 'projects', array['include_qr_code'], 'free_logged', null, null, '13.9B-1', 'Include QR Code', null, null),
    ('include_signature_section', 'column', 'projects', array['include_signature_section'], 'free_logged', null, null, '13.9B-1', 'Include Signature Section', null, null),
    ('team', 'relation', 'project_members', array[]::text[], 'free_logged', null, null, 'own_history', 'Project Team and Responsibilities', null, null),
    ('positions', 'relation', 'organization_positions', array[]::text[], 'free_logged', null, null, 'own_history', 'Positions', null, null),
    ('contacts', 'relation', 'project_contacts', array[]::text[], 'free_logged', null, null, 'as_today', 'Contacts', null, null),
    ('sites', 'relation', 'project_sites', array[]::text[], 'free_logged', null, null, 'as_today', 'Sites', null, null),
    ('parties', 'relation', 'project_parties', array[]::text[], 'free_logged', null, null, 'as_today', 'Subcontractors and Parties', null, null),
    ('structure_display_order', 'relation', 'project_structure_nodes', array[]::text[], 'free_logged', null, null, '13.9B-4', 'Structure Display Order', null, null),
    ('structure_notes', 'relation', 'project_structure_nodes', array[]::text[], 'free_logged', null, null, '13.9B-4', 'Structure Descriptions and Notes', null, null),
    -- LIGHTWEIGHT (amendment with a mandatory reason; applied at once; no approval)
    ('name', 'column', 'projects', array['name'], 'lightweight', null, null, '13.9B-1', 'Project Name', 'DISPLAY_IDENTITY', 'Approved reports keep the name they were approved with.'),
    ('short_name', 'column', 'projects', array['short_name'], 'lightweight', null, null, '13.9B-1', 'Short Name', 'DISPLAY_IDENTITY', 'Approved reports keep the short name they were approved with.'),
    ('contract_number', 'column', 'projects', array['contract_number'], 'lightweight', null, null, '13.9B-1', 'Contract Number', 'COMMERCIAL_REFERENCE', 'Approved reports keep the contract number they were approved with.'),
    ('purchase_order_number', 'column', 'projects', array['purchase_order_number'], 'lightweight', null, null, '13.9B-1', 'PO Number', 'COMMERCIAL_REFERENCE', 'Approved reports keep the PO number they were approved with.'),
    ('actual_start_date', 'column', 'projects', array['actual_start_date'], 'lightweight', null, null, '13.9B-1', 'Actual Start', 'RECORDED_DATE', 'Approved reports keep the actual start they were approved with.'),
    ('actual_finish_date', 'column', 'projects', array['actual_finish_date'], 'lightweight', null, null, '13.9B-1', 'Actual Finish', 'RECORDED_DATE', 'Approved reports keep the actual finish they were approved with.'),
    -- GOVERNED (request with reason; applied only on approval by a different Project Control Admin or System Administrator)
    ('code', 'column', 'projects', array['code'], 'governed', null, null, '13.9B-1', 'Project Code', 'REPORT_IDENTITY', 'Approved reports keep the old code. Report references issued from now on use the new code.'),
    ('client_id', 'column', 'projects', array['client_id'], 'governed', null, null, '13.9B-1', 'Client / Owner', 'REPORT_IDENTITY', 'Approved reports keep the client they were approved with.'),
    ('project_category', 'column', 'projects', array['project_type_id', 'project_category_detail'], 'governed', null, null, '13.9B-1', 'Project Category / Classification', 'CLASSIFICATION', 'Changes how the project is grouped and filtered. Approved reports keep their recorded classification.'),
    ('onboarding_mode', 'column', 'project_planning_settings', array['onboarding_mode'], 'governed', null, null, '13.9B-1', 'Planning Onboarding Mode', 'PLANNING_GOVERNANCE', 'Changes how this project is planned. Published snapshots, Opening Positions and reported progress stay as recorded history.'),
    ('weekly_enabled', 'column', 'projects', array['weekly_enabled'], 'governed', null, null, '13.9B-1', 'Weekly Reporting', 'REPORTING_FREQUENCY', 'Applies from the next unopened period; existing periods and reports are unchanged.'),
    ('monthly_enabled', 'column', 'projects', array['monthly_enabled'], 'governed', null, null, '13.9B-1', 'Monthly Reporting', 'REPORTING_FREQUENCY', 'Applies from the next unopened period; existing periods and reports are unchanged.'),
    ('executive_enabled', 'column', 'projects', array['executive_enabled'], 'governed', null, null, '13.9B-1', 'Executive Reporting', 'REPORTING_FREQUENCY', 'Applies from the next unopened period; existing periods and reports are unchanged.'),
    ('weekly_reporting_day', 'column', 'projects', array['weekly_reporting_day'], 'governed', null, null, '13.9B-1', 'Weekly Reporting Day', 'REPORTING_PERIOD', 'Applies from the next unopened period; existing periods are unchanged.'),
    ('monthly_cutoff_day', 'column', 'projects', array['monthly_cutoff_day'], 'governed', null, null, '13.9B-1', 'Reporting Cut-off', 'REPORTING_PERIOD', 'Applies from the next unopened period; existing periods are unchanged.'),
    ('working_week', 'column', 'projects', array['working_week'], 'governed', null, null, '13.9B-1', 'Working Week', 'REPORTING_PERIOD', 'Applies from the next unopened period; existing periods are unchanged.'),
    ('time_zone', 'column', 'projects', array['time_zone'], 'governed', null, null, '13.9B-1', 'Time Zone', 'REPORTING_PERIOD', 'Applies from the next unopened period; existing periods and recorded dates are unchanged.'),
    ('currency', 'column', 'projects', array['currency'], 'governed', null, null, '13.9B-1', 'Currency', 'COMMERCIAL_INTERPRETATION', 'Recorded amounts are not converted. Approved reports keep the currency they were approved with.'),
    ('milestone_update_approval', 'column', 'projects', array['milestone_update_approval'], 'governed', null, null, '13.9B-1', 'Milestone Update Approval', 'APPROVAL_POLICY', 'Applies to milestone updates submitted from now on; decided updates are unchanged.'),
    ('contract_start_date', 'column', 'projects', array['contract_start_date'], 'governed', null, null, '13.9B-1', 'Contract Start', 'CONTRACTUAL_DATE', 'Approved reports keep the contract start they were approved with.'),
    ('forecast_finish_date', 'column', 'projects', array['forecast_finish_date'], 'governed', 'planning_owned', '13.14', '13.9B-1', 'Forecast Finish', 'SCHEDULE_REFERENCE', 'Approved reports keep the forecast they were approved with. Published Planning Snapshots are unchanged.'),
    ('planned_start_date', 'column', 'projects', array['planned_start_date'], 'governed', 'superseded', '13.12', '13.9B-1', 'Planned Start', 'SCHEDULE_REFERENCE', 'Approved reports and Published Planning Snapshots keep their recorded dates.'),
    ('planned_finish_date', 'column', 'projects', array['planned_finish_date'], 'governed', 'superseded', '13.12', '13.9B-1', 'Planned Finish', 'SCHEDULE_REFERENCE', 'Approved reports and Published Planning Snapshots keep their recorded dates.'),
    ('structure_departments', 'relation', 'project_departments', array[]::text[], 'governed', null, null, '13.9B-4', 'Departments and their scope', 'STRUCTURE_SCOPE', 'Changes the reporting structure. Approved reports keep the structure they were approved with.'),
    ('structure_disciplines', 'relation', 'project_disciplines', array[]::text[], 'governed', null, null, '13.9B-4', 'Systems and Programs & Studies', 'STRUCTURE_SCOPE', 'Changes the reporting structure. Approved reports keep the structure they were approved with.'),
    ('structure_levels', 'relation', 'project_structure_levels', array[]::text[], 'governed', null, null, '13.9B-4', 'Structure Levels (add, remove, rename)', 'STRUCTURE_SCOPE', 'Changes the reporting structure. Approved reports keep the structure they were approved with.'),
    ('structure_units', 'relation', 'project_structure_nodes', array[]::text[], 'governed', null, null, '13.9B-4', 'Structure Units (add, remove, archive, re-parent, rename, reporting scope)', 'STRUCTURE_SCOPE', 'Changes the reporting structure. Approved reports keep the structure they were approved with.'),
    -- SYSTEM ADMINISTRATOR CORRECTION (the existing 2C.1 path only, B16)
    ('structure_family', 'column', 'projects', array['structure_family'], 'system_admin_correction', null, null, '2C.1', 'Project Type', null, null),
    -- RETIRED (no change after Controlled; an unchanged value passes)
    ('priority', 'column', 'projects', array['priority'], 'retired', null, null, '13.9B-1', 'Priority', null, null),
    ('overall_status', 'column', 'projects', array['overall_status'], 'retired', null, null, '13.9B-1', 'Overall Status', null, null),
    ('planned_progress', 'column', 'projects', array['planned_progress'], 'retired', null, null, '13.9B-1', 'Typed Planned Progress', null, null),
    ('actual_progress', 'column', 'projects', array['actual_progress'], 'retired', null, null, '13.9B-1', 'Typed Actual Progress', null, null)
  ) as registry(field_key, kind, target_table, target_columns, field_class, future_class, future_slice,
                enforced_from, label, impact_code, impact_warning)
$registry$;

comment on function public.project_setup_field_registry() is
  '13.9B. The authoritative Project Setup field-governance registry (docs/02 §26.24.2, §26.24.2a). Classes: free_logged, lightweight, governed, system_admin_correction, superseded, planning_owned, retired. future_class / future_slice are recorded, not enforced, until that slice ships. Mirrored in src/features/projects/setup-governance.ts (source parity test).';

-- Columns of projects that the registry deliberately leaves out.
create function public.project_setup_system_columns()
returns text[] language sql immutable parallel safe set search_path = '' as $fn$
  select array['id', 'active', 'archived_at', 'created_at', 'updated_at']::text[];
$fn$;

/* ------------------------ 2. Controlled derivation ------------------------ */

-- The earliest immutable governance anchor, or NULL. Step 1: the first
-- Published Planning Snapshot (a promoted Opening Position is one). Step 2
-- adds the Setup Finalisation; 13.12 adds the approved BL0.
create function public.project_setup_controlled_since(p_project uuid)
returns timestamptz language sql stable security definer set search_path = '' as $fn$
  select min(s.published_at) from public.planning_snapshots s where s.project_id = p_project;
$fn$;

create function public.project_setup_controlled(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.project_setup_controlled_since(p_project) is not null;
$fn$;

comment on function public.project_setup_controlled_since(uuid) is
  '13.9B. Derived, never stored: the earliest governance anchor. Step 1 anchor = first Published Planning Snapshot. Step 2 adds the Setup Finalisation; 13.12 the approved BL0.';

create function public.project_has_published_snapshot(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.planning_snapshots s where s.project_id = p_project);
$fn$;

-- B18. 'unchanged' | 'free' | 'governed' | 'prohibited'.
create function public.project_onboarding_transition_rule(p_project uuid, p_from text, p_to text)
returns text language sql stable security definer set search_path = '' as $fn$
  select case
    when p_from is not distinct from p_to then 'unchanged'
    when not public.project_setup_controlled(p_project) then 'free'
    when public.project_has_published_snapshot(p_project) then
      case when p_from = 'no_formal_schedule' then 'governed' else 'prohibited' end
    else 'governed'
  end;
$fn$;

comment on function public.project_onboarding_transition_rule(uuid, text, text) is
  '13.9B / B18. Not Controlled: free. Controlled with a Published Snapshot: no_formal_schedule -> planned is governed; planned -> no_formal_schedule and new_project <-> existing_active_project are prohibited. Controlled without a snapshot: governed.';

/* ----------------------- 3. Value helpers (internal) ---------------------- */

create function public.project_setup_registry_entry(p_field_key text)
returns table (kind text, target_table text, target_columns text[], field_class text, label text,
               impact_code text, impact_warning text)
language sql immutable set search_path = '' as $fn$
  select r.kind, r.target_table, r.target_columns, r.field_class, r.label, r.impact_code, r.impact_warning
    from public.project_setup_field_registry() r where r.field_key = p_field_key;
$fn$;

-- The listed keys of a row image, nulls kept as JSON null.
create function public.project_setup_pick(p_row jsonb, p_columns text[])
returns jsonb language sql immutable set search_path = '' as $fn$
  select coalesce(pg_catalog.jsonb_object_agg(c, coalesce(p_row -> c, 'null'::jsonb)), '{}'::jsonb)
    from pg_catalog.unnest(p_columns) c;
$fn$;

-- The authoritative current value of a column key, as {column: value}.
create function public.project_setup_field_value(p_project uuid, p_field_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_entry record;
  v_row jsonb;
begin
  select * into v_entry from public.project_setup_registry_entry(p_field_key);
  if v_entry.kind is distinct from 'column' then
    raise exception 'project_setup_field_value(): % is not a column key', p_field_key using errcode = '22023';
  end if;
  if v_entry.target_table = 'projects' then
    select to_jsonb(p) into v_row from public.projects p where p.id = p_project;
  else
    v_row := jsonb_build_object('onboarding_mode',
      coalesce((select s.onboarding_mode from public.project_planning_settings s where s.project_id = p_project),
               'new_project'));
  end if;
  return public.project_setup_pick(v_row, v_entry.target_columns);
end;
$fn$;

-- A caller-supplied value, in the stored (canonical) form: exactly the key's
-- columns, cast through the table's own row type.
create function public.project_setup_canonical_value(p_field_key text, p_value jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_entry record;
  v_keys text[];
  v_row jsonb;
  v_column text;
begin
  select * into v_entry from public.project_setup_registry_entry(p_field_key);
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception '[INVALID_VALUE] The value for % is not valid.', v_entry.label using errcode = '22023';
  end if;
  select coalesce(array_agg(k order by k), array[]::text[]) into v_keys from jsonb_object_keys(p_value) k;
  if v_keys is distinct from (select array_agg(c order by c) from unnest(v_entry.target_columns) c) then
    raise exception '[INVALID_VALUE] The value for % is not valid.', v_entry.label using errcode = '22023';
  end if;
  begin
    if v_entry.target_table = 'projects' then
      select to_jsonb(r) into v_row from jsonb_populate_record(null::public.projects, p_value) r;
    else
      select to_jsonb(r) into v_row from jsonb_populate_record(null::public.project_planning_settings, p_value) r;
    end if;
  exception when others then
    raise exception '[INVALID_VALUE] The value for % is not valid.', v_entry.label using errcode = '22023';
  end;
  -- A required column cannot be blanked.
  foreach v_column in array v_entry.target_columns loop
    if v_row -> v_column = 'null'::jsonb and exists (
      select 1 from pg_catalog.pg_attribute a
       where a.attrelid = ('public.' || v_entry.target_table)::regclass
         and a.attname = v_column and a.attnotnull) then
      raise exception '[INVALID_VALUE] % cannot be blank.', v_entry.label using errcode = '22023';
    end if;
  end loop;
  return public.project_setup_pick(v_row, v_entry.target_columns);
end;
$fn$;

/* --------------------------- 4. Amendment table --------------------------- */

create table public.project_setup_amendments (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  field_key              text not null,
  amendment_class        text not null,
  previous_value         jsonb not null,
  proposed_value         jsonb not null,
  reason                 text not null,
  impact_code            text,
  impact_warning         text not null,
  requested_by           uuid not null,
  requested_by_name      text,
  requested_at           timestamptz not null default now(),
  request_transaction_id xid8 not null default pg_catalog.pg_current_xact_id(),
  status                 text not null,
  decided_by             uuid,
  decided_by_name        text,
  decided_at             timestamptz,
  decision_comment       text,
  applied_transaction_id xid8,
  source                 text not null default 'project_setup',
  constraint project_setup_amendments_class_valid check (amendment_class in ('lightweight', 'governed')),
  constraint project_setup_amendments_status_valid
    check (status in ('applied', 'pending', 'approved', 'rejected', 'withdrawn', 'stale')),
  constraint project_setup_amendments_class_status check (
    (amendment_class = 'lightweight' and status = 'applied')
    or (amendment_class = 'governed' and status in ('pending', 'approved', 'rejected', 'withdrawn', 'stale'))),
  constraint project_setup_amendments_reason_present check (btrim(reason) <> ''),
  constraint project_setup_amendments_values_objects
    check (jsonb_typeof(previous_value) = 'object' and jsonb_typeof(proposed_value) = 'object'),
  constraint project_setup_amendments_value_changes check (proposed_value <> previous_value),
  constraint project_setup_amendments_decision_shape check (
    case status
      when 'applied'   then decided_by is null and decided_at is null and applied_transaction_id is not null
      when 'pending'   then decided_by is null and decided_at is null and applied_transaction_id is null
      when 'approved'  then decided_by is not null and decided_at is not null and applied_transaction_id is not null
      when 'rejected'  then decided_by is not null and decided_at is not null and applied_transaction_id is null
      when 'withdrawn' then decided_by is not null and decided_at is not null and applied_transaction_id is null
      when 'stale'     then decided_by is null and decided_at is not null and applied_transaction_id is null
    end),
  -- B12: nobody decides their own request, whatever their role.
  constraint project_setup_amendments_no_self_decision
    check (status not in ('approved', 'rejected') or decided_by <> requested_by),
  constraint project_setup_amendments_reject_comment
    check (status <> 'rejected' or btrim(coalesce(decision_comment, '')) <> ''),
  constraint project_setup_amendments_source_valid check (source in ('project_setup'))
);

create unique index project_setup_amendments_one_pending
  on public.project_setup_amendments (project_id, field_key) where status = 'pending';
create index project_setup_amendments_project_time
  on public.project_setup_amendments (project_id, requested_at desc);
create index project_setup_amendments_applied_tx
  on public.project_setup_amendments (project_id, field_key, applied_transaction_id)
  where applied_transaction_id is not null;

comment on table public.project_setup_amendments is
  '13.9B. Append-only Project Setup amendment requests (docs/06 §10A.11.3). Written only by request_ / decide_ / withdraw_project_setup_amendment(). The only UPDATE is the single pending -> approved | rejected | withdrawn | stale transition. Never deleted. A pending request on an archived project stays pending and undecidable (B24); "Frozen - project archived" is derived, never stored.';

/* --------------------------- 5. Field-change log -------------------------- */

create table public.project_setup_field_changes (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  field_key       text not null,
  previous_value  jsonb not null,
  new_value       jsonb not null,
  change_source   text not null default 'direct_edit',
  changed_by      uuid,
  changed_by_name text,
  changed_at      timestamptz not null default now(),
  transaction_id  xid8 not null default pg_catalog.pg_current_xact_id(),
  constraint project_setup_field_changes_source_valid
    check (change_source in ('direct_edit', 'project_type_classification')),
  constraint project_setup_field_changes_value_changes check (new_value <> previous_value)
);

create index project_setup_field_changes_project_time
  on public.project_setup_field_changes (project_id, changed_at desc);

comment on table public.project_setup_field_changes is
  '13.9B. Minimal append-only log of FREE / LOGGED Project Setup changes after Controlled, plus the one-time classification of a legacy project (docs/06 §10A.11.8). Written only by the projects guard trigger. Designed to be absorbed by the platform Audit Trail (docs/02 §19).';

/* ------------------- 6. History guards on the new tables ------------------ */

create function public.guard_project_setup_governance_history()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_decision_columns constant text[] := array[
    'status', 'decided_by', 'decided_by_name', 'decided_at', 'decision_comment', 'applied_transaction_id'];
begin
  if tg_op = 'DELETE' then
    -- Only the project's own ON DELETE CASCADE removes rows: by then the
    -- project row is gone (projects are archived, not deleted).
    if exists (select 1 from public.projects p where p.id = old.project_id) then
      raise exception '[SETUP_HISTORY_IMMUTABLE] Project Setup governance history cannot be deleted.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_table_name = 'project_setup_amendments' then
    if old.status <> 'pending'
       or new.status not in ('approved', 'rejected', 'withdrawn', 'stale')
       or (to_jsonb(old) - v_decision_columns) <> (to_jsonb(new) - v_decision_columns) then
      raise exception '[SETUP_HISTORY_IMMUTABLE] An amendment request is decided once and never edited.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception '[SETUP_HISTORY_IMMUTABLE] Project Setup governance history cannot be edited.'
    using errcode = '42501';
end;
$fn$;

-- The 2C.3E archived guard answers first ("block_" < "guard_"). It is named
-- separately from the eight block_archived_project_setup triggers, whose count
-- earlier suites pin.
create trigger block_archived_setup_governance
  before insert or update or delete on public.project_setup_amendments
  for each row execute function public.guard_archived_project_setup();
create trigger guard_setup_governance_history
  before update or delete on public.project_setup_amendments
  for each row execute function public.guard_project_setup_governance_history();

create trigger block_archived_setup_governance
  before insert or update or delete on public.project_setup_field_changes
  for each row execute function public.guard_archived_project_setup();
create trigger guard_setup_governance_history
  before update or delete on public.project_setup_field_changes
  for each row execute function public.guard_project_setup_governance_history();

/* ------------------------ 7. RLS and table grants ------------------------- */

alter table public.project_setup_amendments enable row level security;
alter table public.project_setup_field_changes enable row level security;

create policy project_setup_amendments_select on public.project_setup_amendments
  for select to authenticated using (public.can_access_project(project_id));
create policy project_setup_field_changes_select on public.project_setup_field_changes
  for select to authenticated using (public.can_access_project(project_id));

-- Reads only. Every write goes through the functions below (or, for the log,
-- the projects trigger). No direct write grant for any client role.
revoke all on public.project_setup_amendments from public, anon, authenticated, service_role;
revoke all on public.project_setup_field_changes from public, anon, authenticated, service_role;
grant select on public.project_setup_amendments to authenticated, service_role;
grant select on public.project_setup_field_changes to authenticated, service_role;

/* ------------------------ 8. Apply a value (internal) ---------------------- */

-- Writes a column key's canonical value. Called only by the amendment
-- functions, AFTER the authorising amendment row exists in this transaction;
-- the guards below re-check that binding independently.
create function public.project_setup_apply_value(p_project uuid, p_field_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  v_entry record;
  v_assignments text;
  v_count integer;
begin
  select * into v_entry from public.project_setup_registry_entry(p_field_key);
  if v_entry.target_table = 'projects' then
    select string_agg(format('%I = incoming.%I', c, c), ', ' order by c)
      into v_assignments from unnest(v_entry.target_columns) c;
    execute format('update public.projects p set %s from jsonb_populate_record(null::public.projects, $1) incoming where p.id = $2',
                   v_assignments)
      using p_value, p_project;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'Project not found.' using errcode = 'P0002';
    end if;
  elsif v_entry.target_table = 'project_planning_settings' then
    -- Update first, insert only when the row is missing (never an upsert, so
    -- the guard always judges the real previous value).
    update public.project_planning_settings set onboarding_mode = p_value ->> 'onboarding_mode'
     where project_id = p_project;
    if not found then
      insert into public.project_planning_settings (project_id, onboarding_mode)
      values (p_project, p_value ->> 'onboarding_mode');
    end if;
  else
    raise exception 'project_setup_apply_value(): % is not applicable', p_field_key using errcode = '22023';
  end if;
end;
$fn$;

/* ---------------------------- 9. The guards ------------------------------- */

-- Whether this transaction wrote the amendment that authorises exactly this
-- value for this field.
create function public.project_setup_amendment_authorises(
  p_project uuid, p_field_key text, p_status text, p_value jsonb
) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.project_setup_amendments a
     where a.project_id = p_project
       and a.field_key = p_field_key
       and a.status = p_status
       and a.applied_transaction_id = pg_catalog.pg_current_xact_id()
       and a.proposed_value = p_value);
$fn$;

create function public.guard_project_setup_controlled()
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
  v_legacy_classification boolean;
begin
  if not public.project_setup_controlled(old.id) then
    return new;  -- before Controlled every field behaves exactly as today
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  select p.full_name into v_actor_name from public.profiles p where p.id = v_actor;

  -- The Project Type path (B16, 2C.1): the System Administrator correction
  -- wrote its audit row in this transaction (enforce_project_classification()
  -- has already verified it), or a legacy project receives its one-time
  -- family. Either way the classification travels with it.
  v_sa_correction := exists (
    select 1 from public.project_classification_corrections c
     where c.project_id = new.id
       and c.transaction_id = pg_catalog.pg_current_xact_id()
       and c.new_family is not distinct from new.structure_family
       and c.new_project_type_id is not distinct from new.project_type_id
       and c.new_category_detail is not distinct from new.project_category_detail);
  v_legacy_classification := old.structure_family is null and new.structure_family is not null;

  for v_entry in
    select r.field_key, r.target_columns, r.field_class, r.label
      from public.project_setup_field_registry() r
     where r.kind = 'column' and r.target_table = 'projects'
  loop
    v_old_value := public.project_setup_pick(v_old, v_entry.target_columns);
    v_new_value := public.project_setup_pick(v_new, v_entry.target_columns);
    continue when v_old_value = v_new_value;

    if v_entry.field_key in ('structure_family', 'project_category')
       and (v_sa_correction or v_legacy_classification) then
      if v_legacy_classification and not v_sa_correction then
        insert into public.project_setup_field_changes
          (project_id, field_key, previous_value, new_value, change_source, changed_by, changed_by_name)
        values (new.id, v_entry.field_key, v_old_value, v_new_value, 'project_type_classification',
                v_actor, v_actor_name);
      end if;
      continue;  -- the SA correction keeps its own audit row (not duplicated)
    end if;

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
        null;  -- enforce_project_classification() is authoritative for the family
      else
        raise exception '[SETUP_CONTROLLED] % cannot be changed here.', v_entry.label using errcode = '42501';
    end case;
  end loop;

  return new;
end;
$fn$;

-- Fires after enforce_project_classification and guard_fixed_holder_replacement,
-- before set_updated_at; block_archived_project_setup still answers first.
create trigger guard_project_setup_controlled
  before update on public.projects
  for each row execute function public.guard_project_setup_controlled();

create function public.guard_onboarding_mode_setup_controlled()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_project uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  v_from text;
  v_to text := case when tg_op = 'DELETE' then 'new_project' else new.onboarding_mode end;
  v_rule text;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'A planning settings row cannot move between projects.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    -- BEFORE INSERT fires before ON CONFLICT is resolved, so an upsert of an
    -- existing row is judged against that row; a missing row reads as the
    -- column default.
    v_from := coalesce((select s.onboarding_mode from public.project_planning_settings s
                         where s.project_id = new.project_id), 'new_project');
  else
    v_from := old.onboarding_mode;
  end if;
  v_rule := public.project_onboarding_transition_rule(v_project, v_from, v_to);
  if v_rule = 'prohibited' then
    raise exception '[ONBOARDING_TRANSITION_PROHIBITED] This project already has a Published Planning Snapshot, so its planning mode cannot change from % to %.',
      v_from, v_to using errcode = '42501';
  end if;
  if v_rule = 'governed' and not public.project_setup_amendment_authorises(
       v_project, 'onboarding_mode', 'approved', jsonb_build_object('onboarding_mode', v_to)) then
    raise exception '[SETUP_CONTROLLED] Planning Onboarding Mode is controlled once Project Setup is controlled. Request an amendment; another Project Control Admin or System Administrator must approve it.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

create trigger guard_onboarding_mode_setup_controlled
  before insert or update or delete on public.project_planning_settings
  for each row execute function public.guard_onboarding_mode_setup_controlled();

/* ------------------------ 10. Amendment functions ------------------------- */

create function public.request_project_setup_amendment(
  p_project uuid,
  p_field_key text,
  p_expected_value jsonb,
  p_proposed_value jsonb,
  p_reason text
) returns public.project_setup_amendments
language plpgsql security definer set search_path = '' as $fn$
declare
  v_entry record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_current jsonb;
  v_expected jsonb;
  v_proposed jsonb;
  v_row public.project_setup_amendments;
begin
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_setup(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] Project Setup authority on this project is required to amend it.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'P0002';
  end if;

  select * into v_entry from public.project_setup_registry_entry(p_field_key);
  if v_entry.field_class is null then
    raise exception '[FIELD_NOT_AMENDABLE] This field is not part of Project Setup governance.' using errcode = '22023';
  end if;
  if v_entry.kind <> 'column' then
    raise exception '[FIELD_NOT_AMENDABLE] % cannot be amended yet.', v_entry.label using errcode = '22023';
  end if;
  case v_entry.field_class
    when 'lightweight', 'governed' then null;
    when 'free_logged' then
      raise exception '[FIELD_NOT_AMENDABLE] % is edited directly; it needs no amendment.', v_entry.label using errcode = '22023';
    when 'retired' then
      raise exception '[SETUP_FIELD_RETIRED] % is retired and can no longer be changed.', v_entry.label using errcode = '42501';
    when 'system_admin_correction' then
      raise exception '[FIELD_NOT_AMENDABLE] % is changed only through the System Administrator correction.', v_entry.label using errcode = '22023';
    else
      raise exception '[FIELD_NOT_AMENDABLE] % cannot be amended.', v_entry.label using errcode = '22023';
  end case;
  if v_reason is null then
    raise exception '[REASON_REQUIRED] A reason is required to amend %.', v_entry.label using errcode = '22023';
  end if;

  -- Same lock order as every other setup writer: advisory lock, then rows.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if public.can_manage_project_setup(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] Project Setup authority on this project is required to amend it.'
      using errcode = '42501';
  end if;
  perform 1 from public.projects where id = p_project for update;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its setup is read-only.' using errcode = '42501';
  end if;
  if not public.project_setup_controlled(p_project) then
    raise exception '[SETUP_NOT_CONTROLLED] Project Setup is not controlled yet. Edit % directly.', v_entry.label
      using errcode = '22023';
  end if;

  v_current := public.project_setup_field_value(p_project, p_field_key);
  v_expected := public.project_setup_canonical_value(p_field_key, p_expected_value);
  if v_expected <> v_current then
    raise exception '[STALE_BASE] % changed since this page loaded. Reload before amending.', v_entry.label
      using errcode = 'PT409';
  end if;
  v_proposed := public.project_setup_canonical_value(p_field_key, p_proposed_value);
  if v_proposed = v_current then
    raise exception '[NO_CHANGE] The new value of % is the same as the current one.', v_entry.label
      using errcode = '22023';
  end if;
  if p_field_key = 'onboarding_mode' and public.project_onboarding_transition_rule(
       p_project, v_current ->> 'onboarding_mode', v_proposed ->> 'onboarding_mode') = 'prohibited' then
    raise exception '[ONBOARDING_TRANSITION_PROHIBITED] This project already has a Published Planning Snapshot, so its planning mode cannot change from % to %.',
      v_current ->> 'onboarding_mode', v_proposed ->> 'onboarding_mode' using errcode = '42501';
  end if;
  if v_entry.field_class = 'governed' and exists (
    select 1 from public.project_setup_amendments a
     where a.project_id = p_project and a.field_key = p_field_key and a.status = 'pending') then
    raise exception '[AMENDMENT_PENDING] % already has a request awaiting approval.', v_entry.label
      using errcode = 'PT409';
  end if;

  insert into public.project_setup_amendments (
    project_id, field_key, amendment_class, previous_value, proposed_value, reason,
    impact_code, impact_warning, requested_by, requested_by_name, status, applied_transaction_id
  ) values (
    p_project, p_field_key, v_entry.field_class, v_current, v_proposed, v_reason,
    v_entry.impact_code, v_entry.impact_warning, auth.uid(),
    (select full_name from public.profiles where id = auth.uid()),
    case v_entry.field_class when 'lightweight' then 'applied' else 'pending' end,
    case v_entry.field_class when 'lightweight' then pg_catalog.pg_current_xact_id() end
  ) returning * into v_row;

  if v_entry.field_class = 'lightweight' then
    perform public.project_setup_apply_value(p_project, p_field_key, v_proposed);
  end if;
  return v_row;
end;
$fn$;

create function public.decide_project_setup_amendment(
  p_amendment uuid,
  p_decision text,
  p_comment text default null
) returns public.project_setup_amendments
language plpgsql security definer set search_path = '' as $fn$
declare
  v_row public.project_setup_amendments;
  v_label text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_current jsonb;
begin
  if auth.uid() is null or public.current_user_role() is null then
    raise exception '[NOT_AUTHORIZED] Sign in to decide an amendment request.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception '[INVALID_DECISION] A decision is approve or reject.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  select * into v_row from public.project_setup_amendments where id = p_amendment for update;
  if not found then
    raise exception '[NOT_FOUND] Amendment request not found.' using errcode = 'P0002';
  end if;
  select label into v_label from public.project_setup_registry_entry(v_row.field_key);

  -- B24: an archived project's pending request is frozen, never altered.
  if public.project_is_archived(v_row.project_id) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its setup is read-only.' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception '[AMENDMENT_NOT_PENDING] This request was already %.', v_row.status using errcode = 'PT409';
  end if;
  -- B12: never the requester, whatever their role. No break-glass.
  if v_row.requested_by = auth.uid() then
    raise exception '[SELF_APPROVAL] You cannot decide your own amendment request. Another Project Control Admin or System Administrator must decide it.'
      using errcode = '42501';
  end if;
  if public.has_global_operational_authority() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a Project Control Admin or System Administrator can decide an amendment request.'
      using errcode = '42501';
  end if;

  if p_decision = 'reject' then
    if v_comment is null then
      raise exception '[DECISION_COMMENT_REQUIRED] A comment is required to reject a request.' using errcode = '22023';
    end if;
    update public.project_setup_amendments
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = v_comment,
           decided_by_name = (select full_name from public.profiles where id = auth.uid())
     where id = p_amendment returning * into v_row;
    return v_row;
  end if;

  perform 1 from public.projects where id = v_row.project_id for update;
  v_current := public.project_setup_field_value(v_row.project_id, v_row.field_key);
  if v_current <> v_row.previous_value then
    -- Value-based stale detection: record it, apply nothing, commit.
    update public.project_setup_amendments
       set status = 'stale', decided_at = now(),
           decision_comment = 'The value changed after this request; nothing was applied.'
     where id = p_amendment returning * into v_row;
    return v_row;
  end if;
  if v_row.field_key = 'onboarding_mode' and public.project_onboarding_transition_rule(
       v_row.project_id, v_current ->> 'onboarding_mode', v_row.proposed_value ->> 'onboarding_mode') = 'prohibited' then
    raise exception '[ONBOARDING_TRANSITION_PROHIBITED] This project now has a Published Planning Snapshot, so its planning mode cannot change from % to %. Reject this request.',
      v_current ->> 'onboarding_mode', v_row.proposed_value ->> 'onboarding_mode' using errcode = '42501';
  end if;

  update public.project_setup_amendments
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = v_comment,
         decided_by_name = (select full_name from public.profiles where id = auth.uid()),
         applied_transaction_id = pg_catalog.pg_current_xact_id()
   where id = p_amendment returning * into v_row;
  perform public.project_setup_apply_value(v_row.project_id, v_row.field_key, v_row.proposed_value);
  return v_row;
end;
$fn$;

create function public.withdraw_project_setup_amendment(
  p_amendment uuid,
  p_comment text default null
) returns public.project_setup_amendments
language plpgsql security definer set search_path = '' as $fn$
declare
  v_row public.project_setup_amendments;
begin
  if auth.uid() is null or public.current_user_role() is null then
    raise exception '[NOT_AUTHORIZED] Sign in to withdraw an amendment request.' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  select * into v_row from public.project_setup_amendments where id = p_amendment for update;
  if not found then
    raise exception '[NOT_FOUND] Amendment request not found.' using errcode = 'P0002';
  end if;
  if public.project_is_archived(v_row.project_id) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its setup is read-only.' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception '[AMENDMENT_NOT_PENDING] This request was already %.', v_row.status using errcode = 'PT409';
  end if;
  if v_row.requested_by <> auth.uid() and public.has_global_operational_authority() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only the requester, a Project Control Admin or a System Administrator can withdraw this request.'
      using errcode = '42501';
  end if;
  update public.project_setup_amendments
     set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(),
         decided_by_name = (select full_name from public.profiles where id = auth.uid()),
         decision_comment = nullif(btrim(coalesce(p_comment, '')), '')
   where id = p_amendment returning * into v_row;
  return v_row;
end;
$fn$;

comment on function public.request_project_setup_amendment(uuid, text, jsonb, jsonb, text) is
  '13.9B. Setup managers (can_manage_project_setup) request an amendment of a lightweight or governed field of a Controlled project. Lightweight: applied in this transaction. Governed: pending. p_expected_value is the value the caller saw ({column: value}); PT409 if it is no longer current.';
comment on function public.decide_project_setup_amendment(uuid, text, text) is
  '13.9B / B12. A Project Control Admin or System Administrator OTHER than the requester approves or rejects a pending request. Approve re-checks the value: changed -> stale, nothing applied. Archived project -> refused, request untouched (B24).';
comment on function public.withdraw_project_setup_amendment(uuid, text) is
  '13.9B. The requester, a Project Control Admin or a System Administrator withdraws a pending request. Archived project -> refused (B24).';

/* ------------------ 11. Publish: confirmation and no-formal ---------------- */

-- The 7-argument function is replaced by the same function with one more
-- defaulted argument. Callers that do not pass it keep working once the
-- project is Controlled; the FIRST publish must pass true.
drop function public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid, date);

create function public.publish_planning_snapshot(
  p_project_id uuid,
  p_import_batch_id uuid default null,
  p_baseline_id uuid default null,
  p_is_opening_snapshot boolean default false,
  p_label text default null,
  p_opening_position_id uuid default null,
  p_data_date date default null,
  p_confirm_setup_control boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_batch_project uuid;
  v_batch_status text;
  v_batch_data_date date;
  v_baseline_project uuid;
  v_position_project uuid;
  v_position_status text;
  v_position_data_date date;
  v_position_planned numeric(6, 3);
  v_position_actual numeric(6, 3);
  v_position_forecast date;
  v_position_source text;
  v_onboarding_mode text;
  v_version integer;
  v_snapshot_data jsonb;
  v_is_opening boolean;
  v_data_date date;
  v_snapshot_id uuid;
begin
  if not public.can_manage_project_operations(p_project_id) then
    raise exception
      'Publishing a Planning Snapshot requires Project Control authority on this project.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_import_batch_id is not null and p_opening_position_id is not null then
    raise exception
      'A Planning Snapshot can be published from an import batch or an Opening Position, never both.'
      using errcode = 'check_violation';
  end if;

  if p_data_date is not null and (p_import_batch_id is not null or p_opening_position_id is not null) then
    raise exception
      'A Data Date is taken from the import batch or Opening Position being published — provide one explicitly only when publishing manually, with neither.'
      using errcode = 'check_violation';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text, 0)
  );

  -- 13.9B. Serialise with every Project Setup writer (the onboarding mode and
  -- the Controlled state must not move under this publish), then: archived
  -- answers first; no publish or promotion in no_formal_schedule mode; the
  -- first governance anchor needs explicit confirmation.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if public.project_is_archived(p_project_id) then
    raise exception
      '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;
  if coalesce((select s.onboarding_mode from public.project_planning_settings s
                where s.project_id = p_project_id), 'new_project') = 'no_formal_schedule' then
    raise exception
      '[NO_FORMAL_SCHEDULE] This project is planned without a formal schedule. Change how it is planned before publishing a Planning Snapshot or promoting an Opening Position.'
      using errcode = 'check_violation';
  end if;
  if not public.project_setup_controlled(p_project_id)
     and coalesce(p_confirm_setup_control, false) is distinct from true then
    raise exception
      '[SETUP_CONTROL_CONFIRMATION_REQUIRED] Publishing the first Planning Snapshot makes Project Setup controlled. Confirm this to publish.'
      using errcode = '22023';
  end if;

  if p_import_batch_id is not null then
    select project_id, status, data_date into v_batch_project, v_batch_status, v_batch_data_date
      from public.planning_import_batches
     where id = p_import_batch_id
       for update;

    if v_batch_project is null then
      raise exception 'Planning import batch % not found.', p_import_batch_id
        using errcode = 'foreign_key_violation';
    end if;
    if v_batch_project <> p_project_id then
      raise exception
        'This import batch belongs to a different project.'
        using errcode = 'foreign_key_violation';
    end if;
    if v_batch_status = 'published' then
      raise exception
        'This import batch has already been published. Import a new batch to publish again.'
        using errcode = 'restrict_violation';
    end if;
    if v_batch_data_date is null then
      raise exception
        'This import batch has no Data Date. Enter the schedule''s Data Date (detected from the file, or entered by hand) before publishing.'
        using errcode = 'check_violation';
    end if;
  end if;

  if p_baseline_id is not null then
    select project_id into v_baseline_project
      from public.planning_baselines
     where id = p_baseline_id;

    if v_baseline_project is null or v_baseline_project <> p_project_id then
      raise exception
        'This baseline does not belong to the project being published.'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.planning_snapshots
   where project_id = p_project_id;

  v_is_opening := p_opening_position_id is not null or coalesce(p_is_opening_snapshot, false);

  if p_opening_position_id is not null then
    select project_id, status, data_date, planned_progress_percent,
           actual_progress_percent, forecast_finish_date, source
      into v_position_project, v_position_status, v_position_data_date,
           v_position_planned, v_position_actual, v_position_forecast,
           v_position_source
      from public.planning_opening_positions
     where id = p_opening_position_id
       for update;

    if not found then
      raise exception 'Opening Position % not found.', p_opening_position_id
        using errcode = 'foreign_key_violation';
    end if;
    if v_position_project <> p_project_id then
      raise exception
        'This Opening Position belongs to a different project.'
        using errcode = 'foreign_key_violation';
    end if;
    if v_position_status = 'promoted' then
      raise exception
        'This Opening Position has already been promoted to a Planning Snapshot.'
        using errcode = 'restrict_violation';
    end if;

    select onboarding_mode into v_onboarding_mode
      from public.project_planning_settings
     where project_id = p_project_id;

    if v_onboarding_mode is distinct from 'existing_active_project' then
      raise exception
        'An Opening Position can only be promoted for a project whose Planning Onboarding Mode is existing_active_project.'
        using errcode = 'check_violation';
    end if;
    if v_version <> 1 then
      raise exception
        'An Opening Position can only become the project''s first Planning Snapshot (version 1). This project already has a published snapshot.'
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- Planning Integration 3A (corrected): the Data Date always comes from a
  -- real, already-governed source — never a fabricated stand-in. Opening
  -- Position and import batch are both checked above and guaranteed
  -- non-null by this point; the manual path has no stored source at all,
  -- so it is the caller's explicit p_data_date or nothing.
  if p_opening_position_id is not null then
    v_data_date := v_position_data_date;
  elsif p_import_batch_id is not null then
    v_data_date := v_batch_data_date;
  else
    if p_data_date is null then
      raise exception
        'A Data Date is required to publish. Enter the schedule''s Data Date before publishing.'
        using errcode = 'check_violation';
    end if;
    v_data_date := p_data_date;
  end if;

  select jsonb_build_object(
    'work_items', coalesce((
      select jsonb_agg(to_jsonb(wi) order by wi.sort_order, wi.code)
        from public.planning_work_items wi
       where wi.project_id = p_project_id and wi.active
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.work_item_id, a.code)
        from public.planning_activities a
       where a.project_id = p_project_id and a.active
    ), '[]'::jsonb),
    'milestone_links', coalesce((
      select jsonb_agg(to_jsonb(l))
        from public.planning_milestone_links l
       where l.master_milestone_id in (
         select id from public.master_milestones where project_id = p_project_id
       )
    ), '[]'::jsonb),
    'opening_position', case when p_opening_position_id is not null then
      jsonb_build_object(
        'id', p_opening_position_id,
        'data_date', v_position_data_date,
        'planned_progress_percent', v_position_planned,
        'actual_progress_percent', v_position_actual,
        'forecast_finish_date', v_position_forecast,
        'source', v_position_source
      )
    else null end
  ) into v_snapshot_data;

  insert into public.planning_snapshots (
    project_id,
    version,
    source_import_batch_id,
    source_opening_position_id,
    baseline_id,
    is_opening_snapshot,
    label,
    data_date,
    snapshot_data,
    published_by_contact_id
  ) values (
    p_project_id,
    v_version,
    p_import_batch_id,
    p_opening_position_id,
    p_baseline_id,
    v_is_opening,
    p_label,
    v_data_date,
    v_snapshot_data,
    public.current_contact_id()
  )
  returning id into v_snapshot_id;

  -- Unchanged from Slice 2: the full review/import column model is copied
  -- into the immutable snapshot.
  insert into public.planning_snapshot_activities (
    snapshot_id, source_activity_id, source_work_item_id, external_id, code, name,
    is_milestone, planned_start_date, planned_finish_date,
    baseline_start_date, baseline_finish_date,
    actual_start_date, actual_finish_date, remaining_duration_days,
    percent_complete_planned, percent_complete_actual, percent_complete_physical,
    weight_percent, status, planned_value, earned_value
  )
  select
    v_snapshot_id, a.id, a.work_item_id, a.external_id, a.code, a.name, a.is_milestone,
    a.planned_start_date, a.planned_finish_date,
    a.baseline_start_date, a.baseline_finish_date,
    a.actual_start_date, a.actual_finish_date, a.remaining_duration_days,
    a.percent_complete_planned, a.percent_complete_actual, a.percent_complete_physical,
    a.weight_percent, a.status, a.planned_value, a.earned_value
  from public.planning_activities a
  where a.project_id = p_project_id and a.active;

  if p_import_batch_id is not null then
    update public.planning_import_batches
       set status = 'published'
     where id = p_import_batch_id;
  end if;

  if p_opening_position_id is not null then
    update public.planning_opening_positions
       set status = 'promoted',
           promoted_at = now(),
           promoted_to_snapshot_id = v_snapshot_id
     where id = p_opening_position_id;
  end if;

  return v_snapshot_id;
end;
$function$;

comment on function public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid, date, boolean) is
  'Publishes an immutable Planning Snapshot. 13.9B: archived refused first; refused while onboarding_mode = no_formal_schedule; the first governance anchor (project not yet Controlled) requires p_confirm_setup_control = true.';

/* ------------------------------ 12. Grants -------------------------------- */

do $grants$
declare
  v_internal constant text[] := array[
    'public.project_setup_system_columns()',
    'public.project_has_published_snapshot(uuid)',
    'public.project_setup_registry_entry(text)',
    'public.project_setup_pick(jsonb,text[])',
    'public.project_setup_field_value(uuid,text)',
    'public.project_setup_canonical_value(text,jsonb)',
    'public.project_setup_apply_value(uuid,text,jsonb)',
    'public.project_setup_amendment_authorises(uuid,text,text,jsonb)',
    'public.guard_project_setup_governance_history()',
    'public.guard_project_setup_controlled()',
    'public.guard_onboarding_mode_setup_controlled()'];
  v_client constant text[] := array[
    'public.project_setup_field_registry()',
    'public.project_setup_controlled_since(uuid)',
    'public.project_setup_controlled(uuid)',
    'public.project_onboarding_transition_rule(uuid,text,text)',
    'public.request_project_setup_amendment(uuid,text,jsonb,jsonb,text)',
    'public.decide_project_setup_amendment(uuid,text,text)',
    'public.withdraw_project_setup_amendment(uuid,text)',
    'public.publish_planning_snapshot(uuid,uuid,uuid,boolean,text,uuid,date,boolean)'];
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

/* ---------------------------- 13. Post-checks ----------------------------- */

do $post$
declare
  v_list text;
begin
  -- Every projects column is classified or a declared system column.
  select string_agg(column_name::text, ', ') into v_list
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'projects'
     and not exists (select 1 from public.project_setup_field_registry() r
                      where r.kind = 'column' and r.target_table = 'projects'
                        and c.column_name::text = any (r.target_columns))
     and not (c.column_name::text = any (public.project_setup_system_columns()));
  if v_list is not null then
    raise exception '13.9B post-check failed: unclassified projects columns: %', v_list;
  end if;

  -- Registry integrity: unique keys, valid classes, column keys name real columns.
  if (select count(*) from public.project_setup_field_registry())
     <> (select count(distinct field_key) from public.project_setup_field_registry()) then
    raise exception '13.9B post-check failed: duplicate registry keys.';
  end if;
  if exists (select 1 from public.project_setup_field_registry()
              where field_class not in ('free_logged', 'lightweight', 'governed', 'system_admin_correction',
                                        'superseded', 'planning_owned', 'retired')
                 or kind not in ('column', 'relation')) then
    raise exception '13.9B post-check failed: invalid registry class or kind.';
  end if;
  select string_agg(r.field_key || '.' || c, ', ') into v_list
    from public.project_setup_field_registry() r, unnest(r.target_columns) c
   where r.kind = 'column'
     and not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public' and ic.table_name = r.target_table and ic.column_name = c);
  if v_list is not null then
    raise exception '13.9B post-check failed: registry names missing columns: %', v_list;
  end if;

  -- One publish overload, with the confirmation argument.
  if (select count(*) from pg_catalog.pg_proc
       where proname = 'publish_planning_snapshot' and pronamespace = 'public'::regnamespace) <> 1
     or to_regprocedure('public.publish_planning_snapshot(uuid,uuid,uuid,boolean,text,uuid,date,boolean)') is null then
    raise exception '13.9B post-check failed: publish_planning_snapshot() overloads are wrong.';
  end if;

  -- The archived guard answers first on both new tables.
  if exists (select 1 from pg_catalog.pg_trigger g
              where g.tgrelid in ('public.project_setup_amendments'::regclass, 'public.project_setup_field_changes'::regclass)
                and not g.tgisinternal and (g.tgtype & 3) = 3
                and g.tgname < 'block_archived_setup_governance') then
    raise exception '13.9B post-check failed: a trigger fires before the archived guard on a governance table.';
  end if;
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'block_archived_setup_governance') <> 2 then
    raise exception '13.9B post-check failed: archived guard missing on a governance table.';
  end if;

  -- The archived projects guard still answers before the setup-controlled guard.
  if not exists (select 1 from pg_catalog.pg_trigger where tgname = 'block_archived_project_setup'
                  and tgrelid = 'public.projects'::regclass) then
    raise exception '13.9B post-check failed: the 2C.3E archived projects guard is missing.';
  end if;

  -- No client can call an internal function or write a governance table.
  if has_function_privilege('authenticated', 'public.project_setup_apply_value(uuid,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_project_setup_controlled()', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.project_setup_amendments', 'INSERT')
     or has_table_privilege('authenticated', 'public.project_setup_amendments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.project_setup_amendments', 'DELETE')
     or has_table_privilege('authenticated', 'public.project_setup_field_changes', 'INSERT')
     or has_table_privilege('anon', 'public.project_setup_amendments', 'SELECT') then
    raise exception '13.9B post-check failed: a governance write or internal function is reachable by a client.';
  end if;

  -- Scope boundary: the shared predicates are unchanged.
  if (select prosrc from pg_catalog.pg_proc where oid = 'public.can_manage_project_operations(uuid)'::regprocedure)
       ~ 'project_is_archived|project_setup' then
    raise exception '13.9B post-check failed: can_manage_project_operations() was changed.';
  end if;
end;
$post$;

notify pgrst, 'reload schema';
