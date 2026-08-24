-- EPRP Phase 13.4 / Reporting Integration Wave 1
-- Governed Weekly report-observation integrity + Weekly milestone drafts.
--
-- Scope is deliberately additive:
--   * Master Milestone identity and reconciliation semantics are unchanged.
--   * Weekly Next Week tasks and legacy free-text milestone plan rows remain.
--   * Monthly, Dashboard, Executive and Master Deliverables are untouched.
--
-- Authorization reconciliation:
-- `can_manage_reporting_workflow()` currently includes the assigned Reporting
-- Coordinator, while `can_manage_project_operations()` deliberately excludes
-- that role from governed milestone writes. The finalized-report hook below
-- therefore submits Weekly observations only for Project Control authority and
-- always leaves them pending. The stored `auto_on_report_finalized` option is
-- mapped by the application in this wave, but is NOT allowed to bypass that
-- committed authorization boundary.

/* ------------------------ existing-data preconditions -------------------- */

do $preconditions$
begin
  if exists (
    select 1
      from public.milestone_updates u
     where u.source = 'weekly'
       and (
         u.weekly_report_id is null
         or u.monthly_report_id is not null
         or u.as_of_date is null
       )
  ) then
    raise exception
      'Reporting Integration Wave 1 found an incomplete report-sourced milestone update. Resolve it before applying this migration.';
  end if;

  if exists (
    select 1
      from public.milestone_updates u
      join public.master_milestones m on m.id = u.milestone_id
      join public.weekly_reports w on w.id = u.weekly_report_id
     where u.source = 'weekly'
       and (m.project_id <> w.project_id or u.as_of_date <> w.period_end)
  ) then
    raise exception
      'Reporting Integration Wave 1 found a Weekly milestone update with a cross-project report or a cut-off different from period_end.';
  end if;

  if exists (
    select 1
      from public.milestone_updates u
     where u.source = 'weekly'
     group by u.weekly_report_id, u.milestone_id, u.as_of_date
    having count(*) > 1
  ) then
    raise exception
      'Reporting Integration Wave 1 found duplicate Weekly report/milestone/cut-off observations. Reconcile them before applying this migration.';
  end if;
end;
$preconditions$;

/* ------------------- governed report-observation integrity --------------- */

alter table public.milestone_updates
  drop constraint if exists milestone_updates_source_report;

alter table public.milestone_updates
  add constraint milestone_updates_source_report check (
    (source = 'weekly'
      and weekly_report_id is not null
      and monthly_report_id is null
      and as_of_date is not null)
    -- Monthly keeps the exact pre-Wave-1 contract. Monthly provenance,
    -- cut-off and idempotency belong to Reporting Integration Wave 2.
    or (source = 'monthly' and weekly_report_id is null)
    or (source in ('planning', 'reconciliation')
      and weekly_report_id is null
      and monthly_report_id is null)
  );

create unique index milestone_updates_weekly_idempotency
  on public.milestone_updates(weekly_report_id, milestone_id, as_of_date)
  where source = 'weekly';

comment on index public.milestone_updates_weekly_idempotency is
  'One governed Weekly observation per report, milestone and reporting cut-off. Exact-content retries are accepted; conflicting retries are rejected.';

create or replace function public.guard_milestone_report_observation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_milestone_project uuid;
  v_report_project uuid;
  v_period_end date;
begin
  if new.source = 'weekly' then
    select m.project_id
      into v_milestone_project
      from public.master_milestones m
     where m.id = new.milestone_id;

    -- Serialize report provenance changes with observation insertion. FOR SHARE
    -- conflicts with UPDATE of project_id/period_end but remains compatible
    -- with reads and with the report-row lock already held by finalization.
    select w.project_id, w.period_end
      into v_report_project, v_period_end
      from public.weekly_reports w
     where w.id = new.weekly_report_id
       for share;

    if v_milestone_project is distinct from v_report_project then
      raise exception
        'A Weekly milestone observation and its report must belong to the same project.'
        using errcode = 'foreign_key_violation';
    end if;

    if new.as_of_date is distinct from v_period_end then
      raise exception
        'A Weekly milestone observation cut-off must equal the Weekly report period end.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists milestone_updates_report_integrity
  on public.milestone_updates;
create trigger milestone_updates_report_integrity
  before insert or update of
    milestone_id, source, weekly_report_id, monthly_report_id, as_of_date
  on public.milestone_updates
  for each row execute function public.guard_milestone_report_observation();

revoke execute on function public.guard_milestone_report_observation()
  from public, anon, authenticated, service_role;

