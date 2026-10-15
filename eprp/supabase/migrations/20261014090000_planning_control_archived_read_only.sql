-- Phase 13.9: archived / read-only safety guards for Master Planning & Control.
--
-- An archived project stays fully readable as historical evidence, but its
-- Planning, Master Milestone and Master Deliverable operational records become
-- immutable at the data boundary, for every actor (System Administrator,
-- Project Control Admin and the assigned Project Control / Planning included).
-- Architecture: docs/02_PLATFORM_ARCHITECTURE.md §26.3 H10; permissions:
-- docs/05_PERMISSION_MODEL.md §3.8 rule 3.
--
-- THE GAP THIS CLOSES
--   Every write on these tables is authorised by can_manage_project_operations(),
--   which is not archive-aware (20260922000003 deliberately left it alone: it
--   backs ~39 policies across Project Setup, Organization Chart, Documents and
--   Calendar). So an archived project's Master Plan, activities, imports,
--   baselines, Opening Positions, snapshots, milestones, milestone updates,
--   Weekly milestone drafts and deliverables could all still be changed through
--   the API, and publish_planning_snapshot() (SECURITY DEFINER) could still
--   publish for it.
--
-- HOW — the 2C.3E pattern, extended to the planning and register tables
--   One guard function, guard_archived_project_planning(), installed as a
--   BEFORE INSERT / UPDATE / DELETE row trigger named
--   block_archived_project_planning on each of the 16 tables below. It resolves
--   each row's project (directly, or through the existing security-definer
--   lookup helpers for child rows) and refuses the write with the same tag and
--   SQLSTATE as 2C.3E: [PROJECT_ARCHIVED], 42501.
--
--   * Triggers fire for every role, so neither a global authority nor a
--     SECURITY DEFINER writer (publish_planning_snapshot(),
--     submit_finalized_weekly_milestones(), move_discipline_system()) can
--     bypass the freeze. Only a deliberate owner-level act that disables the
--     trigger could, which is the same posture as 2C.3E.
--   * BEFORE row triggers fire alphabetically: "block_" answers before every
--     existing guard, set_updated_at and the Weekly draft row lock.
--   * Both ends of an UPDATE are checked.
--   * Deleting a whole project still cascades: by the time the cascade reaches
--     a child row the project row is gone, so the child is no longer an
--     archived project's record (identical to 2C.3E).
--
-- UNCHANGED, by design: every table, column, policy and authority predicate
-- (can_manage_project_operations() in particular — proved by the post-check);
-- every read path (the guard only ever refuses a write); the append-only and
-- identity guards already on these tables; archiving itself (it writes none of
-- these tables); and the absence of any un-archive path (2C.3E). No row is
-- written, repaired or normalised.

/* ------------------------------ 1. The guard ------------------------------ */

create function public.guard_archived_project_planning() returns trigger
language plpgsql security definer set search_path = '' as $guard$
declare
  v_rows jsonb[] := array[]::jsonb[];
  v_row jsonb;
  v_project uuid;
begin
  -- Both ends of an UPDATE count.
  if tg_op <> 'INSERT' then v_rows := v_rows || to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_rows := v_rows || to_jsonb(new); end if;

  foreach v_row in array v_rows loop
    case tg_table_name
      when 'project_planning_settings', 'planning_import_batches', 'planning_work_items',
           'planning_activities', 'planning_baselines', 'planning_snapshots',
           'planning_opening_positions', 'master_milestones', 'master_deliverables' then
        v_project := (v_row ->> 'project_id')::uuid;
      when 'planning_import_rows' then
        v_project := public.planning_import_batch_project((v_row ->> 'batch_id')::uuid);
      when 'planning_confirmations' then
        v_project := coalesce(public.planning_work_item_project((v_row ->> 'work_item_id')::uuid),
                              public.planning_activity_project((v_row ->> 'activity_id')::uuid));
      when 'planning_snapshot_activities' then
        v_project := public.planning_snapshot_project((v_row ->> 'snapshot_id')::uuid);
      when 'planning_milestone_links' then
        v_project := public.milestone_project((v_row ->> 'master_milestone_id')::uuid);
      when 'milestone_updates' then
        v_project := public.milestone_project((v_row ->> 'milestone_id')::uuid);
      when 'weekly_milestone_drafts' then
        v_project := public.weekly_report_project((v_row ->> 'weekly_report_id')::uuid);
      when 'deliverable_updates' then
        v_project := public.deliverable_project((v_row ->> 'deliverable_id')::uuid);
      else
        -- Fail closed: the guard must never be installed somewhere it cannot
        -- resolve a project, because that would silently admit every write.
        raise exception 'guard_archived_project_planning() is not defined for table %', tg_table_name
          using errcode = 'P0001';
    end case;

    if v_project is not null and public.project_is_archived(v_project) then
      raise exception '[PROJECT_ARCHIVED] This project is archived; its planning, milestones and deliverables are read-only.'
        using errcode = '42501';
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$guard$;

