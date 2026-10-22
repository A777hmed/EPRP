-- Phase 13.11 — Working Plan hardening (supersedes 2C.2). LOCAL ONLY.
--
-- Architecture: docs/02_PLATFORM_ARCHITECTURE.md §26.3 (hierarchy), §26.4
-- (weights, earning methods, W1–W7), §26.10 rule 3 (field ownership), §26.20
-- (Guided / Advanced Planning Setup). Entities: docs/06 §10A.1–§10A.3,
-- §10A.6, §10A.9. Authority: docs/05 §3.8. Roadmap: 15 Phase 13, slice 13.11.
--
-- WHAT THIS ADDS — forward-only and additive; no committed migration is edited
--
--   1. Planning Configuration (project_planning_settings): planning level
--      labels (1–8) and the Control Account level, weight source (EPRP or
--      imported), the project's default earning method. Written through
--      save_planning_configuration(); every change is logged to the new
--      append-only planning_configuration_changes. Onboarding mode is NOT
--      touched here — it stays a Project Setup field governed by 13.9B.
--
--   2. Planning nodes (planning_work_items): a LOCAL weight
--      (local_weight_percent), the Control Account flag, a default earning
--      method for the node's work, and the Other-project reporting-unit
--      mapping (structure_node_id). The PSM mapping columns already exist.
--
--   3. Activities (planning_activities): local weight, earning method
--      (kind stays the existing is_milestone flag: task or true milestone),
--      and a reporting-unit override (PSM columns + structure_node_id).
--
--   4. Logged, explicit weight decisions (W3): record_planning_weight_decision()
--      — proportional rescale, equal split, or adopting a recorded weight as a
--      local weight — written to planning_confirmations, the existing Planning
--      Decision log (06 §10A.6), widened with 'edit' and 'normalise'.
--
--   5. Working Plan change log: every change to a governed Working Plan field
--      is appended to planning_confirmations by trigger, whatever the route.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * weight_percent keeps its stored values and its readers. It is now the
--     RECORDED (as entered / imported, unreviewed) weight: the legacy flat
--     roll-up (lib/planning-rollup.ts) and publish_planning_snapshot() keep
--     reading it exactly as before. Existing weights are never reinterpreted
--     as local weights; a project is reviewed into the local model by an
--     explicit, logged decision (roadmap 13.11 "done when").
--   * publish_planning_snapshot(), the snapshot tables and every consumer
--     (Dashboard, Weekly, Monthly, Executive) — Snapshot v2 is 13.12.
--   * can_manage_project_operations() and every existing RLS policy.
--   * guard_archived_project_planning() and its 16 installs (13.9). The new
--     log table carries its own archived guard (the 13.9B pattern).
--   * No backfill, no data repair: no existing row is written.

/* ========================================================================== */
/* 1. Planning Configuration                                                  */
/* ========================================================================== */

-- Level labels are display data for depths 1..n: trimmed, 1–60 characters,
-- no blanks, at most eight levels (§26.3 H1).
create function public.planning_level_labels_valid(p_labels text[])
returns boolean language sql immutable set search_path = '' as $fn$
  select coalesce(pg_catalog.cardinality(p_labels), 0) <= 8
     and not exists (
       select 1 from pg_catalog.unnest(p_labels) as l(label)
        where l.label is null
           or l.label <> pg_catalog.btrim(l.label)
           or pg_catalog.length(l.label) not between 1 and 60);
$fn$;

alter table public.project_planning_settings
  add column level_labels           text[] not null default '{}',
  add column control_account_level  smallint,
  add column weight_source          text,
  add column default_earning_method text,
  add constraint project_planning_settings_level_labels_valid
    check (public.planning_level_labels_valid(level_labels)),
  add constraint project_planning_settings_control_account_level_valid
    check (control_account_level is null or control_account_level between 1 and 8),
  add constraint project_planning_settings_weight_source_valid
    check (weight_source is null or weight_source in ('eprp', 'imported')),
  add constraint project_planning_settings_default_earning_method_valid
    check (default_earning_method is null
           or default_earning_method in ('percent_complete', 'zero_hundred', 'fifty_fifty', 'milestone'));

comment on column public.project_planning_settings.level_labels is
  '13.11. The project''s planning level labels, depth 1 first (max 8). Display only: depth is derived from the node hierarchy, never stored.';
comment on column public.project_planning_settings.control_account_level is
  '13.11. The level at which performance is normally reported and explained (§26.3 H2). A default only: the per-node Control Account flag is authoritative.';
comment on column public.project_planning_settings.weight_source is
  '13.11. Where local weights are managed (§26.4 W7): eprp, or imported (imported weights are proposals accepted into EPRP). Changing it after local weights exist needs a reason.';
comment on column public.project_planning_settings.default_earning_method is
  '13.11. The project''s default earning method, overridable per node and activity (§26.4). Milestone applies to true milestones only; a task never inherits it.';

