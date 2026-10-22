-- Phase 13.11 UAT (P1) — a "no formal schedule" project has no Working Plan
-- authoring. LOCAL ONLY.
--
-- Architecture: docs/02_PLATFORM_ARCHITECTURE.md §26.14 (a project with no
-- formal schedule is not planning-governed) and §26.24.6 (moving it under
-- planning is a governed onboarding-mode change in Project Setup).
--
-- THE GAP THIS CLOSES
--   13.9B refuses publishing and Opening Position promotion for a
--   no_formal_schedule project (inside publish_planning_snapshot()), and 13.11
--   refuses its Planning Configuration. But nodes, activities, imports, import
--   rows, decision-log rows, baselines, Opening Positions and milestone links
--   could still be written for it — directly through the API and through the
--   Planning Workspace (Master Plan "Add Node / Add Activity", Imports &
--   Review "Import schedule").
--
-- WHAT THIS ADDS
--   guard_no_formal_schedule_planning(): BEFORE INSERT OR UPDATE on those
--   eight tables, refusing the write with [NOT_PLANNING_GOVERNED] / 42501
--   while the project's onboarding mode is no_formal_schedule — for every
--   role (System Administrator and Project Control Admin included). Once the
--   Planning Approach is changed in Project Setup to a schedule-governed mode,
--   writes are allowed again with no other change.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * Reads: the Planning Workspace stays readable (history, orientation).
--   * DELETE is not guarded: no planning table has a client DELETE path except
--     milestone unlinking, and a project's own cascade must keep working.
--   * planning_snapshots / planning_snapshot_activities: publishing is already
--     refused for this mode inside publish_planning_snapshot() (13.9B), which
--     is the one publish path; the 13.9B fixtures that model the legacy
--     "no_formal_schedule with a snapshot" state are left valid.
--   * project_planning_settings: the onboarding mode itself is governed by
--     13.9B; the 13.11 configuration columns are already refused.
--   * The 13.9 archived guard, can_manage_project_operations() and every RLS
--     policy are unchanged. No row is written or repaired.

create function public.guard_no_formal_schedule_planning()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_project uuid;
begin
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

comment on function public.guard_no_formal_schedule_planning() is
  '13.11 UAT. Refuses every INSERT / UPDATE of planning authoring rows (nodes, activities, imports, import rows, decision log, baselines, Opening Positions, milestone links) while the project''s onboarding mode is no_formal_schedule, for every role, with [NOT_PLANNING_GOVERNED] / 42501. Reads unaffected.';

revoke execute on function public.guard_no_formal_schedule_planning() from public, anon, authenticated;

do $install$
declare
  v_table text;
begin
  foreach v_table in array array[
    'planning_work_items', 'planning_activities', 'planning_import_batches', 'planning_import_rows',
    'planning_confirmations', 'planning_baselines', 'planning_opening_positions', 'planning_milestone_links']
  loop
    execute format('create trigger guard_no_formal_schedule_planning before insert or update on public.%I '
                   'for each row execute function public.guard_no_formal_schedule_planning()', v_table);
  end loop;
end;
$install$;

do $post$
begin
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'guard_no_formal_schedule_planning') <> 8 then
    raise exception 'post-check failed: the no-formal-schedule guard must be on exactly its 8 tables';
  end if;
  -- The 13.9 archived guard still answers first ("block_…" < "guard_…").
  if 'block_archived_project_planning' > 'guard_no_formal_schedule_planning' then
    raise exception 'post-check failed: trigger order';
  end if;
  if has_function_privilege('authenticated', 'public.guard_no_formal_schedule_planning()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_no_formal_schedule_planning()', 'EXECUTE') then
    raise exception 'post-check failed: the guard must not be client-callable';
  end if;
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'block_archived_project_planning') <> 16 then
    raise exception 'post-check failed: the 13.9 archived planning guard must stay on its 16 tables';
  end if;
end;
$post$;
