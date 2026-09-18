-- EPRP Planning Slice 2 — schema additions for the usable workflow:
-- Master Plan → Import → Map → Validate → Review/Confirm → Publish.
--
-- Forward-only. 20260913000001_planning_foundation.sql (Slice 1, committed)
-- is never edited. Every statement here is additive: new columns (all
-- nullable or defaulted so no existing row becomes invalid), one widened
-- table (planning_confirmations, explained below), and one function body
-- replaced under its existing name and signature.
--
-- WHAT SLICE 1 DID NOT YET COVER, FOUND WHILE BUILDING THE REAL WORKFLOW
--
-- 1. Master Plan needs a TYPE taxonomy (Study, Deliverable, Report, Activity,
--    Engineering, Procurement, Construction, Inspection, Commissioning,
--    Milestone, Other) to be a usable WBS editor. planning_work_items had no
--    type column at all.
--
-- 2. "Where an existing governed Deliverable/Study/Milestone exists, link it
--    instead of creating a competing duplicate source." Milestone linking
--    already exists (planning_milestone_links, Slice 1). Deliverable linking
--    does not — added as a direct nullable reference, the same shape as
--    master_milestones.source_document_id: a reference, never a copy.
--
-- 3. The requested import column model (actual dates, remaining duration,
--    actual/physical % complete, status, planned/earned value) has no home
--    on planning_activities, which Slice 1 scoped to planned/baseline dates
--    and one planning %. All added nullable — "missing optional fields
--    remain null. Never fabricate values" applies to the column design, not
--    only to the importer.
--
-- 4. planning_snapshot_activities mirrors the same widened shape, so the
--    immutable published history is exactly as complete as the live import —
--    a snapshot must not lose fidelity relative to what was actually
--    imported and confirmed.
--
-- 5. planning_confirmations.work_item_id was NOT NULL with no way to
--    reference an activity. But the review/confirm workflow this slice
--    builds is centered on ACTIVITIES (the imported P6/MS Project rows) —
--    the same "exactly one of two nullable targets" shape
--    planning_milestone_links already established for work_item_id/
--    activity_id is applied here. work_item_id is widened to nullable and an
--    activity_id column is added; the two SELECT/INSERT policies are
--    redefined (drop + recreate, the standard pattern for amending an
--    already-shipped policy in this schema) to resolve either target through
--    can_access_project()/can_manage_project_operations() exactly as before —
--    no new authority, no redesign.
--
-- Role architecture, RLS predicates and publish_planning_snapshot()'s
-- signature are UNCHANGED. Only its body is replaced, to also copy the new
-- activity columns into the snapshot it publishes.

/* ============================================================================
   1. Master Plan — item type taxonomy and governed Deliverable linking
   ========================================================================= */

alter table public.planning_work_items
  add column if not exists item_type text not null default 'activity',
  add column if not exists master_deliverable_id uuid
    references public.master_deliverables(id) on delete set null;

do $guard$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'planning_work_items_item_type_valid'
  ) then
    alter table public.planning_work_items
      add constraint planning_work_items_item_type_valid check (
        item_type in (
          'study', 'deliverable', 'report', 'activity', 'engineering',
          'procurement', 'construction', 'inspection', 'commissioning',
          'milestone', 'other'
        )
      );
  end if;
end;
$guard$;

comment on column public.planning_work_items.item_type is
  'Master Plan classification. Free-standing taxonomy, not project-hierarchy scope (department/system/discipline remain separate). "milestone" type items should be linked via planning_milestone_links rather than treated as this project''s only record of the milestone.';
comment on column public.planning_work_items.master_deliverable_id is
  'Reference only, never a copy — mirrors how planning_milestone_links references master_milestones. Set when item_type=''deliverable'' and a governed Master Deliverable already exists for this scope, so Planning links to it instead of creating a competing duplicate source.';

create index if not exists planning_work_items_master_deliverable
  on public.planning_work_items(master_deliverable_id)
  where master_deliverable_id is not null;

-- Architecture §5 rule 2 / §21 rule 2: no project-scoped entity may reference
-- a project-scoped entity of a different project. A bare FK cannot express
-- "same project as the referencing row" — this is the same cross-project
-- leak guard planning_milestone_links and planning_activities already carry.
create or replace function public.guard_planning_work_item_deliverable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_deliverable_project uuid;
begin
  if new.master_deliverable_id is null then
    return new;
  end if;

  select project_id into v_deliverable_project
    from public.master_deliverables
   where id = new.master_deliverable_id;

  if v_deliverable_project is null or v_deliverable_project <> new.project_id then
    raise exception
      'A work item can only link to a Master Deliverable in the same project.'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$fn$;

comment on function public.guard_planning_work_item_deliverable() is
  'Keeps planning_work_items.master_deliverable_id inside the work item''s own project. Security definer so it can read the deliverable regardless of the caller''s own RLS.';

drop trigger if exists planning_work_items_deliverable_guard on public.planning_work_items;
create trigger planning_work_items_deliverable_guard
  before insert or update of master_deliverable_id, project_id on public.planning_work_items
  for each row execute function public.guard_planning_work_item_deliverable();