/* ========================================================================== */
/* 2. Planning nodes                                                          */
/* ========================================================================== */

alter table public.planning_work_items
  add column local_weight_percent numeric(6, 3),
  add column is_control_account   boolean not null default false,
  add column earning_method       text,
  add column structure_node_id    uuid,
  add constraint planning_work_items_local_weight_range
    check (local_weight_percent is null or local_weight_percent between 0 and 100),
  add constraint planning_work_items_earning_method_valid
    check (earning_method is null
           or earning_method in ('percent_complete', 'zero_hundred', 'fifty_fifty', 'milestone')),
  -- Same-project by construction: the unit must be a unit of THIS project.
  add constraint planning_work_items_structure_node_fk
    foreign key (structure_node_id, project_id)
    references public.project_structure_nodes (id, project_id);

create index planning_work_items_structure_node
  on public.planning_work_items (structure_node_id) where structure_node_id is not null;

comment on column public.planning_work_items.weight_percent is
  'RECORDED weight (as entered or imported before 13.11, semantics unreviewed). Kept for history and the legacy flat roll-up; never read as a local weight. 13.11 adopts it into local_weight_percent only by an explicit, logged decision.';
comment on column public.planning_work_items.local_weight_percent is
  '13.11. Local weight: percent of the parent (the Project for a top-level node). The only weight a user enters (§26.4 W4); effective weights are always calculated.';
comment on column public.planning_work_items.is_control_account is
  '13.11. Control Account flag (§26.3 H2): the node at which performance is reported and explained.';
comment on column public.planning_work_items.earning_method is
  '13.11. Default earning method for the work under this node; null inherits from the parent node, then the project.';
comment on column public.planning_work_items.structure_node_id is
  '13.11. Other-project reporting-unit mapping (§26.3 H6). PSM projects map with department_id / system_id / discipline_id. Children inherit unless they override.';

/* ========================================================================== */
/* 3. Activities                                                              */
/* ========================================================================== */

alter table public.planning_activities
  add column local_weight_percent numeric(6, 3),
  add column earning_method       text,
  add column department_id        uuid references public.departments(id) on delete restrict,
  add column system_id            uuid references public.systems(id) on delete set null,
  add column discipline_id        uuid references public.disciplines(id) on delete restrict,
  add column structure_node_id    uuid,
  add constraint planning_activities_local_weight_range
    check (local_weight_percent is null or local_weight_percent between 0 and 100),
  add constraint planning_activities_earning_method_valid
    check (earning_method is null
           or earning_method in ('percent_complete', 'zero_hundred', 'fifty_fifty', 'milestone')),
  -- Kind and method agree: the Milestone method is for true milestones only,
  -- and a true milestone earns only by the Milestone method (§26.4).
  add constraint planning_activities_kind_method_consistent
    check (earning_method is null or ((earning_method = 'milestone') = is_milestone)),
  add constraint planning_activities_structure_node_fk
    foreign key (structure_node_id, project_id)
    references public.project_structure_nodes (id, project_id);

create index planning_activities_structure_node
  on public.planning_activities (structure_node_id) where structure_node_id is not null;

comment on column public.planning_activities.weight_percent is
  'RECORDED weight (as entered or imported, semantics unreviewed). Read by the legacy flat roll-up and copied by the current publish; never read as a local weight. Adopted into local_weight_percent only by an explicit, logged decision.';
comment on column public.planning_activities.local_weight_percent is
  '13.11. Local weight: percent of the activity''s planning node. True milestones carry 0 by default (§26.4 W5).';
comment on column public.planning_activities.earning_method is
  '13.11. Earning method; null inherits the nearest node default, then the project default. is_milestone is the activity kind (task or true milestone).';
comment on column public.planning_activities.structure_node_id is
  '13.11. Reporting-unit override for an Other project (§26.3 H6); null inherits the node''s mapping.';

/* ========================================================================== */
/* 4. Working Plan integrity — reporting units, attachment, deprecated shape  */
/* ========================================================================== */

-- Fires BEFORE INSERT / UPDATE on both Working Plan tables, after the 13.9
-- archived guard ("block_…" sorts first). Every rule is judged only when the
-- columns it concerns are written, so rows written before 13.11 stay
-- readable and editable on their other fields — nothing is repaired here.
create function public.guard_working_plan_item()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_family text;
  v_is_insert boolean := tg_op = 'INSERT';
  v_psm_changed boolean;
  v_unit_changed boolean;
  v_owner_department uuid;
