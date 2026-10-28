-- Phase 13.12 (1/2) — Baseline Revisions (BL0 / BLn) and the approved-BL0 anchor.
--
-- docs/02 §26.6, §26.8, §26.19 (B3, B8 closed 2026-10-22), §26.25;
-- docs/06 §10A.5; docs/05 §3.8.
--
-- * `planning_baselines` is hardened in place into Baseline Revisions:
--   requested → approved | rejected | withdrawn, numbered BL0, BL1, … on
--   approval. Rows that existed before 13.12 are read as `legacy` named
--   captures — kept, readable, never an approved baseline, never an anchor.
-- * A revision is CAPTURED when it is requested: the dates and local weights
--   of every active node and activity, copied here from the Working Plan (no
--   calculation), plus its baseline curve, calculated by the Planning Engine
--   on the server (request_planning_baseline() is server-only, like the v2
--   publish writer). From then on the capture never changes; approval freezes
--   exactly what was reviewed.
-- * B3 / B8: another Project Control Admin or System Administrator decides;
--   the requester never does, whatever their role. No override.
-- * BLn = the latest approved revision; BL0 = revision 0. Derived, never
--   flagged.
-- * The approved BL0 is a Project Setup governance anchor
--   (project_setup_controlled_since()) and supersedes Planned Start /
--   Planned Finish (§26.24.2): nobody edits or amends them afterwards.
-- * No import creates or changes a baseline: nothing here is reachable from
--   the import path, and the direct client INSERT on planning_baselines is
--   removed.
--
-- Additive. No existing row is rewritten.

/* ------------------------------------------------------------------------ */
/* 1. Baseline Revision columns                                              */
/* ------------------------------------------------------------------------ */

alter table public.planning_baselines
  add column revision_status text not null default 'legacy',
  add column revision_number integer,
  add column revision_kind text,
  add column reason text,
  add column requested_by_user_id uuid references public.profiles(id) on delete set null,
  add column requested_by_contact_id uuid references public.contacts(id) on delete set null,
  add column requested_at timestamptz,
  add column decided_by_user_id uuid references public.profiles(id) on delete set null,
  add column decided_by_contact_id uuid references public.contacts(id) on delete set null,
  add column decided_at timestamptz,
  add column decision_comment text,
  add column capture jsonb,
  add column capture_fingerprint text,
  add column curve_engine_version text;

-- Existing rows read as `legacy`. The default stays `legacy`: a row inserted
-- outside the revision functions below can only ever be a legacy named
-- capture (the shape check forbids it any revision fact), never a revision.

alter table public.planning_baselines
  add constraint planning_baselines_revision_status_check
    check (revision_status in ('legacy', 'requested', 'approved', 'rejected', 'withdrawn')),
  add constraint planning_baselines_revision_kind_check
    check (revision_kind is null or revision_kind in ('original', 'rebaseline')),
  -- A legacy capture carries none of the revision facts; a revision carries all of its request facts.
  add constraint planning_baselines_revision_request_shape check (
    (revision_status = 'legacy'
       and requested_at is null and reason is null and capture is null and revision_number is null)
    or (revision_status <> 'legacy'
       and requested_at is not null and requested_by_user_id is not null
       and reason is not null and btrim(reason) <> '' and capture is not null
       and capture_fingerprint is not null and curve_engine_version is not null)),
  -- Approved ⇔ numbered and decided; BL0 is the original, every later one a re-baseline.
  add constraint planning_baselines_revision_approved_shape check (
    (revision_status = 'approved')
      = (revision_number is not null and revision_kind is not null and decided_at is not null)),
  add constraint planning_baselines_revision_number_kind check (
    revision_number is null
    or (revision_number >= 0 and (revision_number = 0) = (revision_kind = 'original'))),
  add constraint planning_baselines_revision_decided_shape check (
    revision_status not in ('approved', 'rejected') or decided_by_user_id is not null),
  add constraint planning_baselines_revision_reject_comment check (
    revision_status <> 'rejected' or (decision_comment is not null and btrim(decision_comment) <> ''));