/* ============================================================================
   2. planning_activities — the full import/review column model
   ========================================================================= */

alter table public.planning_activities
  add column if not exists actual_start_date date,
  add column if not exists actual_finish_date date,
  -- planned_duration_days (Slice 1) already serves as "Original Duration".
  add column if not exists remaining_duration_days integer,
  -- Distinct from percent_complete_planned (Slice 1: the schedule's planned
  -- %, as of the data date). These two are what the source system itself
  -- reports as achieved — "Actual %" (duration-based) and "Physical %"
  -- (weighted/earned-value based) are genuinely different figures in P6.
  add column if not exists percent_complete_actual numeric(6, 3),
  add column if not exists percent_complete_physical numeric(6, 3),
  -- Raw, as reported by the source. Free text by design: P6/MS Project status
  -- vocabularies differ and this migration has no authority to normalize them
  -- into a platform enum without discarding information the source recorded.
  add column if not exists status text,
  add column if not exists planned_value numeric(16, 2),
  add column if not exists earned_value numeric(16, 2);

do $guard$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'planning_activities_actual_date_order'
  ) then
    alter table public.planning_activities
      add constraint planning_activities_actual_date_order check (
        actual_start_date is null or actual_finish_date is null
        or actual_start_date <= actual_finish_date
      );
    alter table public.planning_activities
      add constraint planning_activities_remaining_duration_non_negative
        check (remaining_duration_days is null or remaining_duration_days >= 0);
    alter table public.planning_activities
      add constraint planning_activities_percent_actual_range
        check (percent_complete_actual is null or percent_complete_actual between 0 and 100);
    alter table public.planning_activities
      add constraint planning_activities_percent_physical_range
        check (percent_complete_physical is null or percent_complete_physical between 0 and 100);
    alter table public.planning_activities
      add constraint planning_activities_planned_value_non_negative
        check (planned_value is null or planned_value >= 0);
    alter table public.planning_activities
      add constraint planning_activities_earned_value_non_negative
        check (earned_value is null or earned_value >= 0);
  end if;
end;
$guard$;

comment on column public.planning_activities.status is
  'Raw status text as reported by the source (P6/MS Project/EPRP template/manual). Not normalized to a platform enum — vocabularies differ across sources and normalizing would discard what was actually reported.';
comment on column public.planning_activities.percent_complete_actual is
  'The source''s own duration-based "Actual %", distinct from percent_complete_planned (Slice 1) and percent_complete_physical.';
comment on column public.planning_activities.percent_complete_physical is
  'The source''s own weighted/earned-value-based "Physical %", distinct from percent_complete_actual.';

/* ============================================================================
   3. planning_snapshot_activities — matching fidelity, plus a stable
      matching key for "compare against the previous published snapshot"
   ========================================================================= */

alter table public.planning_snapshot_activities
  -- The stable identity used to match an activity across imports and across
  -- snapshots for the Planning Review comparison — code alone is a display
  -- value and is not guaranteed stable the way a source system's own id is.
  add column if not exists external_id text,
  add column if not exists actual_start_date date,
  add column if not exists actual_finish_date date,
  add column if not exists remaining_duration_days integer,
  add column if not exists percent_complete_actual numeric(6, 3),
  add column if not exists percent_complete_physical numeric(6, 3),
  add column if not exists status text,
  add column if not exists planned_value numeric(16, 2),
  add column if not exists earned_value numeric(16, 2);

comment on column public.planning_snapshot_activities.external_id is
  'Copied from planning_activities.external_id at publish time. The key Planning Review matches "this imported row" against "what the previous published snapshot said", since code is a display value and is not guaranteed stable.';

create index if not exists planning_snapshot_activities_external_id
  on public.planning_snapshot_activities(snapshot_id, external_id)
  where external_id is not null;

/* ============================================================================
   4. planning_confirmations — widened to also target an activity
   ========================================================================= */

alter table public.planning_confirmations
  alter column work_item_id drop not null,
  add column if not exists activity_id uuid
    references public.planning_activities(id) on delete cascade;

do $guard$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'planning_confirmations_one_target'
  ) then
    alter table public.planning_confirmations
      add constraint planning_confirmations_one_target check (
        (work_item_id is not null and activity_id is null)
        or (work_item_id is null and activity_id is not null)
      );
  end if;
end;
$guard$;

comment on table public.planning_confirmations is
  'Append-only record of every confirm/adjust decision made against a planning_work_items OR planning_activities value, with a required reason. Never edited or removed — this is the history the "confirm/adjust, never overwrite the raw import" rule depends on. Exactly one of work_item_id/activity_id is set per row, the same shape planning_milestone_links already uses for two optional targets.';

create index if not exists planning_confirmations_activity
  on public.planning_confirmations(activity_id, confirmed_at desc)
  where activity_id is not null;