/* ---------------------- immutable Weekly provenance --------------------- */

create or replace function public.guard_weekly_report_milestone_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (new.project_id is distinct from old.project_id
      or new.period_end is distinct from old.period_end)
     and exists (
       select 1
         from public.milestone_updates u
        where u.source = 'weekly'
          and u.weekly_report_id = old.id
     ) then
    raise exception
      'A Weekly report project and period end cannot change after governed milestone observations exist. Create a new report revision instead.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists weekly_report_milestone_provenance_guard
  on public.weekly_reports;
create trigger weekly_report_milestone_provenance_guard
  before update of project_id, period_end on public.weekly_reports
  for each row execute function public.guard_weekly_report_milestone_provenance();

revoke execute on function public.guard_weekly_report_milestone_provenance()
  from public, anon, authenticated, service_role;

/* ------------------------- editable Weekly draft ------------------------- */

create table public.weekly_milestone_drafts (
  id uuid primary key default gen_random_uuid(),
  weekly_report_id uuid not null
    references public.weekly_reports(id) on delete cascade,
  milestone_id uuid not null
    references public.master_milestones(id) on delete restrict,
  status text not null default 'not_started',
  progress_percent integer,
  forecast_date date,
  actual_date date,
  narrative text,
  sort_order integer not null default 0,
  created_by_contact_id uuid references public.contacts(id) on delete set null,
  updated_by_contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_milestone_drafts_report_milestone_unique
    unique (weekly_report_id, milestone_id),
  constraint weekly_milestone_drafts_status_valid
    check (status in ('not_started', 'in_progress', 'completed', 'delayed')),
  constraint weekly_milestone_drafts_progress_range
    check (progress_percent is null or progress_percent between 0 and 100)
);

comment on table public.weekly_milestone_drafts is
  'Editable Weekly authoring rows linked to active Master Milestones. Finalization appends immutable pending milestone_updates; it never edits a submitted observation.';
comment on column public.weekly_milestone_drafts.milestone_id is
  'Required governed identity link. No title is stored and no title matching is permitted.';

create index weekly_milestone_drafts_report_order
  on public.weekly_milestone_drafts(weekly_report_id, sort_order, created_at);

create or replace function public.guard_weekly_milestone_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_report_id uuid;
  v_milestone_id uuid;
  v_report_project uuid;
  v_report_status text;
  v_milestone_project uuid;
  v_milestone_active boolean;
  v_actor uuid;
begin
  -- A draft belongs permanently to the report that created it. UPDATE and
  -- DELETE therefore serialize on the original parent; INSERT serializes on
  -- its new parent. No workflow needs or permits locking two report rows.
  v_report_id := case when tg_op = 'INSERT'
    then new.weekly_report_id else old.weekly_report_id end;
  v_milestone_id := case when tg_op = 'DELETE'
    then old.milestone_id else new.milestone_id end;

  -- The report row is the transaction's serialization point. A draft mutation
  -- that gets this lock first commits before finalization reads the drafts; a
  -- mutation that arrives after finalization waits, observes the immutable
  -- status, and is refused. This covers INSERT, UPDATE and DELETE uniformly.
  select w.project_id, w.status
    into v_report_project, v_report_status
    from public.weekly_reports w
   where w.id = v_report_id
     for update;

  -- During an ON DELETE CASCADE from weekly_reports the parent row is already
  -- invisible to this child trigger. Let that parent-owned cleanup proceed;
  -- a direct draft delete still finds and locks the parent above.
  if not found and tg_op = 'DELETE' then
    return old;
  end if;

  if not found then
    raise exception 'Weekly report % not found.', v_report_id
      using errcode = 'foreign_key_violation';
  end if;

  if tg_op = 'UPDATE'
     and new.weekly_report_id is distinct from old.weekly_report_id then
    raise exception
      'A Weekly milestone draft cannot be reassigned to another Weekly report.'
      using errcode = 'restrict_violation';
  end if;

  if v_report_status in ('finalized', 'locked', 'archived') then
    raise exception
      'This Weekly milestone draft belongs to immutable report history. Create a new report revision instead.'
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select m.project_id, m.active
    into v_milestone_project, v_milestone_active
    from public.master_milestones m
   where m.id = v_milestone_id;

  if v_milestone_project is distinct from v_report_project then
    raise exception
      'A Weekly milestone draft may select only a Master Milestone from the report project.'
      using errcode = 'foreign_key_violation';
  end if;

  if not coalesce(v_milestone_active, false) then
    raise exception
      'An archived Master Milestone cannot be selected for a new Weekly observation.'
      using errcode = 'check_violation';
  end if;

  v_actor := public.current_contact_id();
  if v_actor is null then
    raise exception 'Weekly milestone draft provenance requires an authenticated contact.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    new.created_by_contact_id := v_actor;
  elsif new.created_by_contact_id is distinct from old.created_by_contact_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Weekly milestone draft creation provenance is immutable.'
      using errcode = 'restrict_violation';
  end if;
  new.updated_by_contact_id := v_actor;
  new.updated_at := now();

  return new;