create unique index planning_baselines_revision_number_unique
  on public.planning_baselines (project_id, revision_number) where revision_number is not null;
-- One request awaiting a decision per project at a time.
create unique index planning_baselines_one_pending
  on public.planning_baselines (project_id) where revision_status = 'requested';

comment on column public.planning_baselines.revision_status is
  '13.12. legacy (a pre-13.12 named capture — never an approved baseline) · requested · approved · rejected · withdrawn.';
comment on column public.planning_baselines.capture is
  '13.12. The planning reference captured at request: {nodes:[{id,parent_id,code,name,local_weight,is_control_account}], activities:[{id,work_item_id,code,external_id,name,is_milestone,local_weight,start,finish}]}. Copied from the Working Plan, never calculated; immutable.';

/* ------------------------------------------------------------------------ */
/* 2. Baseline curve points (frozen with the revision)                       */
/* ------------------------------------------------------------------------ */

create table public.planning_baseline_curve_points (
  -- Cascades only when its revision goes — and a revision goes only with its project.
  baseline_id uuid not null references public.planning_baselines(id) on delete cascade,
  point_date date not null,
  value numeric(9, 4) not null check (value >= 0 and value <= 100.0001),
  primary key (baseline_id, point_date)
);
comment on table public.planning_baseline_curve_points is
  '13.12 (§26.7). The baseline curve of one Baseline Revision on the project''s reporting-day grid: cumulative planned % of the project, calculated by the Planning Engine at request and frozen with the revision. Never updated, never deleted.';

alter table public.planning_baseline_curve_points enable row level security;
-- Visible exactly when its revision is visible (the planning_baselines select policy).
create policy planning_baseline_curve_points_select on public.planning_baseline_curve_points
  for select to authenticated
  using (exists (select 1 from public.planning_baselines b where b.id = baseline_id));
revoke insert, update, delete on public.planning_baseline_curve_points from anon, authenticated;
grant select on public.planning_baseline_curve_points to authenticated;

/* ------------------------------------------------------------------------ */
/* 3. No direct client write path to baselines                               */
/* ------------------------------------------------------------------------ */

-- 13.12: baselines are written only by the governed functions below.
drop policy if exists planning_baselines_insert on public.planning_baselines;
revoke insert, update, delete on public.planning_baselines from anon, authenticated;

/* ------------------------------------------------------------------------ */
/* 4. Immutability                                                           */
/* ------------------------------------------------------------------------ */

-- A legacy capture and a decided revision never change; a request changes
-- once, to its decision, and only through decide / withdraw below.
create function public.guard_planning_baseline_revision()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_decision_keys text[] := array['revision_status', 'revision_number', 'revision_kind', 'name',
                                  'decided_by_user_id', 'decided_by_contact_id', 'decided_at',
                                  'decision_comment'];
begin
  if tg_op = 'DELETE' then
    -- The one exception: the whole project is being deleted (13.9 lifecycle —
    -- an archived project's planning cascades with it). Its row is gone by now.
    if not exists (select 1 from public.projects where id = old.project_id) then
      return old;
    end if;
    raise exception '[BASELINE_IMMUTABLE] A baseline is never deleted.' using errcode = '42501';
  end if;
  if old.revision_status <> 'requested'
     or new.revision_status not in ('approved', 'rejected', 'withdrawn')
     or coalesce(current_setting('eprp.baseline_decision', true), '') <> 'on'
     or (to_jsonb(old) - v_decision_keys) is distinct from (to_jsonb(new) - v_decision_keys) then
    raise exception '[BASELINE_IMMUTABLE] A captured or decided baseline never changes. Request a new Baseline Revision instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.guard_planning_baseline_revision() from public, anon, authenticated;

create trigger guard_planning_baseline_revision
  before update or delete on public.planning_baselines
  for each row execute function public.guard_planning_baseline_revision();

-- Curve points: written once, in the request transaction, for a request on a
-- project that is not archived; never updated or deleted.
create function public.guard_planning_baseline_curve_point()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_baseline public.planning_baselines;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.planning_baselines where id = old.baseline_id) then
    return old;  -- cascading with its revision (only ever with the whole project)
  end if;
  if tg_op <> 'INSERT' then
    raise exception '[BASELINE_IMMUTABLE] A baseline curve is never changed.' using errcode = '42501';
  end if;
  select * into v_baseline from public.planning_baselines where id = new.baseline_id;
  if v_baseline.id is null or v_baseline.revision_status <> 'requested'
     or coalesce(current_setting('eprp.baseline_capture', true), '') <> 'on' then
    raise exception '[BASELINE_IMMUTABLE] A baseline curve is written only with its request.' using errcode = '42501';
  end if;
  if public.project_is_archived(v_baseline.project_id) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.guard_planning_baseline_curve_point() from public, anon, authenticated;