create or replace function public.planning_activity_project(p_activity uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select project_id from public.planning_activities where id = p_activity;
$fn$;

comment on function public.planning_activity_project(uuid) is
  'The project a planning activity belongs to. Security definer so planning_confirmations RLS can reach it without re-entering planning_activities RLS.';

-- Amending the two Slice 1 policies that assumed work_item_id was always
-- set. Dropped and recreated rather than ALTERed in place because the USING/
-- WITH CHECK expression itself changes shape (a coalesce over two possible
-- targets) — the same "drop policy if exists; create policy" pattern this
-- schema already uses whenever an earlier migration's policy needs amending
-- (e.g. 20260824000001 over the Weekly/Monthly tables). No new authority:
-- still exactly can_access_project() for read, can_manage_project_operations()
-- for write, on whichever project the set target resolves to.
drop policy if exists planning_confirmations_select on public.planning_confirmations;
create policy planning_confirmations_select on public.planning_confirmations
  for select to authenticated
  using (
    public.can_access_project(
      coalesce(
        public.planning_work_item_project(work_item_id),
        public.planning_activity_project(activity_id)
      )
    )
  );

drop policy if exists planning_confirmations_insert on public.planning_confirmations;
create policy planning_confirmations_insert on public.planning_confirmations
  for insert to authenticated
  with check (
    public.can_manage_project_operations(
      coalesce(
        public.planning_work_item_project(work_item_id),
        public.planning_activity_project(activity_id)
      )
    )
  );

-- Still no UPDATE, no DELETE policy: append-only audit, unchanged from Slice 1.

/* ============================================================================
   5. publish_planning_snapshot() — same name, same signature, wider copy
   ========================================================================= */

create or replace function public.publish_planning_snapshot(
  p_project_id uuid,
  p_import_batch_id uuid default null,
  p_baseline_id uuid default null,
  p_is_opening_snapshot boolean default false,
  p_label text default null,
  p_opening_position_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_batch_project uuid;
  v_batch_status text;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text, 0)
  );

  if p_import_batch_id is not null then
    select project_id, status into v_batch_project, v_batch_status
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
    v_snapshot_data,
    public.current_contact_id()
  )
  returning id into v_snapshot_id;

  -- Widened in Slice 2: the full review/import column model is now copied
  -- into the immutable snapshot, not only the Slice 1 subset.
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
$fn$;

comment on function public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid) is
  'Governed publish path for a Planning Snapshot. Slice 2: the copy into planning_snapshot_activities now carries the full import/review column model (actuals, remaining duration, actual/physical %, status, planned/earned value, external_id) so the immutable published history is exactly as complete as the live import. Signature and every other behaviour unchanged from Slice 1.';

/* ----------------------------- postconditions ----------------------------- */

do $post$
declare
  v_missing_rls integer;
  v_blanket integer;
  v_leak integer;
  v_confirmations_target_check integer;
begin
  select count(*) into v_missing_rls
    from unnest(array[
      'planning_work_items', 'planning_activities', 'planning_snapshot_activities',
      'planning_confirmations', 'planning_snapshots'
    ]) t(tablename)
   where not exists (
     select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = t.tablename
        and c.relrowsecurity
   );
  if v_missing_rls > 0 then
    raise exception 'Post-check failed: % Slice 2 table(s) missing RLS.', v_missing_rls;
  end if;

  select count(*) into v_blanket
    from pg_policies
   where schemaname = 'public'
     and tablename = 'planning_confirmations'
     and (qual = 'true' or with_check = 'true');
  if v_blanket > 0 then
    raise exception 'Post-check failed: % blanket policy/policies on planning_confirmations after the redefinition.', v_blanket;
  end if;

  select count(*) into v_leak
    from pg_policies
   where schemaname = 'public'
     and tablename = 'planning_confirmations'
     and cmd <> 'SELECT'
     and (
       coalesce(qual, '') || coalesce(with_check, '') like '%has_full_portfolio_read%'
       or coalesce(qual, '') || coalesce(with_check, '') like '%has_published_portfolio_read%'
     );
  if v_leak > 0 then
    raise exception 'Post-check failed: a portfolio-read-only helper leaked onto the redefined planning_confirmations write policy.';
  end if;

  select count(*) into v_confirmations_target_check
    from pg_constraint
   where conrelid = 'public.planning_confirmations'::regclass
     and conname = 'planning_confirmations_one_target';
  if v_confirmations_target_check <> 1 then
    raise exception 'Post-check failed: planning_confirmations_one_target constraint missing.';
  end if;

  if has_function_privilege('anon', 'public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid)', 'EXECUTE') then
    raise exception 'Post-check failed: publish_planning_snapshot() is executable by anon after replacement.';
  end if;

  if (
    select count(*) from pg_trigger
     where tgname = 'planning_work_items_deliverable_guard' and not tgisinternal
  ) <> 1 then
    raise exception 'Post-check failed: the cross-project master_deliverable_id guard trigger is missing.';
  end if;

  raise notice 'Planning Slice 2 schema installed: item_type taxonomy, cross-project-guarded Deliverable linking, widened activity/snapshot-activity column model, planning_confirmations now targets work_item OR activity, publish_planning_snapshot() copies the full model.';
end;
$post$;
