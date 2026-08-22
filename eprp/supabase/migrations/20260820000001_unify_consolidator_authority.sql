-- EPRP P0.6 — one canonical Project Control / Reporting Coordinator rule.
--
-- LOCKED DECISION
--   docs/02_PLATFORM_ARCHITECTURE.md §24.3. Project Control Manager and
--   Reporting Coordinator are PROJECT ASSIGNMENTS, not platform roles. They are
--   many-to-many in both directions, and every layer must resolve them from ONE
--   definition. Two implementations of one authority rule is a defect.
--
-- WHAT WAS WRONG
--   Three implementations existed and they disagreed:
--
--     is_project_consolidator()     reads projects.*_id  AND project_contacts.role
--     weekly_can_manage_project()   reads projects.*_id  only
--     TypeScript (three call sites) reads projects.*_id  only
--
--   Consequence: a consolidator assigned through project_contacts was admitted
--   for READ by weekly_can_access_project() (which already delegates to
--   is_project_consolidator) and refused for MANAGE by weekly_can_manage_project()
--   -- able to open a project Weekly but not to manage its documents, sites,
--   milestones, deliverables, calendar or department scope. Read and write
--   disagreed about who the same person was.
--
-- WHAT THIS DOES
--   Redefines ONE function so it delegates to the existing canonical predicate.
--   is_project_consolidator() is already correct and is NOT modified; this
--   migration makes it the single source it was always meant to be.
--
--   No policy is created, dropped or rewritten. No table, column, trigger or
--   row changes. These tables inherit the fix through the helper they already
--   call:
--     project_departments . project_sites . project_documents (+ storage.objects)
--     project_positions . project_events . project_event_attendees
--     master_milestones . master_deliverables . milestone_updates
--     deliverable_updates . weekly_plan_items
--     and all four monthly_* tables via monthly_can_manage_project()
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--   can_bin_project_document() keeps reading projects.project_control_manager_id
--   directly. That is a NARROWER rule -- Project Control Manager only, never the
--   Reporting Coordinator -- and 20260819000002 states that separation
--   explicitly. Widening the consolidator rule must not widen who may bin a
--   reference document, so the two stay separate functions. (That it still reads
--   only the singular column, and so would refuse a project_contacts-assigned
--   Project Control Manager, is a known narrower-than-24.3 gap. It fails CLOSED
--   -- it denies, it never escalates -- and is P1, not a P0 blocker.)
--
-- DIRECTION OF CHANGE
--   This migration WIDENS write authority. It is the only P0 step that does.
--   The pre-check below names every account that gains rights, so applying it
--   cannot silently hand anyone authority nobody reviewed.

/* ----------------------- Pre-check: who gains rights? --------------------- */

do $pre$
declare
  orphans integer;
  r record;
begin
  -- Rows carrying a consolidation role that are NOT mirrored by the project
  -- singular column. These are exactly the assignments that gain MANAGE rights
  -- when this migration applies; everyone else already had them.
  --
  -- The application mirrors the singular columns into project_contacts on every
  -- project save (replaceResponsibilityContacts in supabase-project-service.ts),
  -- so for app-created data this count is expected to be ZERO and the migration
  -- is a no-op in practice. A non-zero count is not an error -- it is the
  -- many-to-many case 24.3 permits -- but it must be seen, not discovered later.
  select count(*) into orphans
    from public.project_contacts pc
    join public.projects pr on pr.id = pc.project_id
   where pc.role in ('project_control_manager', 'reporting_coordinator')
     and pc.contact_id is distinct from pr.project_control_manager_id
     and pc.contact_id is distinct from pr.reporting_coordinator_id;

  if orphans = 0 then
    raise notice 'P0.6 pre-check: 0 assignments gain rights - every consolidator row is mirrored by its project column. No-op on current data.';
  else
    raise notice 'P0.6 pre-check: % assignment(s) GAIN manage rights. Listed below.', orphans;
    for r in
      select pr.code as project_code, c.name as contact_name, pc.role as pc_role
        from public.project_contacts pc
        join public.projects pr on pr.id = pc.project_id
        join public.contacts c on c.id = pc.contact_id
       where pc.role in ('project_control_manager', 'reporting_coordinator')
         and pc.contact_id is distinct from pr.project_control_manager_id
         and pc.contact_id is distinct from pr.reporting_coordinator_id
       order by pr.code, c.name
    loop
      raise notice '  GAINS MANAGE: % on % (%)', r.contact_name, r.project_code, r.pc_role;
    end loop;
  end if;
end;
$pre$;

/* --------------------------- The single change ---------------------------- */

create or replace function public.weekly_can_manage_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  -- One rule, one place. is_system_admin() stays FIRST so an administrator
  -- whose profile is not linked to a contact keeps full access, exactly as
  -- every other predicate in this schema short-circuits.
  select public.is_system_admin()
      or public.is_project_consolidator(p_project);
$fn$;

comment on function public.weekly_can_manage_project(uuid) is
  'Whether the caller may MANAGE a project: System Administrator, or a project consolidator per is_project_consolidator(). Canonical per docs/02_PLATFORM_ARCHITECTURE.md 24.3 - Project Control Manager and Reporting Coordinator are project assignments, many-to-many, resolved from one definition shared with the application layer. NOT the same rule as can_bin_project_document(), which is Project Control Manager only.';

/* -------------------------- Post-condition check -------------------------- */

do $post$
declare
  body text;
  consolidator_exists boolean;
begin
  -- The dependency must exist, or the redefinition above is a silent denial.
  select exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_project_consolidator'
  ) into consolidator_exists;

  if not consolidator_exists then
    raise exception 'Post-check failed: is_project_consolidator() does not exist, so weekly_can_manage_project() would deny everyone but administrators.';
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'weekly_can_manage_project';

  if body not like '%is_project_consolidator%' then
    raise exception 'Post-check failed: weekly_can_manage_project() does not delegate to is_project_consolidator().';
  end if;

  -- The whole point of the change: the singular columns must no longer be read
  -- by this function directly. Reading them here again would mean a second
  -- implementation had crept back in.
  if body like '%project_control_manager_id%' or body like '%reporting_coordinator_id%' then
    raise exception 'Post-check failed: weekly_can_manage_project() still reads the project columns directly - the rule is implemented twice again.';
  end if;

  -- can_bin_project_document must remain the narrower, separate rule.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'can_bin_project_document';

  if body is not null and body like '%is_project_consolidator%' then
    raise exception 'Post-check failed: can_bin_project_document() must NOT use the consolidator rule - binning is Project Control Manager only.';
  end if;

  raise notice 'P0.6 applied: weekly_can_manage_project() now delegates to is_project_consolidator(); can_bin_project_document() unchanged.';
end;
$post$;