create trigger guard_planning_baseline_curve_point
  before insert or update or delete on public.planning_baseline_curve_points
  for each row execute function public.guard_planning_baseline_curve_point();

-- The 13.11 no-formal-schedule guard also covers planning_baselines. A
-- request still pending when the project's approach changes must remain
-- closable (rejected / withdrawn); nothing else changes.
create or replace function public.guard_no_formal_schedule_planning()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_project uuid;
begin
  -- 13.12: closing a pending Baseline Revision request is always possible.
  -- Nested: OLD and revision_status exist only for an UPDATE of planning_baselines.
  if tg_table_name = 'planning_baselines' then
    if tg_op = 'UPDATE' then
      if old.revision_status = 'requested' and new.revision_status in ('rejected', 'withdrawn') then
        return new;
      end if;
    end if;
  end if;

  case tg_table_name
    when 'planning_work_items', 'planning_activities', 'planning_import_batches',
         'planning_baselines', 'planning_opening_positions' then
      v_project := new.project_id;
    when 'planning_import_rows' then
      v_project := public.planning_import_batch_project(new.batch_id);
    when 'planning_confirmations' then
      v_project := coalesce(public.planning_work_item_project(new.work_item_id),
                            public.planning_activity_project(new.activity_id));
    when 'planning_milestone_links' then
      v_project := public.milestone_project(new.master_milestone_id);
    else
      -- Fail closed: never installed where it cannot resolve a project.
      raise exception 'guard_no_formal_schedule_planning() is not defined for table %', tg_table_name
        using errcode = 'P0001';
  end case;

  if exists (select 1 from public.project_planning_settings s
              where s.project_id = v_project and s.onboarding_mode = 'no_formal_schedule') then
    raise exception '[NOT_PLANNING_GOVERNED] This project has no formal schedule, so its Working Plan, imports and baselines cannot be changed. Change the Planning Approach in Project Setup first.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

/* ------------------------------------------------------------------------ */
/* 5. Working Plan freshness                                                 */
/* ------------------------------------------------------------------------ */

-- One opaque identity of everything a publish or a baseline request reads:
-- the Planning Configuration, the working week and reporting day, every node
-- and activity (with its last change and active state) and the approved
-- revisions. Read at the start of the server's engine run and compared again,
-- under the project lock, before anything is written: a change in between is
-- refused (PT409), never overwritten. Epoch seconds keep it independent of
-- the session time zone.
create function public.planning_working_plan_fingerprint(p_project uuid)
returns text language sql stable security definer set search_path = '' as $fn$
  select case when public.can_access_project(p_project) then md5(concat_ws('|',
    (select concat_ws(',', s.onboarding_mode, array_to_string(s.level_labels, '/'), s.control_account_level,
                      s.weight_source, s.default_earning_method, extract(epoch from s.updated_at))
       from public.project_planning_settings s where s.project_id = p_project),
    (select concat_ws(',', p.working_week, p.weekly_reporting_day) from public.projects p where p.id = p_project),
    (select string_agg(w.id || ':' || extract(epoch from w.updated_at) || ':' || w.active, ',' order by w.id)
       from public.planning_work_items w where w.project_id = p_project),
    (select string_agg(a.id || ':' || extract(epoch from a.updated_at) || ':' || a.active, ',' order by a.id)
       from public.planning_activities a where a.project_id = p_project),
    (select string_agg(b.id::text, ',' order by b.revision_number)
       from public.planning_baselines b where b.project_id = p_project and b.revision_status = 'approved')
  )) end