begin
  select p.structure_family into v_family from public.projects p where p.id = new.project_id;

  if v_is_insert then
    v_psm_changed := new.department_id is not null or new.system_id is not null
                     or new.discipline_id is not null;
    v_unit_changed := new.structure_node_id is not null;
  else
    v_psm_changed := new.department_id is distinct from old.department_id
                     or new.system_id is distinct from old.system_id
                     or new.discipline_id is distinct from old.discipline_id;
    v_unit_changed := new.structure_node_id is not null
                      and new.structure_node_id is distinct from old.structure_node_id;
  end if;

  -- H6 / §26.12: a PSM project maps to Department → System → Program & Study,
  -- an Other project to one of its Project Structure units.
  if v_unit_changed then
    if v_family is distinct from 'other' then
      raise exception '[REPORTING_UNIT_FAMILY] Only an Other Project maps planning work to Project Structure units. A PSM project maps to its Departments, Systems and Programs & Studies.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.project_structure_nodes n
                where n.id = new.structure_node_id and n.archived_at is not null) then
      raise exception '[REPORTING_UNIT_ARCHIVED] That Project Structure unit is archived; choose an active unit.'
        using errcode = '23514';
    end if;
  end if;

  if v_psm_changed and (new.department_id is not null or new.system_id is not null
                        or new.discipline_id is not null) then
    if v_family = 'other' then
      raise exception '[REPORTING_UNIT_FAMILY] An Other Project maps planning work to its Project Structure units, not to Departments, Systems or Programs & Studies.'
        using errcode = '23514';
    end if;
    if new.department_id is null then
      raise exception '[REPORTING_UNIT_INCOMPLETE] A System or Program & Study mapping needs its Department.'
        using errcode = '23514';
    end if;
    -- H7: only the project's own structure.
    if not exists (select 1 from public.project_departments d
                    where d.project_id = new.project_id and d.department_id = new.department_id) then
      raise exception '[REPORTING_UNIT_NOT_IN_PROJECT] That Department is not part of this project.'
        using errcode = '23514';
    end if;
    if new.system_id is not null then
      select s.department_id into v_owner_department from public.systems s where s.id = new.system_id;
      if v_owner_department is distinct from new.department_id then
        raise exception '[REPORTING_UNIT_NOT_IN_PROJECT] That System does not belong to the selected Department.'
          using errcode = '23514';
      end if;
    end if;
    if new.discipline_id is not null
       and not exists (select 1 from public.project_disciplines pd
                        where pd.project_id = new.project_id and pd.discipline_id = new.discipline_id
                          and (pd.department_id is null or pd.department_id = new.department_id)) then
      raise exception '[REPORTING_UNIT_NOT_IN_PROJECT] That Program & Study is not part of this project under the selected Department.'
        using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'planning_work_items' then
    -- H5: "Milestone" is not a node classification and a node is never a
    -- milestone. Existing rows keep their stored values (deprecated, readable).
    if v_is_insert then
      if new.item_type = 'milestone' or new.is_milestone then
        raise exception '[NODE_NOT_MILESTONE] A planning node is never a milestone. Add a milestone activity under the node instead.'
          using errcode = '23514';
      end if;
    elsif (new.item_type = 'milestone' and old.item_type is distinct from 'milestone')
          or (new.is_milestone and not old.is_milestone) then
      raise exception '[NODE_NOT_MILESTONE] A planning node is never a milestone. Add a milestone activity under the node instead.'
        using errcode = '23514';
    end if;
  else
    -- H3: an activity attaches to one ACTIVE node of its project (the
    -- same-project rule is planning_activities_work_item_guard).
    if new.work_item_id is not null
       and (v_is_insert or new.work_item_id is distinct from old.work_item_id)
       and exists (select 1 from public.planning_work_items w
                    where w.id = new.work_item_id and not w.active) then
      raise exception '[NODE_ARCHIVED] That planning node is archived; attach the activity to an active node.'
        using errcode = '23514';
    end if;
    -- Once attached, an activity is moved, never detached (§26.10 rule 3:
    -- the node attachment is EPRP-owned and no import or edit drops it).
    if not v_is_insert then
      if old.work_item_id is not null and new.work_item_id is null then
        raise exception '[ACTIVITY_DETACH] An attached activity stays attached to a planning node. Move it to another node instead.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$fn$;

comment on function public.guard_working_plan_item() is
  '13.11. Working Plan integrity on planning_work_items / planning_activities: reporting-unit family and same-project mapping (H6, H7), no new milestone nodes (H5), attachment to an active node and no detaching (H3). Judged only on the columns written.';

revoke execute on function public.guard_working_plan_item() from public, anon, authenticated;

create trigger guard_working_plan_item
  before insert or update on public.planning_work_items
  for each row execute function public.guard_working_plan_item();
create trigger guard_working_plan_item
  before insert or update on public.planning_activities
  for each row execute function public.guard_working_plan_item();

/* ========================================================================== */
/* 5. Planning Decision log — planning_confirmations widened                  */
/* ========================================================================== */

