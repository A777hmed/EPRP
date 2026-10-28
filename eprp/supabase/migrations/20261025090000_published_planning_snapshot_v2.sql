-- Phase 13.12 (2/2) — Published Planning Snapshot v2 and its trusted writer.
--
-- docs/02 §26.8, §26.22.7, §26.25 (D-A to D-D, approved 2026-10-22);
-- docs/06 §10A.7.
--
-- * A v2 snapshot freezes what the Planning Engine (13.10) calculated on the
--   server from the Working Plan (13.11 adapter) for one Data Date: the
--   project figures, every node and activity with its weights and figures,
--   every true milestone's schedule state, the forecast curve and the earned
--   point, with full provenance (engine version, BL0 / BLn, source, Working
--   Plan identity, publisher). Nothing here recalculates any of it.
-- * publish_planning_snapshot_v2() is SERVER-ONLY (service role). The server
--   verified the caller's session; the database then re-checks every rule AS
--   that user: authority, archived, no formal schedule, the first-publish
--   confirmation, the Data Date and its source, an approved BL0, the current
--   BLn, a Working Plan unchanged since the engine read it, new scope covered
--   by BLn, and that every engine input in the payload equals the stored
--   Working Plan and baselines.
-- * No client role can insert a snapshot or any snapshot row: the INSERT
--   policies are removed. Every snapshot row is immutable.
-- * D-C: schedule condition is "not evaluated" (thresholds pending B4); its
--   inputs are frozen.
-- * D-D: the legacy publish is retired for normal publishes; only an Opening
--   Position promotion still uses it, unchanged. Legacy snapshots are never
--   touched.
--
-- Additive. No existing row is rewritten.

/* ------------------------------------------------------------------------ */
/* 1. Snapshot header: v2 identity, provenance and frozen project figures    */
/* ------------------------------------------------------------------------ */

alter table public.planning_snapshots
  add column engine_version text,
  add column published_by_user_id uuid references public.profiles(id) on delete set null,
  -- NO ACTION (checked at statement end): a baseline is deleted only with its
  -- project, in the same statement as the snapshots that reference it.
  add column bl0_baseline_id uuid references public.planning_baselines(id),
  add column bln_baseline_id uuid references public.planning_baselines(id),
  add column source_kind text,
  add column working_plan_fingerprint text,
  add column configuration_updated_at timestamptz,
  add column edits_since_source integer,
  add column edits_high_water_at timestamptz,
  add column project_pv numeric(9, 4),
  add column project_ev numeric(9, 4),
  add column project_sv numeric(9, 4),
  add column project_spi numeric(9, 4),
  add column project_spi_reason text,
  add column coverage_percent numeric(7, 4),
  add column cross_check_max_difference numeric(14, 10),
  add column bl0_finish_date date,
  add column bln_finish_date date,
  add column forecast_finish_date date,
  add column forecast_curve_reason text,
  add column schedule_condition text,
  add column advisories jsonb;

alter table public.planning_snapshots
  add constraint planning_snapshots_source_kind_check
    check (source_kind is null or source_kind in ('manual', 'import_batch')),
  add constraint planning_snapshots_schedule_condition_check
    check (schedule_condition is null or schedule_condition = 'not_evaluated'),
  -- A v2 snapshot carries its complete provenance and figures; a legacy or
  -- Opening Position snapshot carries none of them.
  add constraint planning_snapshots_v2_shape check (
    engine_version is null
    or (data_date is not null and bl0_baseline_id is not null and bln_baseline_id is not null
        and published_by_user_id is not null and source_kind is not null
        and working_plan_fingerprint is not null
        and project_pv is not null and project_ev is not null and project_sv is not null
        and (project_spi is null) = (project_spi_reason is not null)
        and coverage_percent is not null and schedule_condition = 'not_evaluated'
        and not is_opening_snapshot and source_opening_position_id is null
        and (source_kind = 'import_batch') = (source_import_batch_id is not null)));

comment on column public.planning_snapshots.engine_version is
  '13.12. The Planning Engine version that calculated this snapshot. Null = legacy calculation (published before 13.12) or an Opening Position.';
comment on column public.planning_snapshots.schedule_condition is
  '13.12 (§26.25 D-C). "not_evaluated" — thresholds pending B4. Its inputs (SPI, milestone slips, forecast vs BLn finish) are frozen; 13.14 derives the condition from them. Never updated.';

/* ------------------------------------------------------------------------ */
/* 2. Frozen activities (extends the existing table), nodes, milestones,     */
/*    curve points                                                           */
/* ------------------------------------------------------------------------ */