end;
$fn$;

create trigger weekly_milestone_drafts_guard
  before insert or update or delete on public.weekly_milestone_drafts
  for each row execute function public.guard_weekly_milestone_draft();

revoke execute on function public.guard_weekly_milestone_draft()
  from public, anon, authenticated, service_role;

alter table public.weekly_milestone_drafts enable row level security;

revoke all on table public.weekly_milestone_drafts from anon, authenticated;
grant select, insert, update, delete on table public.weekly_milestone_drafts
  to authenticated, service_role;

create policy weekly_milestone_drafts_select
  on public.weekly_milestone_drafts
  for select to authenticated
  using (public.weekly_can_access_project(
    public.weekly_report_project(weekly_report_id)));

create policy weekly_milestone_drafts_insert
  on public.weekly_milestone_drafts
  for insert to authenticated
  with check (public.can_manage_project_operations(
    public.weekly_report_project(weekly_report_id)));

create policy weekly_milestone_drafts_update
  on public.weekly_milestone_drafts
  for update to authenticated
  using (public.can_manage_project_operations(
    public.weekly_report_project(weekly_report_id)))
  with check (public.can_manage_project_operations(
    public.weekly_report_project(weekly_report_id)));

create policy weekly_milestone_drafts_delete
  on public.weekly_milestone_drafts
  for delete to authenticated
  using (public.can_manage_project_operations(
    public.weekly_report_project(weekly_report_id)));

/* ---------------------- finalization -> pending stream ------------------- */

create or replace function public.submit_finalized_weekly_milestones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_candidate record;
  v_existing public.milestone_updates%rowtype;
  v_inserted_id uuid;