$fn$;
revoke execute on function public.planning_working_plan_fingerprint(uuid) from public, anon;
grant execute on function public.planning_working_plan_fingerprint(uuid) to authenticated, service_role;

/* ------------------------------------------------------------------------ */
/* 6. Request (server-only), decide, withdraw                                */
/* ------------------------------------------------------------------------ */

-- Server-only (service role). The server verified the caller's session; the
-- database then evaluates every rule AS that user (`request.jwt.claim.sub`
-- for this transaction only), so authority is the user's, never the service
-- role's. The capture is copied here from the Working Plan; only the curve,
-- which only the engine calculates, comes from the server.
create function public.request_planning_baseline(
  p_actor uuid,
  p_project uuid,
  p_reason text,
  p_fingerprint text,
  p_curve jsonb,
  p_engine_version text
) returns public.planning_baselines
language plpgsql security definer set search_path = '' as $fn$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_settings public.project_planning_settings;
  v_capture jsonb;
  v_missing text;
  v_row public.planning_baselines;
  v_points integer;
  v_bad_points integer;
  v_last numeric;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and active) then
    raise exception '[NOT_AUTHORIZED] Sign in to request a baseline.' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  if not public.can_manage_project_operations(p_project) then
    raise exception '[NOT_AUTHORIZED] Project Control authority on this project is required to request a baseline.'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;
  select * into v_settings from public.project_planning_settings where project_id = p_project;
  if v_settings.project_id is null then
    raise exception '[ONBOARDING_NOT_CHOSEN] Decide how the project will be planned in Project Setup first.'
      using errcode = 'P0002';
  end if;
  if v_settings.onboarding_mode = 'no_formal_schedule' then
    raise exception '[NOT_PLANNING_GOVERNED] This project has no formal schedule, so it has no baselines. Change the Planning Approach in Project Setup first.'
      using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception '[REASON_REQUIRED] A reason is required to request a baseline.' using errcode = '22023';
  end if;
  if exists (select 1 from public.planning_baselines
              where project_id = p_project and revision_status = 'requested') then
    raise exception '[BASELINE_REQUEST_PENDING] A baseline request is already awaiting a decision on this project.'
      using errcode = 'PT409';
  end if;
  if p_fingerprint is null or p_fingerprint is distinct from public.planning_working_plan_fingerprint(p_project) then
    raise exception '[STALE_WORKING_PLAN] The Working Plan changed while the baseline was being prepared. Reload and request it again.'
      using errcode = 'PT409';
  end if;
  if p_engine_version is null or btrim(p_engine_version) = '' then
    raise exception '[INVALID_BASELINE] The baseline curve has no engine version.' using errcode = '22023';
  end if;

  -- Every active activity needs its baseline dates (a milestone: one date).
  select string_agg(coalesce(a.code, a.external_id, a.name), ', ' order by a.code) into v_missing
    from public.planning_activities a
   where a.project_id = p_project and a.active
     and (case when a.is_milestone then coalesce(a.planned_finish_date, a.planned_start_date) is null
               else a.planned_start_date is null or a.planned_finish_date is null
                    or a.planned_finish_date < a.planned_start_date end);
  if v_missing is not null then
    raise exception '[BASELINE_DATES_MISSING] Every activity needs its start and finish dates before it can be baselined: %.',
      left(v_missing, 300) using errcode = '22023';
  end if;

  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'parent_id', w.parent_work_item_id, 'code', w.code, 'name', w.name,
               'local_weight', w.local_weight_percent, 'is_control_account', w.is_control_account)
             order by w.sort_order, w.code)
        from public.planning_work_items w where w.project_id = p_project and w.active), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'work_item_id', a.work_item_id, 'code', a.code, 'external_id', a.external_id,
               'name', a.name, 'is_milestone', a.is_milestone, 'local_weight', a.local_weight_percent,
               'start', case when a.is_milestone then coalesce(a.planned_finish_date, a.planned_start_date)
                             else a.planned_start_date end,
               'finish', coalesce(a.planned_finish_date, a.planned_start_date))
             order by a.code, a.id)
        from public.planning_activities a where a.project_id = p_project and a.active), '[]'::jsonb)
  ) into v_capture;
  if jsonb_array_length(v_capture -> 'activities') = 0 then
    raise exception '[BASELINE_EMPTY] There are no activities to baseline yet.' using errcode = '22023';
  end if;

  -- The curve is the engine's; the database only checks it is a curve.
  if p_curve is null or jsonb_typeof(p_curve) <> 'array' or jsonb_array_length(p_curve) = 0 then
    raise exception '[INVALID_BASELINE] The baseline curve is missing.' using errcode = '22023';
  end if;
  select count(*),
         count(*) filter (where (point ->> 'value') is null or (point ->> 'value')::numeric < 0
                                or (point ->> 'value')::numeric > 100.0001 or (point ->> 'date') is null)
    into v_points, v_bad_points
    from jsonb_array_elements(p_curve) as point;
  select (p_curve -> (jsonb_array_length(p_curve) - 1) ->> 'value')::numeric into v_last;
  if v_bad_points > 0 or abs(v_last - 100) > 0.01 then
    raise exception '[INVALID_BASELINE] The baseline curve is not a complete cumulative curve.' using errcode = '22023';
  end if;

  perform set_config('eprp.baseline_capture', 'on', true);
  insert into public.planning_baselines (
    project_id, name, baseline_date, captured_items, created_by_contact_id,
    revision_status, reason, requested_by_user_id, requested_by_contact_id, requested_at,
    capture, capture_fingerprint, curve_engine_version
  ) values (
    p_project, 'Baseline request', current_date, '[]'::jsonb, public.current_contact_id(),
    'requested', v_reason, p_actor, public.current_contact_id(), now(),
    v_capture, p_fingerprint, p_engine_version
  ) returning * into v_row;

  insert into public.planning_baseline_curve_points (baseline_id, point_date, value)
  select v_row.id, (point ->> 'date')::date, round((point ->> 'value')::numeric, 4)
    from jsonb_array_elements(p_curve) as point;
  perform set_config('eprp.baseline_capture', '', true);
  -- The caller identity applies to this call only.
  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  return v_row;