-- The existing legacy columns keep their meaning (a faithful copy of the
-- Working Plan row); the v2 columns hold the engine's view of the activity.
alter table public.planning_snapshot_activities
  add column item_position integer,
  add column earning_method text,
  add column local_weight numeric(9, 4),
  add column effective_weight numeric(14, 10),
  add column pv numeric(9, 4),
  add column ev numeric(9, 4),
  add column sv numeric(9, 4),
  add column pv_contribution numeric(14, 10),
  add column ev_contribution numeric(14, 10),
  add column bl0_start_date date,
  add column bl0_finish_date date,
  add column bln_start_date date,
  add column bln_finish_date date,
  add column department_id uuid,
  add column system_id uuid,
  add column discipline_id uuid,
  add column structure_node_id uuid;

create table public.planning_snapshot_nodes (
  snapshot_id uuid not null references public.planning_snapshots(id) on delete cascade,
  source_work_item_id uuid not null,
  parent_work_item_id uuid,
  item_position integer not null,
  depth integer not null check (depth >= 1),
  code text,
  name text not null,
  item_type text,
  is_control_account boolean not null default false,
  local_weight numeric(9, 4) not null,
  effective_weight numeric(14, 10) not null,
  pv numeric(9, 4) not null,
  ev numeric(9, 4) not null,
  sv numeric(9, 4) not null,
  spi numeric(9, 4),
  spi_reason text,
  pv_contribution numeric(14, 10) not null,
  ev_contribution numeric(14, 10) not null,
  department_id uuid,
  system_id uuid,
  discipline_id uuid,
  structure_node_id uuid,
  schedule_condition text not null default 'not_evaluated' check (schedule_condition = 'not_evaluated'),
  primary key (snapshot_id, source_work_item_id),
  check ((spi is null) = (spi_reason is not null))
);
comment on table public.planning_snapshot_nodes is
  '13.12 (§26.8 Snapshot Node). The frozen WBS roll-up of a v2 snapshot: per node, local and effective weight, PV, EV, SV, SPI, contributions, Control Account flag and reporting-unit mapping. Written once by the trusted writer; never updated or deleted.';

create table public.planning_snapshot_milestones (
  snapshot_id uuid not null references public.planning_snapshots(id) on delete cascade,
  source_activity_id uuid not null,
  code text,
  name text not null,
  is_key boolean not null default false,
  bl0_date date,
  bln_date date,
  forecast_date date,
  actual_date date,
  status text not null check (status in ('achieved', 'overdue', 'upcoming', 'unscheduled')),
  slip_vs_bln integer,
  slip_vs_bln_reason text,
  slip_vs_bl0 integer,
  slip_vs_bl0_reason text,
  due boolean not null,
  schedule_condition text not null default 'not_evaluated' check (schedule_condition = 'not_evaluated'),
  primary key (snapshot_id, source_activity_id),
  check ((slip_vs_bln is null) = (slip_vs_bln_reason is not null)),
  check ((slip_vs_bl0 is null) = (slip_vs_bl0_reason is not null))
);
comment on table public.planning_snapshot_milestones is
  '13.12 (§26.8 Snapshot Milestone, true milestones only). BL0 / BLn / forecast / actual dates, slip against each baseline (never blended) and status at the Data Date. Governed-milestone linkage and the key flag arrive with 13.15. Never updated or deleted.';

create table public.planning_snapshot_curve_points (
  snapshot_id uuid not null references public.planning_snapshots(id) on delete cascade,
  curve_kind text not null check (curve_kind in ('forecast')),
  point_date date not null,
  value numeric(9, 4) not null check (value >= 0 and value <= 100.0001),
  primary key (snapshot_id, curve_kind, point_date)
);
comment on table public.planning_snapshot_curve_points is
  '13.12 (§26.7). The snapshot''s own current / forecast curve (cumulative % of the project). The baseline curves live with their Baseline Revisions; the earned point is the header''s Data Date and project EV. Never updated or deleted.';

-- Visibility exactly as the snapshot's activities.
alter table public.planning_snapshot_nodes enable row level security;
alter table public.planning_snapshot_milestones enable row level security;
alter table public.planning_snapshot_curve_points enable row level security;
create policy planning_snapshot_nodes_select on public.planning_snapshot_nodes for select to authenticated
  using (public.can_access_project(public.planning_snapshot_project(snapshot_id)) or public.has_published_portfolio_read());