alter table public.planning_confirmations
  drop constraint planning_confirmations_action_valid,
  add constraint planning_confirmations_action_valid
    check (action in ('confirm', 'adjust', 'edit', 'normalise')),
  alter column reason drop not null,
  drop constraint planning_confirmations_reason_not_blank,
  -- A direct Project Control edit may carry a reason; every decision must.
  add constraint planning_confirmations_reason_valid
    check ((reason is null and action = 'edit') or (reason is not null and length(btrim(reason)) > 0)),
  add column decision_id                  uuid,
  add column decision_mode                text,
  add column decision_parent_work_item_id uuid references public.planning_work_items(id) on delete set null,
  add column actor_user_id                uuid,
  add constraint planning_confirmations_decision_mode_valid
    check (decision_mode is null
           or (decision_id is not null
               and decision_mode in ('proportional_rescale', 'equal_split', 'adopt_recorded'))),
  add constraint planning_confirmations_normalise_has_mode
    check (action <> 'normalise'
           or (decision_mode is not null and decision_mode in ('proportional_rescale', 'equal_split')));

create index planning_confirmations_decision
  on public.planning_confirmations (decision_id) where decision_id is not null;

comment on column public.planning_confirmations.decision_id is
  '13.11. Groups the rows of one weight decision (W3): one row per child whose weight the decision set.';
comment on column public.planning_confirmations.decision_mode is
  '13.11. proportional_rescale / equal_split (action normalise) or adopt_recorded (action adjust: a recorded weight accepted as the local weight).';
comment on column public.planning_confirmations.decision_parent_work_item_id is
  '13.11. The parent whose children a weight decision concerns; null with a decision_id means the Project itself.';
comment on column public.planning_confirmations.actor_user_id is
  '13.11. The signed-in account that wrote the row, stamped by the database (never client-supplied).';

-- Attribution is the database's: actor, contact and time are stamped, never
-- taken from the client. Existing callers that omit the contact now get it.
create function public.stamp_planning_confirmation()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  new.actor_user_id := auth.uid();
  new.confirmed_by_contact_id := coalesce(new.confirmed_by_contact_id, public.current_contact_id());
  new.confirmed_at := now();
  return new;
end;
$fn$;

revoke execute on function public.stamp_planning_confirmation() from public, anon, authenticated;

create trigger stamp_planning_confirmation
  before insert on public.planning_confirmations
  for each row execute function public.stamp_planning_confirmation();

/* ========================================================================== */
/* 6. Working Plan change log (§26.2 F2)                                      */
/* ========================================================================== */

-- Every change to a governed Working Plan field is appended to the Planning
-- Decision log, whichever route made it. EPRP-owned fields (§26.10 rule 3)
-- are always logged; schedule-owned fields of an IMPORTED activity are logged
-- by the import review decision that changed them, so only a manual
-- activity's schedule fields are logged here. A decision function labels its
-- rows through transaction-local settings (section 7); anything else is an
-- 'edit'.
create function public.log_working_plan_change()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_action text := coalesce(nullif(current_setting('eprp.planning_action', true), ''), 'edit');
  v_reason text := nullif(current_setting('eprp.planning_reason', true), '');
  v_decision uuid := nullif(current_setting('eprp.planning_decision_id', true), '')::uuid;
  v_mode text := nullif(current_setting('eprp.planning_decision_mode', true), '');
  v_parent uuid := nullif(current_setting('eprp.planning_decision_parent', true), '')::uuid;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_fields text[];
  v_field text;
begin
  if tg_table_name = 'planning_work_items' then
    v_fields := array['code', 'name', 'parent_work_item_id', 'local_weight_percent', 'is_control_account',
                      'earning_method', 'department_id', 'system_id', 'discipline_id',
                      'structure_node_id', 'active'];
  else
    v_fields := array['work_item_id', 'local_weight_percent', 'earning_method', 'department_id',
                      'system_id', 'discipline_id', 'structure_node_id', 'active'];
    if v_new ->> 'source' = 'manual' then
      v_fields := v_fields || array['code', 'name', 'is_milestone', 'planned_start_date',
                                    'planned_finish_date', 'actual_start_date', 'actual_finish_date',
                                    'percent_complete_physical'];
    end if;
  end if;

  foreach v_field in array v_fields loop
    if (v_old -> v_field) is distinct from (v_new -> v_field) then
      insert into public.planning_confirmations
        (work_item_id, activity_id, action, field_name, previous_value, new_value, reason,
         decision_id, decision_mode, decision_parent_work_item_id)
      values
        (case when tg_table_name = 'planning_work_items' then (v_new ->> 'id')::uuid end,
         case when tg_table_name = 'planning_activities' then (v_new ->> 'id')::uuid end,
         v_action, v_field, v_old ->> v_field, v_new ->> v_field, v_reason,
         v_decision, v_mode, v_parent);
    end if;
  end loop;
  return null;
end;
$fn$;

comment on function public.log_working_plan_change() is
  '13.11. Appends one planning_confirmations row per changed governed Working Plan field (F2). Action/reason/decision come from transaction-local settings set by a decision function; otherwise the row is an edit.';

revoke execute on function public.log_working_plan_change() from public, anon, authenticated;

