-- Phase 13.9B — Project Setup Governance — Step 3: structured history for
-- Contacts, Sites and Parties (owner closure 2026-10-17).
--
-- Architecture: docs/02_PLATFORM_ARCHITECTURE.md §26.24.2 / §26.24.7;
-- logical model: docs/06_DATABASE_SCHEMA.md §10A.11.8.
--
-- WHY A MIGRATION IS NEEDED
--   The registry classes Contacts, Sites and Parties as FREE / LOGGED, but no
--   structured record of their changes existed (Step 1 marked them
--   "as_today"). Inspected before writing this:
--   * project_sites and project_parties are written by
--     save_project_setup_relation() (upsert by id, delete removed rows) and
--     have no history table;
--   * project_contacts is shared: the five project-level responsibility
--     holders mirror projects.*_id columns (already logged by Step 1), while
--     department / system / discipline assignments and team rows were
--     unlogged. replace_project_responsibility() writes
--     project_responsibility_history only for holder replacements.
--
-- WHAT THIS ADDS (the smallest structured mechanism; no generic audit system)
--   * project_setup_relation_changes — append-only, one row per changed
--     record per transaction, holding the NET before / after image (so the
--     Sites save that clears and re-sets is_primary, or a save that re-sends
--     unchanged rows, records nothing).
--   * log_project_setup_relation_change() — AFTER INSERT / UPDATE / DELETE row
--     triggers on project_contacts, project_sites and project_parties, active
--     only while the project is Controlled (the same rule as
--     project_setup_field_changes). Project-level responsibility holders are
--     excluded from Contacts: their projects columns are already logged.
--   * Images keep the meaningful columns only (no ids, ordering or
--     timestamps) and capture the contact's name at the time.
--   * The registry marks contacts / sites / parties as enforced from 13.9B-3.
--
-- UNCHANGED: every relation write path and its rules; the 2C.3E archived
-- guards on the relation tables (they answer first, so an archived project's
-- relations never change and never log); Step 1 / Step 2 semantics.

/* ----------------------------- 1. The log -------------------------------- */

create table public.project_setup_relation_changes (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  relation        text not null,
  record_id       uuid not null,
  previous_value  jsonb,
  new_value       jsonb,
  action          text generated always as (
                    case when previous_value is null then 'added'
                         when new_value is null then 'removed'
                         else 'changed' end) stored,
  changed_by      uuid,
  changed_by_name text,
  changed_at      timestamptz not null default now(),
  transaction_id  xid8 not null default pg_catalog.pg_current_xact_id(),
  constraint project_setup_relation_changes_relation_valid check (relation in ('contacts', 'sites', 'parties')),
  constraint project_setup_relation_changes_something check (previous_value is not null or new_value is not null),
  constraint project_setup_relation_changes_real_change check (previous_value is distinct from new_value)
);

-- One net row per record per transaction.
create unique index project_setup_relation_changes_one_per_tx
  on public.project_setup_relation_changes (transaction_id, relation, record_id);
create index project_setup_relation_changes_project_time
  on public.project_setup_relation_changes (project_id, changed_at desc);

comment on table public.project_setup_relation_changes is
  '13.9B Step 3. Append-only history of Contacts, Sites and Parties changes on a Controlled project: one net before / after row per record per transaction (docs/06 §10A.11.8). Written only by log_project_setup_relation_change(); readable by whoever can read the project.';

/* ------------------------- 2. Images and the trigger --------------------- */