comment on function public.guard_archived_project_planning() is
  'Phase 13.9. Refuses every INSERT / UPDATE / DELETE of an archived project''s Planning, Master Milestone and Master Deliverable records, for every role, with [PROJECT_ARCHIVED] / 42501. Installed as block_archived_project_planning. Never consulted on a read.';

revoke execute on function public.guard_archived_project_planning() from public, anon, authenticated, service_role;

/* ------------------------------ 2. Install -------------------------------- */

do $install$
declare
  v_table text;
begin
  foreach v_table in array array[
    'project_planning_settings', 'planning_import_batches', 'planning_import_rows',
    'planning_work_items', 'planning_activities', 'planning_confirmations',
    'planning_baselines', 'planning_milestone_links', 'planning_snapshots',
    'planning_snapshot_activities', 'planning_opening_positions',
    'master_milestones', 'milestone_updates', 'weekly_milestone_drafts',
    'master_deliverables', 'deliverable_updates']
  loop
    execute format('create trigger block_archived_project_planning before insert or update or delete on public.%I '
                   'for each row execute function public.guard_archived_project_planning()', v_table);
  end loop;
end;
$install$;

/* ----------------------------- 3. Post-checks ----------------------------- */

do $post$
declare
  v_missing text;
  v_not_first text;
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array[
      'project_planning_settings', 'planning_import_batches', 'planning_import_rows',
      'planning_work_items', 'planning_activities', 'planning_confirmations',
      'planning_baselines', 'planning_milestone_links', 'planning_snapshots',
      'planning_snapshot_activities', 'planning_opening_positions',
      'master_milestones', 'milestone_updates', 'weekly_milestone_drafts',
      'master_deliverables', 'deliverable_updates']) t
   where not exists (select 1 from pg_catalog.pg_trigger g
                      where g.tgname = 'block_archived_project_planning'
                        and g.tgrelid = ('public.' || t)::regclass
                        and not g.tgisinternal);
  if v_missing is not null then
    raise exception '13.9 post-check failed: archived planning guard missing on %', v_missing;
  end if;

  -- The guard must answer before every other BEFORE row trigger on its table.
  select string_agg(c.relname, ', ') into v_not_first
    from pg_catalog.pg_trigger g
    join pg_catalog.pg_class c on c.oid = g.tgrelid
   where g.tgname = 'block_archived_project_planning'
     and exists (select 1 from pg_catalog.pg_trigger o
                  where o.tgrelid = g.tgrelid and not o.tgisinternal
                    and (o.tgtype & 2) = 2 and (o.tgtype & 1) = 1   -- BEFORE ... FOR EACH ROW
                    and o.tgname < g.tgname);
  if v_not_first is not null then
    raise exception '13.9 post-check failed: another BEFORE row trigger fires before the archived guard on %', v_not_first;
  end if;

  if has_function_privilege('authenticated', 'public.guard_archived_project_planning()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_archived_project_planning()', 'EXECUTE') then
    raise exception '13.9 post-check failed: the guard must not be directly callable by clients.';
  end if;

  -- Scope boundary: the shared operations predicate is NOT made archive-aware
  -- here (it backs Project Setup, Organization Chart, Documents and Calendar).
  if (select prosrc from pg_catalog.pg_proc
       where oid = 'public.can_manage_project_operations(uuid)'::regprocedure) ~ 'project_is_archived' then
    raise exception '13.9 post-check failed: can_manage_project_operations() was changed.';
  end if;

  -- The 2C.3E guards are still in place.
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'block_archived_project_setup') < 8 then
    raise exception '13.9 post-check failed: the 2C.3E archived setup guards are missing.';
  end if;
end;
$post$;