create trigger log_working_plan_change
  after update on public.planning_work_items
  for each row execute function public.log_working_plan_change();
create trigger log_working_plan_change
  after update on public.planning_activities
  for each row execute function public.log_working_plan_change();

/* ========================================================================== */
/* 7. Explicit weight decisions (W3) — record_planning_weight_decision()      */
/* ========================================================================== */

/*
 * One logged decision for one parent's direct children (nodes and activities
 * together, §26.3 H3); p_parent_work_item_id null = the Project itself (its
 * top-level nodes and any activity not yet attached to a node).
 *
 *   proportional_rescale  the entered local weights, rescaled to total 100%;
 *                         a child with no weight gets 0
 *   equal_split           only when NO child has a local weight: 100% / n
 *   adopt_recorded        accept recorded weights (weight_percent) as local
 *                         weights for the listed children that have none —
 *                         how an existing project is reviewed into the local
 *                         model; nothing is reinterpreted silently
 *
 * The caller (the Working Plan editor) computes the proposal with the
 * Planning Engine and sends {kind, id, before, after} per child; this
 * function re-derives and verifies it against the stored values under a lock:
 * the child set must be exactly the parent's current children, every
 * "before" must still be the stored value (otherwise PT409, reload), and every
 * "after" must match the mode to 3 decimals with normalised results totalling
 * exactly 100.000. Nothing is ever normalised silently.
 */