create policy planning_snapshot_milestones_select on public.planning_snapshot_milestones for select to authenticated
  using (public.can_access_project(public.planning_snapshot_project(snapshot_id)) or public.has_published_portfolio_read());
create policy planning_snapshot_curve_points_select on public.planning_snapshot_curve_points for select to authenticated
  using (public.can_access_project(public.planning_snapshot_project(snapshot_id)) or public.has_published_portfolio_read());
revoke insert, update, delete on public.planning_snapshot_nodes, public.planning_snapshot_milestones,
  public.planning_snapshot_curve_points from anon, authenticated;
grant select on public.planning_snapshot_nodes, public.planning_snapshot_milestones,
  public.planning_snapshot_curve_points to authenticated;

/* ------------------------------------------------------------------------ */
/* 3. Close every client path that could fabricate a snapshot                */
/* ------------------------------------------------------------------------ */

drop policy if exists planning_snapshots_insert on public.planning_snapshots;
drop policy if exists planning_snapshot_activities_insert on public.planning_snapshot_activities;
revoke insert, update, delete on public.planning_snapshots, public.planning_snapshot_activities from anon, authenticated;

/* ------------------------------------------------------------------------ */
/* 4. Immutability                                                           */
/* ------------------------------------------------------------------------ */

-- Snapshot rows are written once and never change. The only update ever
-- allowed is a foreign key's ON DELETE SET NULL on a traceability column
-- (the Working Plan row it came from was removed) — never a figure.
create function public.guard_planning_snapshot_row()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_trace text[];
  v_snapshot uuid;
  v_project uuid;
begin
  if tg_op = 'UPDATE' then
    v_trace := case tg_table_name
      when 'planning_snapshots' then array['baseline_id', 'source_import_batch_id', 'source_opening_position_id',
                                           'published_by_contact_id', 'published_by_user_id']
      when 'planning_snapshot_activities' then array['source_activity_id', 'source_work_item_id']
      else array[]::text[] end;
    if (to_jsonb(old) - v_trace) = (to_jsonb(new) - v_trace)
       and not exists (select 1 from unnest(v_trace) k
                        where (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k)
                          and (to_jsonb(new) -> k) <> 'null'::jsonb) then
      return new;
    end if;
    raise exception '[SNAPSHOT_IMMUTABLE] A Published Planning Snapshot never changes. Publish a new snapshot instead.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    -- The one exception: cascading with its snapshot, which goes only when the
    -- whole project is deleted (13.9 lifecycle). The snapshot row is gone by now.
    if tg_table_name in ('planning_snapshot_nodes', 'planning_snapshot_milestones', 'planning_snapshot_curve_points')
       and exists (select 1 from public.planning_snapshots where id = old.snapshot_id) then
      raise exception '[SNAPSHOT_IMMUTABLE] A Published Planning Snapshot is never deleted.' using errcode = '42501';
    end if;
    return old;
  end if;
  -- INSERT into a v2 child table: only inside the trusted writer, never on an archived project.
  if coalesce(current_setting('eprp.snapshot_publish', true), '') <> 'on' then
    raise exception '[SNAPSHOT_IMMUTABLE] Snapshot rows are written only by the governed publish.' using errcode = '42501';
  end if;
  v_snapshot := new.snapshot_id;
  v_project := public.planning_snapshot_project(v_snapshot);
  if public.project_is_archived(v_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.guard_planning_snapshot_row() from public, anon, authenticated;

create trigger guard_planning_snapshot_row before update on public.planning_snapshots
  for each row execute function public.guard_planning_snapshot_row();
create trigger guard_planning_snapshot_row before update on public.planning_snapshot_activities
  for each row execute function public.guard_planning_snapshot_row();
create trigger guard_planning_snapshot_row before insert or update or delete on public.planning_snapshot_nodes
  for each row execute function public.guard_planning_snapshot_row();
create trigger guard_planning_snapshot_row before insert or update or delete on public.planning_snapshot_milestones
  for each row execute function public.guard_planning_snapshot_row();
create trigger guard_planning_snapshot_row before insert or update or delete on public.planning_snapshot_curve_points
  for each row execute function public.guard_planning_snapshot_row();

/* ------------------------------------------------------------------------ */
/* 5. The read the server runs before the engine (as the user)               */
/* ------------------------------------------------------------------------ */

-- One statement, so one consistent read: everything the publish and the
-- baseline request hand to the adapter and the engine, plus the Working Plan
-- identity the writer compares again. SECURITY INVOKER: the caller's own RLS.
create function public.planning_publish_inputs(p_project uuid)
returns jsonb language sql stable security invoker set search_path = '' as $fn$
  select jsonb_build_object(
    'fingerprint', public.planning_working_plan_fingerprint(p_project),
    'project', (select jsonb_build_object('id', p.id, 'code', p.code, 'structure_family', p.structure_family,
                                          'working_week', p.working_week, 'weekly_reporting_day', p.weekly_reporting_day,
                                          'status', p.status)
                  from public.projects p where p.id = p_project),
    'settings', (select to_jsonb(s) from public.project_planning_settings s where s.project_id = p_project),
    'work_items', coalesce((select jsonb_agg(to_jsonb(w) order by w.sort_order, w.code)
                              from public.planning_work_items w where w.project_id = p_project and w.active), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(to_jsonb(a) order by a.code, a.id)
                              from public.planning_activities a where a.project_id = p_project and a.active), '[]'::jsonb),
    'baselines', coalesce((select jsonb_agg(jsonb_build_object(
                              'id', b.id, 'revision_number', b.revision_number, 'revision_kind', b.revision_kind,
                              'decided_at', b.decided_at, 'capture', b.capture) order by b.revision_number)
                             from public.planning_baselines b
                            where b.project_id = p_project and b.revision_status = 'approved'), '[]'::jsonb),
    'controlled_since', public.project_setup_controlled_since(p_project)
  )
