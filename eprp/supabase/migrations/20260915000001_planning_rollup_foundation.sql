-- Planning Integration 3A — governed rollup foundation.
--
-- Adds the one property genuinely missing to resolve "the snapshot valid
-- for a report's period end": a real Data Date on every published
-- snapshot — the schedule/status position it reports, NEVER the date it
-- happened to be published on.
--
-- Two sources for that date, both real:
--   * Opening Position publish  — planning_opening_positions.data_date,
--     already collected, already not null.
--   * Import-based publish      — the import batch's OWN data_date, now a
--     column on planning_import_batches. Populated by the import wizard,
--     either detected from a recognizable Data Date / Status Date column
--     in the source file, or entered by hand. publish_planning_snapshot()
--     REFUSES to publish an import batch that has none — it never invents
--     one from published_at or current_date.
--   * Manual / current Master Plan publish (no batch, no Opening
--     Position) — the one case with no stored source at all, so the
--     caller must supply p_data_date explicitly. Refused if omitted.
--
-- planning_snapshots.data_date is therefore left NULLABLE: a snapshot
-- published before this migration existed genuinely has no recoverable
-- data date (unless it came from an Opening Position, backfilled below),
-- and leaving it null is the honest answer — not a fabricated one. Every
-- snapshot published FROM THIS MIGRATION FORWARD is guaranteed one by
-- publish_planning_snapshot() itself; getSnapshotForPeriod's own
-- `data_date <= period_end` filter naturally excludes a null row from
-- resolution, exactly as it should for an unknown position.
--
-- Forward-only. 20260913000001_planning_foundation.sql (Slice 1) and
-- 20260914000001_planning_slice2_schema.sql (Slice 2) are not edited.

alter table public.planning_snapshots
  add column if not exists data_date date;

-- Backfill only what is genuinely recoverable: an Opening Snapshot's real
-- data date, captured in its own snapshot_data at publish time. Nothing
-- else is backfilled — an import-based snapshot published before this
-- migration has no recoverable data date, and null says exactly that.
update public.planning_snapshots s
   set data_date = (s.snapshot_data -> 'opening_position' ->> 'data_date')::date
 where s.data_date is null
   and s.is_opening_snapshot
   and s.snapshot_data -> 'opening_position' ->> 'data_date' is not null;

comment on column public.planning_snapshots.data_date is
  'The schedule position this snapshot reports as of — never published_at. Nullable only for a pre-3A snapshot with no recoverable date; publish_planning_snapshot() refuses to insert a new row without one. Governs snapshot-period resolution: a report resolves to the latest-data-date (ties broken by version) published snapshot whose data_date <= its own period end.';

-- The resolution query this column exists for: "the snapshot for this
-- project with the latest data_date <= X, ties broken by version" —
-- data_date first, NOT version first. project_id is already indexed via
-- the unique (project_id, version) constraint, but that index cannot
-- serve this ordering.
create index if not exists planning_snapshots_project_data_date
  on public.planning_snapshots(project_id, data_date desc, version desc);

/* ============================================================================
   planning_import_batches — the Data Date an import reports as of.
   ========================================================================= */

alter table public.planning_import_batches
  add column if not exists data_date date;

comment on column public.planning_import_batches.data_date is
  'The schedule''s own Data Date / Status Date — set by the import wizard, either detected from a recognizable column in the source file or entered by the user. Nullable while a batch is being reviewed; publish_planning_snapshot() refuses to publish a batch that still has none, so a snapshot can never inherit a fabricated date.';

/* ============================================================================
   publish_planning_snapshot() — same name, one new trailing parameter
   (p_data_date, for the manual/no-batch path only), corrected Data Date
   resolution. Every other behaviour is unchanged from Slice 2.

   A changed parameter list is a NEW function object to Postgres, not an
   in-place replacement of the old one — `create or replace` alone would
   leave the old 6-arg signature callable side by side with its Slice 2
   body, which never checks for a Data Date at all and would silently
   publish a null-data_date snapshot, defeating this entire migration. The
   old signature is retired outright.
   ========================================================================= */

drop function if exists public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid);

create or replace function public.publish_planning_snapshot(
  p_project_id uuid,
  p_import_batch_id uuid default null,
  p_baseline_id uuid default null,
  p_is_opening_snapshot boolean default false,
  p_label text default null,
  p_opening_position_id uuid default null,
  p_data_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
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
$fn$;

comment on function public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid, date) is
  'Governed publish path for a Planning Snapshot. Planning Integration 3A (corrected): stamps a real Data Date on every new row — from the Opening Position, from the import batch''s own Data Date, or (manual/no-batch publish only) from the caller-supplied p_data_date — and REFUSES to publish an import batch or a manual position with none. Never falls back to published_at or current_date. Signature gains one new trailing optional parameter (p_data_date); every other behaviour is unchanged from Slice 2.';

-- `create or replace function` with a NEW parameter list creates a
-- distinct function object from the 6-arg Slice 2 signature — it does NOT
-- inherit that signature's revoke/grant, and Postgres grants EXECUTE to
-- PUBLIC by default on a newly created function. Re-apply the same
-- authenticated-only gate Slice 1 set on the original signature.
revoke execute on function public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid, date)
  from public, anon;
grant execute on function public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid, date)
  to authenticated, service_role;

/* ----------------------------- postconditions ----------------------------- */

do $post$
declare
  v_missing_snapshot_col integer;
  v_missing_batch_col integer;
  v_missing_index integer;
begin
  select count(*) into v_missing_snapshot_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'planning_snapshots' and column_name = 'data_date';
  if v_missing_snapshot_col <> 1 then
    raise exception 'Post-check failed: planning_snapshots.data_date column is missing.';
  end if;

  select count(*) into v_missing_batch_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'planning_import_batches' and column_name = 'data_date';
  if v_missing_batch_col <> 1 then
    raise exception 'Post-check failed: planning_import_batches.data_date column is missing.';
  end if;

  select count(*) into v_missing_index
    from pg_indexes
   where schemaname = 'public'
     and tablename = 'planning_snapshots'
     and indexname = 'planning_snapshots_project_data_date';
  if v_missing_index <> 1 then
    raise exception 'Post-check failed: planning_snapshots_project_data_date index is missing.';
  end if;

  if has_function_privilege('anon', 'public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid, date)', 'EXECUTE') then
    raise exception 'Post-check failed: publish_planning_snapshot() is executable by anon after replacement.';
  end if;

  if exists (
    select 1 from pg_proc
     where proname = 'publish_planning_snapshot'
       and pronamespace = 'public'::regnamespace
       and pronargs = 6
  ) then
    raise exception 'Post-check failed: the retired 6-arg publish_planning_snapshot() overload still exists alongside the new 7-arg one.';
  end if;

  raise notice 'Planning Integration 3A schema installed (corrected): planning_snapshots.data_date and planning_import_batches.data_date, nullable and never fabricated; publish_planning_snapshot() refuses to publish without a real one; the old 6-arg signature is retired.';
end;
$post$;