create function public.record_planning_weight_decision(
  p_project uuid,
  p_parent_work_item_id uuid,
  p_mode text,
  p_children jsonb,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_decision uuid := gen_random_uuid();
  v_current jsonb;
  v_count integer;
  v_listed integer;
  v_total numeric;
  v_after_total numeric;
  v_entry jsonb;
  v_stored jsonb;
  v_before numeric;
  v_after numeric;
  v_exact numeric;
begin
  if auth.uid() is null or not public.can_manage_project_operations(p_project) then
    raise exception '[NOT_AUTHORIZED] Project Control authority on this project is required to decide Working Plan weights.'
      using errcode = '42501';
  end if;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('proportional_rescale', 'equal_split', 'adopt_recorded') then
    raise exception '[INVALID_DECISION] Unknown weight decision.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception '[REASON_REQUIRED] A weight decision needs a reason.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_children) is distinct from 'array' or jsonb_array_length(p_children) = 0 then
    raise exception '[INVALID_DECISION] The decision lists no child weights.' using errcode = '22023';
  end if;
  if p_parent_work_item_id is not null and not exists (
       select 1 from public.planning_work_items w
        where w.id = p_parent_work_item_id and w.project_id = p_project and w.active) then
    raise exception '[NOT_FOUND] That planning node is not an active node of this project.' using errcode = 'P0002';
  end if;

  -- Serialise with every other Working Plan decision and publish on the project.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project::text, 0));

  -- The parent's CURRENT direct children, locked.
  with nodes as (
    select 'node'::text as kind, w.id, w.local_weight_percent as local_weight, w.weight_percent as recorded
      from public.planning_work_items w
     where w.project_id = p_project and w.active
       and w.parent_work_item_id is not distinct from p_parent_work_item_id
       for update
  ), acts as (
    select 'activity'::text as kind, a.id, a.local_weight_percent, a.weight_percent
      from public.planning_activities a
     where a.project_id = p_project and a.active
       and a.work_item_id is not distinct from p_parent_work_item_id
       for update
  )
  select coalesce(jsonb_object_agg(c.id::text,
           jsonb_build_object('kind', c.kind, 'local', c.local_weight, 'recorded', c.recorded)), '{}'::jsonb),
         count(*)
    into v_current, v_count
    from (select * from nodes union all select * from acts) c;

  if v_count = 0 then
    raise exception '[INVALID_DECISION] That parent has no children to weigh.' using errcode = '22023';
  end if;

  v_listed := jsonb_array_length(p_children);
  if (select count(distinct e ->> 'id') from jsonb_array_elements(p_children) e) <> v_listed then
    raise exception '[INVALID_DECISION] A child is listed twice.' using errcode = '22023';
  end if;
  if p_mode <> 'adopt_recorded' and v_listed <> v_count then
    raise exception '[STALE] The Working Plan changed since this page loaded. Reload before deciding.'
      using errcode = 'PT409';
  end if;

  -- Every listed child is a current child of the right kind, and its
  -- "before" is still the stored local weight.
  for v_entry in select e from jsonb_array_elements(p_children) e loop
    v_stored := v_current -> (v_entry ->> 'id');
    if v_stored is null or v_stored ->> 'kind' is distinct from v_entry ->> 'kind' then
      raise exception '[STALE] The Working Plan changed since this page loaded. Reload before deciding.'
        using errcode = 'PT409';
    end if;
    if (v_stored ->> 'local')::numeric is distinct from (v_entry ->> 'before')::numeric then
      raise exception '[STALE] The Working Plan changed since this page loaded. Reload before deciding.'
        using errcode = 'PT409';
    end if;
    v_after := (v_entry ->> 'after')::numeric;
    if v_after is null or v_after < 0 or v_after > 100 or v_after <> round(v_after, 3) then
      raise exception '[INVALID_DECISION] Each resulting weight is between 0 and 100 with at most three decimals.'
        using errcode = '22023';
    end if;
  end loop;

  select sum(coalesce((value ->> 'local')::numeric, 0)) into v_total from jsonb_each(v_current);
  select sum((e ->> 'after')::numeric) into v_after_total from jsonb_array_elements(p_children) e;

  if p_mode = 'equal_split' then
    if exists (select 1 from jsonb_each(v_current) where value ->> 'local' is not null) then
      raise exception '[INVALID_DECISION] Equal split applies only when no child weight is entered.'
        using errcode = '22023';
    end if;
  elsif p_mode = 'proportional_rescale' then
    if v_total <= 0 then
      raise exception '[INVALID_DECISION] Proportional rescale needs at least one entered weight above 0.'
        using errcode = '22023';
    end if;
    if abs(v_total - 100) <= 0.01
       and not exists (select 1 from jsonb_each(v_current) where value ->> 'local' is null) then
      raise exception '[INVALID_DECISION] These weights already total 100%%; there is nothing to normalise.'
        using errcode = '22023';
    end if;
  end if;

  if p_mode in ('proportional_rescale', 'equal_split') then
    if v_after_total <> 100 then
      raise exception '[INVALID_DECISION] Normalised weights must total exactly 100%%.' using errcode = '22023';
    end if;
    for v_entry in select e from jsonb_array_elements(p_children) e loop
      v_before := coalesce((v_current -> (v_entry ->> 'id') ->> 'local')::numeric, 0);
      v_exact := case p_mode when 'equal_split' then 100::numeric / v_count
                             else v_before * 100 / v_total end;
      if abs((v_entry ->> 'after')::numeric - v_exact) >= 0.001 then
        raise exception '[INVALID_DECISION] A resulting weight does not match the chosen normalisation.'
          using errcode = '22023';
      end if;
    end loop;
  else
    for v_entry in select e from jsonb_array_elements(p_children) e loop
      v_stored := v_current -> (v_entry ->> 'id');
      if v_stored ->> 'local' is not null then
        raise exception '[INVALID_DECISION] A child already has a local weight; a recorded weight never overwrites it.'
          using errcode = '22023';
      end if;
      if v_stored ->> 'recorded' is null
         or (v_stored ->> 'recorded')::numeric <> (v_entry ->> 'after')::numeric then
        raise exception '[INVALID_DECISION] Only the recorded weight itself can be adopted.'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Label the rows the change-log trigger writes for this decision.
  perform set_config('eprp.planning_action',
                     case p_mode when 'adopt_recorded' then 'adjust' else 'normalise' end, true);
  perform set_config('eprp.planning_reason', v_reason, true);
  perform set_config('eprp.planning_decision_id', v_decision::text, true);
  perform set_config('eprp.planning_decision_mode', p_mode, true);
  perform set_config('eprp.planning_decision_parent', coalesce(p_parent_work_item_id::text, ''), true);

  for v_entry in select e from jsonb_array_elements(p_children) e loop
    v_after := (v_entry ->> 'after')::numeric;
    if v_entry ->> 'kind' = 'node' then
      update public.planning_work_items set local_weight_percent = v_after
       where id = (v_entry ->> 'id')::uuid;
    else
      update public.planning_activities set local_weight_percent = v_after
       where id = (v_entry ->> 'id')::uuid;
    end if;
    -- A weight the decision leaves unchanged is still part of the decision.
    if (v_current -> (v_entry ->> 'id') ->> 'local')::numeric is not distinct from v_after then
      insert into public.planning_confirmations
        (work_item_id, activity_id, action, field_name, previous_value, new_value, reason,
         decision_id, decision_mode, decision_parent_work_item_id)
      values
        (case when v_entry ->> 'kind' = 'node' then (v_entry ->> 'id')::uuid end,
         case when v_entry ->> 'kind' = 'activity' then (v_entry ->> 'id')::uuid end,
         case p_mode when 'adopt_recorded' then 'adjust' else 'normalise' end,
         'local_weight_percent', v_after::text, v_after::text, v_reason,
         v_decision, p_mode, p_parent_work_item_id);
    end if;
  end loop;

  perform set_config('eprp.planning_action', '', true);
  perform set_config('eprp.planning_reason', '', true);
  perform set_config('eprp.planning_decision_id', '', true);
  perform set_config('eprp.planning_decision_mode', '', true);
  perform set_config('eprp.planning_decision_parent', '', true);

  return v_decision;
end;
$fn$;