end;
$fn$;
revoke execute on function public.request_planning_baseline(uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.request_planning_baseline(uuid, uuid, text, text, jsonb, text) to service_role;
comment on function public.request_planning_baseline(uuid, uuid, text, text, jsonb, text) is
  '13.12. Server-only: captures a Baseline Revision request (BL0 or a re-baseline) from the Working Plan, with the engine''s baseline curve. Evaluated as p_actor; Project Control authority; archived and no-formal-schedule refused; stale Working Plan refused (PT409); one pending request per project.';

create function public.decide_planning_baseline(
  p_baseline uuid,
  p_decision text,
  p_comment text default null,
  p_confirm_setup_control boolean default false
) returns public.planning_baselines
language plpgsql security definer set search_path = '' as $fn$
declare
  v_project uuid;
  v_row public.planning_baselines;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_number integer;
begin
  if auth.uid() is null or public.current_user_role() is null then
    raise exception '[NOT_AUTHORIZED] Sign in to decide a baseline.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception '[INVALID_DECISION] A decision is approve or reject.' using errcode = '22023';
  end if;
  select project_id into v_project from public.planning_baselines where id = p_baseline;
  if v_project is null then
    raise exception '[NOT_FOUND] Baseline request not found.' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_project::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  select * into v_row from public.planning_baselines where id = p_baseline for update;

  if public.project_is_archived(v_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;
  if v_row.revision_status <> 'requested' then
    raise exception '[BASELINE_NOT_PENDING] This baseline request was already decided or withdrawn.' using errcode = 'PT409';
  end if;
  -- B3 / B8: never the requester, whatever their role. No override.
  if v_row.requested_by_user_id = auth.uid() then
    raise exception '[SELF_APPROVAL] You cannot decide your own baseline request. Another Project Control Admin or System Administrator must decide it.'
      using errcode = '42501';
  end if;
  if public.has_global_operational_authority() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a Project Control Admin or System Administrator can decide a baseline request.'
      using errcode = '42501';
  end if;

  perform set_config('eprp.baseline_decision', 'on', true);
  if p_decision = 'reject' then
    if v_comment is null then
      raise exception '[COMMENT_REQUIRED] A comment is required to reject a baseline request.' using errcode = '22023';
    end if;
    update public.planning_baselines
       set revision_status = 'rejected', decision_comment = v_comment,
           decided_by_user_id = auth.uid(), decided_by_contact_id = public.current_contact_id(), decided_at = now()
     where id = p_baseline
    returning * into v_row;
  else
    if exists (select 1 from public.project_planning_settings s
                where s.project_id = v_project and s.onboarding_mode = 'no_formal_schedule') then
      raise exception '[NOT_PLANNING_GOVERNED] This project has no formal schedule, so it has no baselines.'
        using errcode = '42501';
    end if;
    -- An approved BL0 is a governance anchor (13.9B): the first one needs the explicit confirmation.
    if not public.project_setup_controlled(v_project)
       and coalesce(p_confirm_setup_control, false) is distinct from true then
      raise exception '[SETUP_CONTROL_CONFIRMATION_REQUIRED] Approving the original baseline (BL0) makes Project Setup controlled. Confirm this to approve.'
        using errcode = '22023';
    end if;
    select coalesce(max(revision_number) + 1, 0) into v_number
      from public.planning_baselines where project_id = v_project and revision_status = 'approved';
    update public.planning_baselines
       set revision_status = 'approved', revision_number = v_number,
           revision_kind = case when v_number = 0 then 'original' else 'rebaseline' end,
           name = 'BL' || v_number, decision_comment = v_comment,
           decided_by_user_id = auth.uid(), decided_by_contact_id = public.current_contact_id(), decided_at = now()
     where id = p_baseline
    returning * into v_row;
  end if;
  perform set_config('eprp.baseline_decision', '', true);
  return v_row;
end;
$fn$;
revoke execute on function public.decide_planning_baseline(uuid, text, text, boolean) from public, anon;
grant execute on function public.decide_planning_baseline(uuid, text, text, boolean) to authenticated;
comment on function public.decide_planning_baseline(uuid, text, text, boolean) is
  '13.12 (B3, B8). Approve or reject a Baseline Revision request: another Project Control Admin or System Administrator only — never the requester. Approval numbers it BL0, BL1, …; the first approval (BL0) needs the setup-control confirmation when the project is not yet controlled. Archived refused.';

create function public.withdraw_planning_baseline(p_baseline uuid)
returns public.planning_baselines
language plpgsql security definer set search_path = '' as $fn$
declare
  v_project uuid;
  v_row public.planning_baselines;
begin
  if auth.uid() is null then
    raise exception '[NOT_AUTHORIZED] Sign in to withdraw a baseline request.' using errcode = '42501';
  end if;
  select project_id into v_project from public.planning_baselines where id = p_baseline;
  if v_project is null then
    raise exception '[NOT_FOUND] Baseline request not found.' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_project::text, 0));
  select * into v_row from public.planning_baselines where id = p_baseline for update;
  if public.project_is_archived(v_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;
  if v_row.revision_status <> 'requested' then
    raise exception '[BASELINE_NOT_PENDING] This baseline request was already decided or withdrawn.' using errcode = 'PT409';
  end if;
  if v_row.requested_by_user_id is distinct from auth.uid() then
    raise exception '[NOT_AUTHORIZED] Only the person who requested this baseline can withdraw it.' using errcode = '42501';
  end if;
  perform set_config('eprp.baseline_decision', 'on', true);
  update public.planning_baselines
     set revision_status = 'withdrawn', decided_at = now()
   where id = p_baseline
  returning * into v_row;
  perform set_config('eprp.baseline_decision', '', true);
  return v_row;
end;
$fn$;
revoke execute on function public.withdraw_planning_baseline(uuid) from public, anon;
grant execute on function public.withdraw_planning_baseline(uuid) to authenticated;

/* ------------------------------------------------------------------------ */
/* 7. The approved BL0 as a governance anchor; Superseded by BL0             */
/* ------------------------------------------------------------------------ */

create or replace function public.project_setup_controlled_since(p_project uuid)
returns timestamptz language sql stable security definer set search_path = '' as $fn$
  select least(
    (select min(s.published_at) from public.planning_snapshots s where s.project_id = p_project),
    (select f.finalised_at from public.project_setup_finalisations f where f.project_id = p_project),
    -- 13.12: the approved original baseline (BL0).
    (select b.decided_at from public.planning_baselines b
      where b.project_id = p_project and b.revision_status = 'approved' and b.revision_number = 0));
$fn$;
comment on function public.project_setup_controlled_since(uuid) is
  '13.9B / 13.12. Derived, never stored: the earliest governance anchor — the first Published Planning Snapshot, the Setup Finalisation, or (13.12) the approved BL0.';

create function public.project_has_approved_bl0(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.planning_baselines b
                  where b.project_id = p_project and b.revision_status = 'approved' and b.revision_number = 0);
$fn$;
revoke execute on function public.project_has_approved_bl0(uuid) from public, anon;
grant execute on function public.project_has_approved_bl0(uuid) to authenticated, service_role;

-- The registry's future class `superseded` (13.12) takes effect per project
-- once its BL0 is approved. Additive: the 13.9B guard and amendment request
-- are unchanged; these answer first for the two superseded fields.
create function public.project_setup_effective_field_class(p_project uuid, p_field_key text)
returns text language sql stable security definer set search_path = '' as $fn$
  select case when r.future_class = 'superseded' and r.future_slice = '13.12'
                   and public.project_has_approved_bl0(p_project)
              then 'superseded' else r.field_class end
    from public.project_setup_field_registry() r
   where r.field_key = p_field_key;
$fn$;
revoke execute on function public.project_setup_effective_field_class(uuid, text) from public, anon;
grant execute on function public.project_setup_effective_field_class(uuid, text) to authenticated;

create function public.guard_planned_dates_superseded_by_bl0()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if (new.planned_start_date is distinct from old.planned_start_date
      or new.planned_finish_date is distinct from old.planned_finish_date)
     and public.project_has_approved_bl0(old.id) then
    raise exception '[SETUP_FIELD_SUPERSEDED] Planned Start and Planned Finish are superseded by the approved original baseline (BL0). Dates change only through the Working Plan and a re-baseline.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.guard_planned_dates_superseded_by_bl0() from public, anon, authenticated;
-- "guard_planned_…" sorts before "guard_project_setup_controlled", so this
-- answers first; block_archived_project_setup still answers before both.
create trigger guard_planned_dates_superseded_by_bl0
  before update of planned_start_date, planned_finish_date on public.projects
  for each row execute function public.guard_planned_dates_superseded_by_bl0();

create function public.guard_superseded_setup_amendment()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if public.project_setup_effective_field_class(new.project_id, new.field_key) = 'superseded' then
    raise exception '[SETUP_FIELD_SUPERSEDED] This date is superseded by the approved original baseline (BL0). It changes only through the Working Plan and a re-baseline.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.guard_superseded_setup_amendment() from public, anon, authenticated;
create trigger guard_superseded_setup_amendment
  before insert on public.project_setup_amendments
  for each row execute function public.guard_superseded_setup_amendment();

/* ------------------------------------------------------------------------ */
/* 8. Post-checks                                                            */
/* ------------------------------------------------------------------------ */

do $post$
begin
  if exists (select 1 from pg_policies where tablename = 'planning_baselines' and cmd = 'INSERT') then
    raise exception '13.12 post-check failed: planning_baselines still has a client INSERT policy.';
  end if;
  if exists (select 1 from public.planning_baselines where revision_status <> 'legacy') then
    raise exception '13.12 post-check failed: an existing baseline was not read as legacy.';
  end if;
  if has_function_privilege('authenticated', 'public.request_planning_baseline(uuid, uuid, text, text, jsonb, text)', 'execute') then
    raise exception '13.12 post-check failed: request_planning_baseline() is client-callable.';
  end if;
end;
$post$;