-- The meaningful, human-readable image of a relation row, or NULL when the
-- row is not part of the logged relation.
create function public.project_setup_relation_image(p_relation text, p_row jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if p_row is null then
    return null;
  end if;
  if p_relation = 'contacts' then
    -- Project-level holders mirror projects.*_id (already logged).
    if p_row ->> 'role' in ('project_manager', 'project_control_manager', 'client_representative',
                            'reporting_coordinator', 'project_sponsor')
       and p_row ->> 'department_id' is null and p_row ->> 'system_id' is null
       and p_row ->> 'discipline_id' is null then
      return null;
    end if;
    return jsonb_build_object(
      'contact_id', p_row -> 'contact_id',
      'contact_name', (select c.name from public.contacts c where c.id = (p_row ->> 'contact_id')::uuid),
      'role', p_row -> 'role',
      'department_id', p_row -> 'department_id',
      'system_id', p_row -> 'system_id',
      'discipline_id', p_row -> 'discipline_id',
      'assignment_role', p_row -> 'assignment_role',
      'functional_title', p_row -> 'functional_title',
      'reports_to_contact_id', p_row -> 'reports_to_contact_id');
  elsif p_relation = 'sites' then
    return jsonb_build_object(
      'name', p_row -> 'name', 'country', p_row -> 'country', 'city', p_row -> 'city',
      'is_primary', p_row -> 'is_primary');
  elsif p_relation = 'parties' then
    return jsonb_build_object(
      'kind', p_row -> 'kind', 'name', p_row -> 'name', 'short_name', p_row -> 'short_name',
      'scope', p_row -> 'scope', 'contract_reference', p_row -> 'contract_reference',
      'engagement_status', p_row -> 'engagement_status');
  end if;
  return null;
end;
$fn$;

create function public.log_project_setup_relation_change()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_relation text := case tg_table_name
                       when 'project_contacts' then 'contacts'
                       when 'project_sites' then 'sites'
                       when 'project_parties' then 'parties' end;
  v_project uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  v_record uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  v_old jsonb;
  v_new jsonb;
  v_existing public.project_setup_relation_changes;
  v_prev jsonb;
begin
  if v_relation is null then
    raise exception 'log_project_setup_relation_change() is not defined for table %', tg_table_name
      using errcode = 'P0001';
  end if;
  -- A whole-project delete cascades here after the project row is gone.
  if not exists (select 1 from public.projects p where p.id = v_project)
     or not public.project_setup_controlled(v_project) then
    return null;
  end if;
  if tg_op <> 'INSERT' then v_old := public.project_setup_relation_image(v_relation, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then v_new := public.project_setup_relation_image(v_relation, to_jsonb(new)); end if;
  if v_old is null and v_new is null then
    return null;
  end if;

  select * into v_existing from public.project_setup_relation_changes
   where transaction_id = pg_catalog.pg_current_xact_id() and relation = v_relation and record_id = v_record
   for update;
  v_prev := case when found then v_existing.previous_value else v_old end;

  -- Only this trigger may revise a row it is still building (same transaction).
  perform set_config('eprp.relation_log_writer', 'on', true);
  if v_prev is not distinct from v_new then
    -- Net no-op within the transaction (e.g. a re-saved unchanged row).
    if v_existing.id is not null then
      delete from public.project_setup_relation_changes where id = v_existing.id;
    end if;
  elsif v_existing.id is not null then
    update public.project_setup_relation_changes
       set new_value = v_new, changed_at = now()
     where id = v_existing.id;
  else
    insert into public.project_setup_relation_changes
      (project_id, relation, record_id, previous_value, new_value, changed_by, changed_by_name)
    values (v_project, v_relation, v_record, v_prev, v_new, auth.uid(),
            (select p.full_name from public.profiles p where p.id = auth.uid()));
  end if;
  perform set_config('eprp.relation_log_writer', 'off', true);
  return null;
end;
$fn$;

create function public.guard_project_setup_relation_history()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.projects p where p.id = old.project_id) then
    return old;  -- the project's own cascade
  end if;
  if current_setting('eprp.relation_log_writer', true) is distinct from 'on'
     or old.transaction_id is distinct from pg_catalog.pg_current_xact_id() then
    raise exception '[SETUP_HISTORY_IMMUTABLE] Project Setup governance history cannot be edited.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

create trigger block_archived_setup_governance
  before insert or update or delete on public.project_setup_relation_changes
  for each row execute function public.guard_archived_project_setup();
create trigger guard_setup_relation_history
  before update or delete on public.project_setup_relation_changes
  for each row execute function public.guard_project_setup_relation_history();

-- "log_" sorts after every existing AFTER trigger on these tables.
create trigger log_project_setup_relation_change
  after insert or update or delete on public.project_contacts
  for each row execute function public.log_project_setup_relation_change();
create trigger log_project_setup_relation_change
  after insert or update or delete on public.project_sites
  for each row execute function public.log_project_setup_relation_change();
create trigger log_project_setup_relation_change
  after insert or update or delete on public.project_parties
  for each row execute function public.log_project_setup_relation_change();

/* --------------------------- 3. RLS and grants ---------------------------- */

alter table public.project_setup_relation_changes enable row level security;
create policy project_setup_relation_changes_select on public.project_setup_relation_changes
  for select to authenticated using (public.can_access_project(project_id));
revoke all on public.project_setup_relation_changes from public, anon, authenticated, service_role;
grant select on public.project_setup_relation_changes to authenticated, service_role;

revoke execute on function public.project_setup_relation_image(text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.log_project_setup_relation_change() from public, anon, authenticated, service_role;
revoke execute on function public.guard_project_setup_relation_history() from public, anon, authenticated, service_role;

/* ------------------ 4. Registry: Contacts / Sites / Parties --------------- */

create or replace function public.project_setup_field_registry()
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
    ('contacts', 'relation', 'project_contacts', array[]::text[], 'free_logged', null, null, '13.9B-3', 'Contacts', null, null),
    ('sites', 'relation', 'project_sites', array[]::text[], 'free_logged', null, null, '13.9B-3', 'Sites', null, null),
    ('parties', 'relation', 'project_parties', array[]::text[], 'free_logged', null, null, '13.9B-3', 'Subcontractors and Parties', null, null),
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

/* ---------------------------- 5. Post-checks ------------------------------ */

do $post$
begin
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'log_project_setup_relation_change') <> 3 then
    raise exception '13.9B Step 3 post-check failed: relation history triggers missing.';
  end if;
  if exists (select 1 from public.project_setup_field_registry() where enforced_from = 'as_today') then
    raise exception '13.9B Step 3 post-check failed: a free / logged relation is still unlogged.';
  end if;
  if has_table_privilege('authenticated', 'public.project_setup_relation_changes', 'INSERT,UPDATE,DELETE') then
    raise exception '13.9B Step 3 post-check failed: the relation history is writable by a client.';
  end if;
end;
$post$;

notify pgrst, 'reload schema';