comment on function public.record_planning_weight_decision(uuid, uuid, text, jsonb, text) is
  '13.11 / W3. The one route for an explicit weight decision on one parent''s children: proportional rescale, equal split, or adopting recorded weights. Verified against the stored values under the project lock; logged per child with actor, reason and decision id.';

revoke execute on function public.record_planning_weight_decision(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.record_planning_weight_decision(uuid, uuid, text, jsonb, text) to authenticated;

/* ========================================================================== */
/* 8. Planning Configuration change log and its one writer                    */
/* ========================================================================== */

create table public.planning_configuration_changes (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  field_key             text not null,
  previous_value        jsonb,
  new_value             jsonb,
  reason                text,
  changed_by_user_id    uuid,
  changed_by_contact_id uuid references public.contacts(id) on delete set null,
  changed_at            timestamptz not null default now(),
  constraint planning_configuration_changes_field_valid
    check (field_key in ('level_labels', 'control_account_level', 'weight_source', 'default_earning_method')),
  constraint planning_configuration_changes_reason_valid
    check (reason is null or length(btrim(reason)) > 0)
);

comment on table public.planning_configuration_changes is
  '13.11. Append-only log of every Planning Configuration change (§26.20 rule 4): field, previous and new value, reason, actor and time. Written only by the log trigger on project_planning_settings; never edited or deleted.';

create index planning_configuration_changes_project
  on public.planning_configuration_changes (project_id, changed_at desc);

alter table public.planning_configuration_changes enable row level security;

create policy planning_configuration_changes_select on public.planning_configuration_changes
  for select to authenticated
  using (public.can_access_project(project_id));
-- No INSERT / UPDATE / DELETE policy: written by the security-definer trigger only.

create function public.guard_planning_configuration_change_row()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if (tg_op <> 'INSERT' and public.project_is_archived(old.project_id))
     or (tg_op <> 'DELETE' and public.project_is_archived(new.project_id)) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Planning configuration history is append-only.' using errcode = '42501';
  end if;
  -- Only the project's own cascade removes history: by then the project is gone.
  if tg_op = 'DELETE' and exists (select 1 from public.projects p where p.id = old.project_id) then
    raise exception 'Planning configuration history is append-only.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

revoke execute on function public.guard_planning_configuration_change_row() from public, anon, authenticated;

create trigger block_archived_planning_configuration
  before insert or update or delete on public.planning_configuration_changes
  for each row execute function public.guard_planning_configuration_change_row();

-- Rules on the configuration columns themselves, whatever the route:
--   * a "no formal schedule" project is not planning-governed (§26.14): its
--     planning configuration is not set;
--   * switching where weights are managed once local weights exist is an
--     explicit act with a reason (§26.20 rule 4).
create function public.guard_planning_configuration()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_changed boolean;
begin
  v_changed := case when tg_op = 'INSERT'
                    then new.level_labels <> '{}' or new.control_account_level is not null
                         or new.weight_source is not null or new.default_earning_method is not null
                    else new.level_labels is distinct from old.level_labels
                         or new.control_account_level is distinct from old.control_account_level
                         or new.weight_source is distinct from old.weight_source
                         or new.default_earning_method is distinct from old.default_earning_method end;
  if not v_changed then
    return new;
  end if;

  if new.onboarding_mode = 'no_formal_schedule' then
    raise exception '[NOT_PLANNING_GOVERNED] A project with no formal schedule has no planning configuration. Change how the project is planned in Project Setup first.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.weight_source is not null
     and new.weight_source is distinct from old.weight_source
     and nullif(current_setting('eprp.planning_reason', true), '') is null
     and (exists (select 1 from public.planning_work_items w
                   where w.project_id = new.project_id and w.local_weight_percent is not null)
          or exists (select 1 from public.planning_activities a
                      where a.project_id = new.project_id and a.local_weight_percent is not null)) then
    raise exception '[REASON_REQUIRED] Local weights already exist; changing where weights are managed needs a reason.'
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;

revoke execute on function public.guard_planning_configuration() from public, anon, authenticated;

create trigger guard_planning_configuration
  before insert or update on public.project_planning_settings
  for each row execute function public.guard_planning_configuration();

create function public.log_planning_configuration_change()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_reason text := nullif(current_setting('eprp.planning_reason', true), '');
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := to_jsonb(new);
  v_field text;
begin
  foreach v_field in array array['level_labels', 'control_account_level', 'weight_source',
                                 'default_earning_method'] loop
    if coalesce(v_old -> v_field, case v_field when 'level_labels' then '[]'::jsonb else 'null'::jsonb end)
       is distinct from v_new -> v_field then
      insert into public.planning_configuration_changes
        (project_id, field_key, previous_value, new_value, reason, changed_by_user_id, changed_by_contact_id)
      values
        (new.project_id, v_field, v_old -> v_field, v_new -> v_field, v_reason, auth.uid(),
         public.current_contact_id());
    end if;
  end loop;
  return null;
end;
$fn$;

revoke execute on function public.log_planning_configuration_change() from public, anon, authenticated;

create trigger log_planning_configuration_change
  after insert or update on public.project_planning_settings
  for each row execute function public.log_planning_configuration_change();

/*
 * The one writer for the Planning Configuration. Guided Setup and Advanced
 * mode both call it with the same four canonical values (§26.20 rule 2): no
 * answer is stored anywhere else, and no calculated value is accepted.
 * The onboarding mode must already be chosen (Project Setup); it is never
 * written here. p_expected_updated_at is the row version the page loaded.
 */
create function public.save_planning_configuration(
  p_project uuid,
  p_level_labels text[],
  p_control_account_level integer,
  p_weight_source text,
  p_default_earning_method text,
  p_expected_updated_at timestamptz,
  p_reason text default null
) returns public.project_planning_settings
language plpgsql security definer set search_path = '' as $fn$
declare
  v_row public.project_planning_settings;
  v_labels text[];
begin
  if auth.uid() is null or not public.can_manage_project_operations(p_project) then
    raise exception '[NOT_AUTHORIZED] Project Control authority on this project is required to set up its planning.'
      using errcode = '42501';
  end if;
  if public.project_is_archived(p_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
      using errcode = '42501';
  end if;

  select * into v_row from public.project_planning_settings where project_id = p_project for update;
  if not found then
    raise exception '[ONBOARDING_NOT_CHOSEN] Decide how the project will be planned in Project Setup first.'
      using errcode = 'P0002';
  end if;
  if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
    raise exception '[STALE] The planning configuration changed since this page loaded. Reload before saving.'
      using errcode = 'PT409';
  end if;

  select coalesce(array_agg(btrim(l) order by o), '{}')
    into v_labels
    from unnest(coalesce(p_level_labels, '{}')) with ordinality as t(l, o);
  if p_control_account_level is not null and p_control_account_level > coalesce(cardinality(v_labels), 0) then
    raise exception '[INVALID_CONFIGURATION] The Control Account level must be one of the named levels.'
      using errcode = '22023';
  end if;

  perform set_config('eprp.planning_reason', coalesce(nullif(btrim(coalesce(p_reason, '')), ''), ''), true);
  update public.project_planning_settings
     set level_labels = v_labels,
         control_account_level = p_control_account_level,
         weight_source = p_weight_source,
         default_earning_method = p_default_earning_method
   where project_id = p_project
  returning * into v_row;
  perform set_config('eprp.planning_reason', '', true);
  return v_row;
end;
$fn$;

comment on function public.save_planning_configuration(uuid, text[], integer, text, text, timestamptz, text) is
  '13.11 / §26.20. The one writer of the Planning Configuration (level labels, Control Account level, weight source, default earning method) for Guided and Advanced Planning Setup. Project Control only; archived refused; stale version refused with PT409; every change logged.';

revoke execute on function public.save_planning_configuration(uuid, text[], integer, text, text, timestamptz, text) from public, anon;
grant execute on function public.save_planning_configuration(uuid, text[], integer, text, text, timestamptz, text) to authenticated;

/* ========================================================================== */
/* 9. Post-checks                                                             */
/* ========================================================================== */

do $post$
declare
  v_fn text;
begin
  -- The archived guard still answers first on both Working Plan tables.
  if exists (select 1 from pg_catalog.pg_trigger g
              where g.tgname in ('guard_working_plan_item')
                and not exists (select 1 from pg_catalog.pg_trigger b
                                 where b.tgrelid = g.tgrelid and b.tgname = 'block_archived_project_planning'))
     or 'block_archived_project_planning' > 'guard_working_plan_item' then
    raise exception '13.11 post-check failed: the 13.9 archived guard must answer before the Working Plan guard.';
  end if;

  foreach v_fn in array array['public.guard_working_plan_item()', 'public.stamp_planning_confirmation()',
                              'public.log_working_plan_change()', 'public.guard_planning_configuration()',
                              'public.log_planning_configuration_change()',
                              'public.guard_planning_configuration_change_row()'] loop
    if has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception '13.11 post-check failed: % must not be client-callable.', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.record_planning_weight_decision(uuid, uuid, text, jsonb, text)',
                              'public.save_planning_configuration(uuid, text[], integer, text, text, timestamptz, text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '13.11 post-check failed: % must be callable by signed-in accounts only.', v_fn;
    end if;
  end loop;

  -- Scope boundary: the shared operations predicate is unchanged (13.9).
  if (select prosrc from pg_catalog.pg_proc
       where oid = 'public.can_manage_project_operations(uuid)'::regprocedure) ~ 'project_is_archived' then
    raise exception '13.11 post-check failed: can_manage_project_operations() was changed.';
  end if;
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'block_archived_project_planning') <> 16 then
    raise exception '13.11 post-check failed: the 13.9 archived planning guard must stay on exactly its 16 tables.';
  end if;
end;
$post$;