$fn$;
revoke execute on function public.planning_publish_inputs(uuid) from public, anon;
grant execute on function public.planning_publish_inputs(uuid) to authenticated;

/* ------------------------------------------------------------------------ */
/* 6. The trusted writer (server-only)                                       */
/* ------------------------------------------------------------------------ */

create function public.publish_planning_snapshot_v2(
  p_actor uuid,
  p_project uuid,
  p_payload jsonb,
  p_confirm_setup_control boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_settings public.project_planning_settings;
  v_data_date date := nullif(p_payload ->> 'data_date', '')::date;
  v_batch uuid := nullif(p_payload ->> 'source_import_batch_id', '')::uuid;
  v_batch_row public.planning_import_batches;
  v_engine text := nullif(btrim(coalesce(p_payload ->> 'engine_version', '')), '');
  v_bl0 public.planning_baselines;
  v_bln public.planning_baselines;
  v_problem text;
  v_version integer;
  v_snapshot uuid;
  v_snapshot_data jsonb;
  v_edits integer;
  v_high_water timestamptz;
  v_since timestamptz;
  v_project_figures jsonb := p_payload -> 'project';
begin
  /* ---- who: the requesting user, never the service role ---- */
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and active) then
    raise exception '[NOT_AUTHORIZED] Sign in to publish.' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  if not public.can_manage_project_operations(p_project) then
    raise exception 'Publishing a Planning Snapshot requires Project Control authority on this project.'
      using errcode = 'insufficient_privilege';
  end if;

  /* ---- same lock order as every planning and setup writer ---- */
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);

  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;
  select * into v_settings from public.project_planning_settings where project_id = p_project;
  if coalesce(v_settings.onboarding_mode, 'new_project') = 'no_formal_schedule' then
    raise exception '[NO_FORMAL_SCHEDULE] This project is planned without a formal schedule. Change how it is planned before publishing a Planning Snapshot or promoting an Opening Position.'
      using errcode = 'check_violation';
  end if;
  if not public.project_setup_controlled(p_project)
     and coalesce(p_confirm_setup_control, false) is distinct from true then
    raise exception '[SETUP_CONTROL_CONFIRMATION_REQUIRED] Publishing the first Planning Snapshot makes Project Setup controlled. Confirm this to publish.'
      using errcode = '22023';
  end if;

  /* ---- the Working Plan the engine read is the Working Plan now ---- */
  if nullif(p_payload ->> 'fingerprint', '') is null
     or (p_payload ->> 'fingerprint') is distinct from public.planning_working_plan_fingerprint(p_project) then
    raise exception '[STALE_WORKING_PLAN] The Working Plan changed while the snapshot was being calculated. Nothing was published — publish again.'
      using errcode = 'PT409';
  end if;

  /* ---- baselines: an approved BL0, and the current BLn ---- */
  select * into v_bl0 from public.planning_baselines
   where project_id = p_project and revision_status = 'approved' and revision_number = 0;
  if v_bl0.id is null then
    raise exception '[NO_APPROVED_BL0] Publishing needs an approved original baseline (BL0). Request it in Baselines & Snapshots; another Project Control Admin or System Administrator approves it.'
      using errcode = '22023';
  end if;
  select * into v_bln from public.planning_baselines
   where project_id = p_project and revision_status = 'approved'
   order by revision_number desc limit 1;
  if (p_payload ->> 'bl0_baseline_id') is distinct from v_bl0.id::text
     or (p_payload ->> 'bln_baseline_id') is distinct from v_bln.id::text then
    raise exception '[BASELINE_CHANGED] The approved baselines changed while the snapshot was being calculated. Nothing was published — publish again.'
      using errcode = 'PT409';
  end if;

  /* ---- Data Date and source ---- */
  if v_data_date is null then
    raise exception 'A Data Date is required to publish. Enter the schedule''s Data Date before publishing.'
      using errcode = 'check_violation';
  end if;
  if v_batch is not null then
    select * into v_batch_row from public.planning_import_batches where id = v_batch for update;
    if v_batch_row.id is null or v_batch_row.project_id <> p_project then
      raise exception '[INVALID_SOURCE] This import batch does not belong to the project being published.'
        using errcode = 'foreign_key_violation';
    end if;
    if v_batch_row.status = 'published' then
      raise exception 'This import batch has already been published. Import a new batch to publish again.'
        using errcode = 'restrict_violation';
    end if;
    if v_batch_row.status <> 'validated' then
      raise exception '[INVALID_SOURCE] Only a validated import batch can be the source of a snapshot.'
        using errcode = 'check_violation';
    end if;
    if v_batch_row.data_date is distinct from v_data_date then
      raise exception '[INVALID_SOURCE] The Data Date must be the import batch''s own Data Date.'
        using errcode = 'check_violation';
    end if;
  end if;
  if v_engine is null then
    raise exception '[INVALID_SNAPSHOT] The calculation carries no engine version.' using errcode = '22023';
  end if;

  /* ---- new scope reaches PV only through an approved re-baseline ---- */
  select string_agg(coalesce(a.code, a.external_id, a.name), ', ' order by a.code) into v_problem
    from public.planning_activities a
   where a.project_id = p_project and a.active
     and not exists (select 1 from jsonb_array_elements(v_bln.capture -> 'activities') c
                      where (c ->> 'id')::uuid = a.id);
  if v_problem is not null then
    raise exception '[NEW_SCOPE_NOT_BASELINED] Not in the current approved baseline (BL%): %. New scope reaches the plan only through an approved re-baseline.',
      v_bln.revision_number, left(v_problem, 300) using errcode = '22023';
  end if;

  /* ---- every engine input in the payload is the stored Working Plan ---- */
  -- Activities: exactly the active ones, with their stored weights, dates and
  -- progress, and the BLn / BL0 dates of the referenced revisions.
  with p as (
    select * from jsonb_to_recordset(coalesce(p_payload -> 'activities', '[]'::jsonb)) as x(
      activity_id uuid, work_item_id uuid, local_weight numeric, percent_complete numeric,
      forecast_start date, forecast_finish date, actual_start date, actual_finish date,
      bln_start date, bln_finish date, bl0_start date, bl0_finish date)
  ), live as (
    select a.* from public.planning_activities a where a.project_id = p_project and a.active
  ), bln as (
    select (c ->> 'id')::uuid as id, (c ->> 'start')::date as s, (c ->> 'finish')::date as f
      from jsonb_array_elements(v_bln.capture -> 'activities') c
  ), bl0 as (
    select (c ->> 'id')::uuid as id, (c ->> 'start')::date as s, (c ->> 'finish')::date as f
      from jsonb_array_elements(v_bl0.capture -> 'activities') c
  )
  select string_agg(coalesce(l.code, p.activity_id::text), ', ') into v_problem
    from p full join live l on l.id = p.activity_id
    left join bln on bln.id = l.id
    left join bl0 on bl0.id = l.id
   where l.id is null or p.activity_id is null
      or p.work_item_id is distinct from l.work_item_id
      or p.local_weight is distinct from l.local_weight_percent
      or p.percent_complete is distinct from l.percent_complete_physical
      or p.forecast_start is distinct from l.planned_start_date
      or p.forecast_finish is distinct from l.planned_finish_date
      or p.actual_start is distinct from l.actual_start_date
      or p.actual_finish is distinct from l.actual_finish_date
      or p.bln_start is distinct from bln.s or p.bln_finish is distinct from bln.f
      or p.bl0_start is distinct from bl0.s or p.bl0_finish is distinct from bl0.f;
  if v_problem is not null then
    raise exception '[STALE_WORKING_PLAN] The calculation does not match the stored Working Plan (%). Nothing was published — publish again.',
      left(v_problem, 200) using errcode = 'PT409';
  end if;

  with p as (
    select * from jsonb_to_recordset(coalesce(p_payload -> 'nodes', '[]'::jsonb)) as x(
      work_item_id uuid, parent_id uuid, local_weight numeric)
  ), live as (
    select w.* from public.planning_work_items w where w.project_id = p_project and w.active
  )
  select string_agg(coalesce(l.code, p.work_item_id::text), ', ') into v_problem
    from p full join live l on l.id = p.work_item_id
   where l.id is null or p.work_item_id is null
      or p.parent_id is distinct from l.parent_work_item_id
      or p.local_weight is distinct from l.local_weight_percent;
  if v_problem is not null then
    raise exception '[STALE_WORKING_PLAN] The calculation does not match the stored Working Plan (%). Nothing was published — publish again.',
      left(v_problem, 200) using errcode = 'PT409';
  end if;

  /* ---- the result is a complete engine result (range checks only) ---- */
  if v_project_figures is null
     or (v_project_figures ->> 'pv') is null or (v_project_figures ->> 'ev') is null
     or (v_project_figures ->> 'pv')::numeric not between 0 and 100.0001
     or (v_project_figures ->> 'ev')::numeric not between 0 and 100.0001
     or coalesce((p_payload ->> 'cross_check_max_difference')::numeric, 1) > 0.001
     or coalesce((p_payload ->> 'coverage_percent')::numeric, 0) <> 100
     or exists (select 1
                  from (select n as e from jsonb_array_elements(coalesce(p_payload -> 'nodes', '[]'::jsonb)) n
                        union all
                        select a as e from jsonb_array_elements(coalesce(p_payload -> 'activities', '[]'::jsonb)) a) z
                 where (e ->> 'pv') is null or (e ->> 'ev') is null
                    or (e ->> 'pv')::numeric not between 0 and 100.0001
                    or (e ->> 'ev')::numeric not between 0 and 100.0001) then
    raise exception '[INVALID_SNAPSHOT] The calculation is incomplete. Nothing was published.' using errcode = '22023';
  end if;

  /* ---- provenance: Project Control edits logged after the source ---- */
  v_since := coalesce(
    v_batch_row.validated_at, v_batch_row.uploaded_at,
    (select max(coalesce(b.validated_at, b.uploaded_at)) from public.planning_import_batches b
      where b.project_id = p_project and b.status = 'published'),
    '-infinity'::timestamptz);
  select count(*) filter (where c.action in ('edit', 'normalise') and c.confirmed_at > v_since),
         max(c.confirmed_at)
    into v_edits, v_high_water
    from public.planning_confirmations c
   where coalesce(public.planning_work_item_project(c.work_item_id),
                  public.planning_activity_project(c.activity_id)) = p_project;

  /* ---- write once ---- */
  select coalesce(max(version), 0) + 1 into v_version from public.planning_snapshots where project_id = p_project;

  -- The same Working Plan archive the legacy publish keeps.
  select jsonb_build_object(
    'work_items', coalesce((select jsonb_agg(to_jsonb(wi) order by wi.sort_order, wi.code)
                              from public.planning_work_items wi where wi.project_id = p_project and wi.active), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(to_jsonb(a) order by a.work_item_id, a.code)
                              from public.planning_activities a where a.project_id = p_project and a.active), '[]'::jsonb),
    'milestone_links', coalesce((select jsonb_agg(to_jsonb(l)) from public.planning_milestone_links l
                                  where l.master_milestone_id in (select id from public.master_milestones where project_id = p_project)), '[]'::jsonb),
    'opening_position', null
  ) into v_snapshot_data;

  perform set_config('eprp.snapshot_publish', 'on', true);

  insert into public.planning_snapshots (
    project_id, version, source_import_batch_id, is_opening_snapshot, label, data_date, snapshot_data,
    published_by_contact_id, published_by_user_id,
    engine_version, bl0_baseline_id, bln_baseline_id, source_kind, working_plan_fingerprint,
    configuration_updated_at, edits_since_source, edits_high_water_at,
    project_pv, project_ev, project_sv, project_spi, project_spi_reason,
    coverage_percent, cross_check_max_difference,
    bl0_finish_date, bln_finish_date, forecast_finish_date, forecast_curve_reason,
    schedule_condition, advisories
  ) values (
    p_project, v_version, v_batch, false, nullif(btrim(coalesce(p_payload ->> 'label', '')), ''), v_data_date, v_snapshot_data,
    public.current_contact_id(), p_actor,
    v_engine, v_bl0.id, v_bln.id, case when v_batch is null then 'manual' else 'import_batch' end, p_payload ->> 'fingerprint',
    v_settings.updated_at, v_edits, v_high_water,
    (v_project_figures ->> 'pv')::numeric, (v_project_figures ->> 'ev')::numeric, (v_project_figures ->> 'sv')::numeric,
    (v_project_figures ->> 'spi')::numeric, nullif(v_project_figures ->> 'spi_reason', ''),
    (p_payload ->> 'coverage_percent')::numeric, (p_payload ->> 'cross_check_max_difference')::numeric,
    nullif(p_payload #>> '{finish,bl0_finish}', '')::date, nullif(p_payload #>> '{finish,bln_finish}', '')::date,
    nullif(p_payload #>> '{finish,forecast_finish}', '')::date, nullif(p_payload ->> 'forecast_curve_reason', ''),
    'not_evaluated', coalesce(p_payload -> 'advisories', '[]'::jsonb)
  ) returning id into v_snapshot;

  -- Activities: the legacy columns copied from the Working Plan row (as the
  -- legacy publish does), the v2 columns from the engine result.
  insert into public.planning_snapshot_activities (
    snapshot_id, source_activity_id, source_work_item_id, external_id, code, name,
    is_milestone, planned_start_date, planned_finish_date, baseline_start_date, baseline_finish_date,
    actual_start_date, actual_finish_date, remaining_duration_days,
    percent_complete_planned, percent_complete_actual, percent_complete_physical,
    weight_percent, status, planned_value, earned_value,
    item_position, earning_method, local_weight, effective_weight, pv, ev, sv, pv_contribution, ev_contribution,
    bl0_start_date, bl0_finish_date, bln_start_date, bln_finish_date,
    department_id, system_id, discipline_id, structure_node_id
  )
  select v_snapshot, a.id, a.work_item_id, a.external_id, a.code, a.name,
         a.is_milestone, a.planned_start_date, a.planned_finish_date, a.baseline_start_date, a.baseline_finish_date,
         a.actual_start_date, a.actual_finish_date, a.remaining_duration_days,
         a.percent_complete_planned, a.percent_complete_actual, a.percent_complete_physical,
         a.weight_percent, a.status, a.planned_value, a.earned_value,
         x.item_position, x.earning_method, x.local_weight, x.effective_weight, x.pv, x.ev, x.sv, x.pv_contribution, x.ev_contribution,
         x.bl0_start, x.bl0_finish, x.bln_start, x.bln_finish,
         x.department_id, x.system_id, x.discipline_id, x.structure_node_id
    from jsonb_to_recordset(p_payload -> 'activities') as x(
           activity_id uuid, item_position integer, earning_method text, local_weight numeric, effective_weight numeric,
           pv numeric, ev numeric, sv numeric, pv_contribution numeric, ev_contribution numeric,
           bl0_start date, bl0_finish date, bln_start date, bln_finish date,
           department_id uuid, system_id uuid, discipline_id uuid, structure_node_id uuid)
    join public.planning_activities a on a.id = x.activity_id;

  insert into public.planning_snapshot_nodes (
    snapshot_id, source_work_item_id, parent_work_item_id, item_position, depth, code, name, item_type,
    is_control_account, local_weight, effective_weight, pv, ev, sv, spi, spi_reason,
    pv_contribution, ev_contribution, department_id, system_id, discipline_id, structure_node_id
  )
  select v_snapshot, x.work_item_id, x.parent_id, x.item_position, x.depth, w.code, w.name, w.item_type,
         coalesce(x.is_control_account, false), x.local_weight, x.effective_weight, x.pv, x.ev, x.sv, x.spi, x.spi_reason,
         x.pv_contribution, x.ev_contribution, x.department_id, x.system_id, x.discipline_id, x.structure_node_id
    from jsonb_to_recordset(coalesce(p_payload -> 'nodes', '[]'::jsonb)) as x(
           work_item_id uuid, parent_id uuid, item_position integer, depth integer, is_control_account boolean,
           local_weight numeric, effective_weight numeric, pv numeric, ev numeric, sv numeric,
           spi numeric, spi_reason text, pv_contribution numeric, ev_contribution numeric,
           department_id uuid, system_id uuid, discipline_id uuid, structure_node_id uuid)
    join public.planning_work_items w on w.id = x.work_item_id;

  insert into public.planning_snapshot_milestones (
    snapshot_id, source_activity_id, code, name, is_key, bl0_date, bln_date, forecast_date, actual_date,
    status, slip_vs_bln, slip_vs_bln_reason, slip_vs_bl0, slip_vs_bl0_reason, due
  )
  select v_snapshot, x.activity_id, a.code, a.name, coalesce(x.is_key, false), x.bl0_date, x.bln_date, x.forecast_date,
         x.actual_date, x.status, x.slip_vs_bln, x.slip_vs_bln_reason, x.slip_vs_bl0, x.slip_vs_bl0_reason, x.due
    from jsonb_to_recordset(coalesce(p_payload -> 'milestones', '[]'::jsonb)) as x(
           activity_id uuid, is_key boolean, bl0_date date, bln_date date, forecast_date date, actual_date date,
           status text, slip_vs_bln integer, slip_vs_bln_reason text, slip_vs_bl0 integer, slip_vs_bl0_reason text,
           due boolean)
    join public.planning_activities a on a.id = x.activity_id and a.project_id = p_project and a.active and a.is_milestone;

  insert into public.planning_snapshot_curve_points (snapshot_id, curve_kind, point_date, value)
  select v_snapshot, 'forecast', (pt ->> 'date')::date, round((pt ->> 'value')::numeric, 4)
    from jsonb_array_elements(coalesce(p_payload -> 'forecast_curve', '[]'::jsonb)) pt;

  if v_batch is not null then
    update public.planning_import_batches set status = 'published' where id = v_batch;
  end if;

  perform set_config('eprp.snapshot_publish', '', true);
  -- The caller identity applies to this call only.
  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  return v_snapshot;
end;
$fn$;
revoke execute on function public.publish_planning_snapshot_v2(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.publish_planning_snapshot_v2(uuid, uuid, jsonb, boolean) to service_role;
comment on function public.publish_planning_snapshot_v2(uuid, uuid, jsonb, boolean) is
  '13.12 (§26.25 D-A). Server-only trusted writer of a Published Planning Snapshot v2. Evaluated AS p_actor: Project Control authority, archived, no formal schedule, first-publish confirmation, Data Date and source, approved BL0 and current BLn, Working Plan unchanged (PT409), new scope only via re-baseline, payload inputs equal to the stored Working Plan and baselines. Freezes the engine result; calculates nothing.';

/* ------------------------------------------------------------------------ */
/* 7. The legacy publish: Opening Position promotion only (D-D)              */
/* ------------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.publish_planning_snapshot(p_project_id uuid, p_import_batch_id uuid DEFAULT NULL::uuid, p_baseline_id uuid DEFAULT NULL::uuid, p_is_opening_snapshot boolean DEFAULT false, p_label text DEFAULT NULL::text, p_opening_position_id uuid DEFAULT NULL::uuid, p_data_date date DEFAULT NULL::date, p_confirm_setup_control boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- 13.12 (§26.25 D-D): the legacy publish is retired for every normal
  -- publish. Only an Opening Position promotion still runs here, unchanged;
  -- every other publish is v2 (the Planning Engine on the server and the
  -- trusted writer publish_planning_snapshot_v2()).
  if p_opening_position_id is null then
    raise exception
      '[V2_PUBLISH_REQUIRED] Planning Snapshots are now calculated by the Planning Engine. Publish from Planning Workspace → Baselines & Snapshots.'
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

/* ------------------------------------------------------------------------ */
/* 8. Post-checks                                                            */
/* ------------------------------------------------------------------------ */

do $post$
begin
  if exists (select 1 from pg_policies
              where tablename in ('planning_snapshots', 'planning_snapshot_activities', 'planning_snapshot_nodes',
                                  'planning_snapshot_milestones', 'planning_snapshot_curve_points')
                and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')) then
    raise exception '13.12 post-check failed: a client write policy exists on a snapshot table.';
  end if;
  if has_function_privilege('authenticated', 'public.publish_planning_snapshot_v2(uuid, uuid, jsonb, boolean)', 'execute') then
    raise exception '13.12 post-check failed: publish_planning_snapshot_v2() is client-callable.';
  end if;
  if exists (select 1 from public.planning_snapshots where engine_version is not null) then
    raise exception '13.12 post-check failed: an existing snapshot was not left as legacy.';
  end if;
end;
$post$;