begin
  if not exists (
    select 1
      from public.weekly_milestone_drafts d
     where d.weekly_report_id = new.id
  ) then
    return new;
  end if;

  -- The controlled Weekly writer currently admits Reporting Coordinators, but
  -- the committed milestone policy deliberately does not. Keep that boundary
  -- explicit inside this security-definer trigger so finalization cannot turn
  -- into an RLS bypass.
  if not public.can_manage_project_operations(new.project_id) then
    raise exception
      'Project Control must finalize a Weekly report that carries governed milestone observations.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1
      from public.weekly_milestone_drafts d
      join public.master_milestones m on m.id = d.milestone_id
     where d.weekly_report_id = new.id
       and (m.project_id <> new.project_id or not m.active)
  ) then
    raise exception
      'A Weekly milestone draft no longer points to an active Master Milestone in this project.'
      using errcode = 'check_violation';
  end if;

  for v_candidate in
    select
      d.milestone_id,
      m.department_id,
      m.discipline_id,
      d.status,
      d.progress_percent,
      d.forecast_date,
      d.actual_date,
      d.narrative,
      d.progress_percent is not null
        and official.progress_percent is not null
        and d.progress_percent < official.progress_percent as is_regression,
      coalesce(
        d.updated_by_contact_id,
        d.created_by_contact_id,
        public.current_contact_id()
      ) as submitted_by_contact_id
    from public.weekly_milestone_drafts d
    join public.master_milestones m on m.id = d.milestone_id
    left join lateral (
    /*
     * Mirrors milestoneState() only for the R7 regression flag:
     * latest resolved dated cut-off, then latest approved undated legacy row.
     * It never chooses a value from an unresolved cut-off.
     */
    select coalesce(
      (
        select resolved.progress_percent
          from (
            select
              u.as_of_date,
              coalesce(
                (
                  select r.progress_percent
                    from public.milestone_updates r
                   where r.milestone_id = d.milestone_id
                     and r.as_of_date = u.as_of_date
                     and r.source = 'reconciliation'
                     and r.approval_status = 'approved'
                   order by r.submitted_at desc, r.id desc
                   limit 1
                ),
                case
                  when count(distinct u.progress_percent)
                       filter (where u.source <> 'reconciliation'
                                    and u.progress_percent is not null) = 1
                  then min(u.progress_percent)
                       filter (where u.source <> 'reconciliation'
                                    and u.progress_percent is not null)
                end
              ) as progress_percent
            from public.milestone_updates u
           where u.milestone_id = d.milestone_id
             and u.approval_status = 'approved'
             and u.as_of_date is not null
           group by u.as_of_date
          ) resolved
         where resolved.progress_percent is not null
         order by resolved.as_of_date desc
         limit 1
      ),
      (
        select legacy.progress_percent
          from public.milestone_updates legacy
         where legacy.milestone_id = d.milestone_id
           and legacy.approval_status = 'approved'
           and legacy.as_of_date is null
         order by legacy.submitted_at desc, legacy.id desc
         limit 1
      )
    ) as progress_percent
    ) official on true
    where d.weekly_report_id = new.id
    order by d.milestone_id
  loop
    v_inserted_id := null;

    insert into public.milestone_updates (
      milestone_id,
      source,
      weekly_report_id,
      monthly_report_id,
      department_id,
      discipline_id,
      status,
      progress_percent,
      forecast_date,
      actual_date,
      narrative,
      is_regression,
      submitted_by_contact_id,
      approval_status,
      as_of_date
    ) values (
      v_candidate.milestone_id,
      'weekly',
      new.id,
      null,
      v_candidate.department_id,
      v_candidate.discipline_id,
      v_candidate.status,
      v_candidate.progress_percent,
      v_candidate.forecast_date,
      v_candidate.actual_date,
      v_candidate.narrative,
      v_candidate.is_regression,
      v_candidate.submitted_by_contact_id,
      'pending',
      new.period_end
    )
    on conflict (weekly_report_id, milestone_id, as_of_date)
      where source = 'weekly'
    do nothing
    returning id into v_inserted_id;

    if v_inserted_id is null then
      select u.*
        into v_existing
        from public.milestone_updates u
       where u.source = 'weekly'
         and u.weekly_report_id = new.id
         and u.milestone_id = v_candidate.milestone_id
         and u.as_of_date = new.period_end;

      if not found then
        raise exception
          'A concurrent Weekly milestone retry could not resolve its existing observation.'
          using errcode = 'serialization_failure';
      end if;

      -- Compare only immutable submission/provenance content represented by
      -- the finalized draft. Governance may later change approval metadata,
      -- regression assessment/reason, commercial/client facts or
      -- reconciliation metadata. A retry must neither compare nor overwrite
      -- those governed fields.
      if v_existing.monthly_report_id is not null
         or v_existing.department_id is distinct from v_candidate.department_id
         or v_existing.discipline_id is distinct from v_candidate.discipline_id
         or v_existing.status is distinct from v_candidate.status
         or v_existing.progress_percent is distinct from v_candidate.progress_percent
         or v_existing.forecast_date is distinct from v_candidate.forecast_date
         or v_existing.actual_date is distinct from v_candidate.actual_date
         or v_existing.narrative is distinct from v_candidate.narrative
         or v_existing.submitted_by_contact_id is distinct from
              v_candidate.submitted_by_contact_id
      then
        raise exception
          'Weekly milestone finalization conflicts with an existing observation under the same report, milestone and cut-off key.'
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  -- Manual mode is the only safe implemented path in Wave 1. Every inserted
  -- row stays pending until the existing Project Control decision path acts.
  return new;
end;
$fn$;

drop trigger if exists weekly_finalized_submit_milestones
  on public.weekly_reports;
create trigger weekly_finalized_submit_milestones
  after update of status on public.weekly_reports
  for each row
  when (new.status = 'finalized' and old.status is distinct from new.status)
  execute function public.submit_finalized_weekly_milestones();

revoke execute on function public.submit_finalized_weekly_milestones()
  from public, anon, authenticated, service_role;

/* ------------------------------- postconditions -------------------------- */

do $postconditions$
declare
  v_rls boolean;
begin
  select c.relrowsecurity
    into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'weekly_milestone_drafts';

  if v_rls is distinct from true then
    raise exception 'weekly_milestone_drafts must have RLS enabled.';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename = 'weekly_milestone_drafts') <> 4 then
    raise exception 'weekly_milestone_drafts must have exactly four operation-specific policies.';
  end if;

  if has_function_privilege('anon',
       'public.submit_finalized_weekly_milestones()', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.submit_finalized_weekly_milestones()', 'EXECUTE') then
    raise exception 'The finalization trigger function must not be directly callable.';
  end if;

  if to_regclass('public.milestone_updates_monthly_idempotency') is not null then
    raise exception 'Monthly idempotency must remain deferred to Reporting Integration Wave 2.';
  end if;
end;
$postconditions$;
