-- EPRP Phase 13.2 — Master Milestones.
--
-- Two tables, and the rule that separates them:
--
--   master_milestones  IDENTITY. What a milestone IS — code, name, scope,
--                      baseline, owner. Changes rarely, and only through
--                      Project Control.
--   milestone_updates  STATE. What is TRUE of it right now — status, progress,
--                      forecast. Append-only; current state is the latest
--                      APPROVED row.
--
-- That split is decision D3 and it is what makes "one source of truth" real
-- rather than asserted. Putting status on the master row as well would give two
-- writable stores of the same fact with no rule for which wins.
--
-- Frozen rules honoured here:
--   R1  this register is the only place a milestone identity exists
--   R2  identity originates manual | scope  (schedule arrives in 13.5)
--   R3  nothing outside Project Control writes identity
--   R4  Weekly/Monthly submit updates, never identities
--   R5  current state = latest APPROVED update
--   R6  Project Control approves; auto-approval is a per-project setting
--   R7  a regression is flagged and needs a reason, never a silent overwrite
--
-- Additive only. No existing table, row, policy or helper is modified.

/* ========================== master_milestones ============================= */

create table public.master_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,

  code text not null,
  name text not null,
  description text,

  -- Scope. Every level is nullable because every hierarchy link in this schema
  -- is nullable — a missing parent is a normal state, not a defect.
  -- RESTRICT on the levels that carry meaning: master data is archived, never
  -- deleted, so a milestone can never be orphaned by a deletion.
  department_id uuid references public.departments(id) on delete restrict,
  system_id uuid references public.systems(id) on delete set null,
  -- Stays named discipline_id. "Programs & Studies" is display wording only;
  -- renaming storage would be migration risk with no user-visible benefit.
  discipline_id uuid references public.disciplines(id) on delete restrict,

  -- The plan. Forecast, actual, status and progress are deliberately ABSENT —
  -- they live in milestone_updates.
  baseline_date date,
  priority text not null default 'medium',
  owner_contact_id uuid references public.contacts(id) on delete set null,

  -- Provenance. 'schedule' is added in 13.5 together with the table it needs;
  -- adding it now would leave a value nothing can produce.
  source text not null default 'manual',
  source_document_id uuid references public.project_documents(id) on delete set null,

  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint master_milestones_code_not_blank check (length(btrim(code)) > 0),
  constraint master_milestones_name_not_blank check (length(btrim(name)) > 0),
  constraint master_milestones_priority_valid
    check (priority in ('low', 'medium', 'high', 'critical')),
  constraint master_milestones_source_valid
    check (source in ('manual', 'scope'))
);

comment on table public.master_milestones is
  'The authoritative milestone register for a project (Phase 13.2). Identity and plan only — current status, progress and forecast are derived from the latest approved row in milestone_updates.';

-- Case-insensitive on the trimmed code, matching the convention job_titles
-- already uses for user-entered codes: "M-01" and "m-01" are one code.
create unique index master_milestones_project_code_unique
  on public.master_milestones(project_id, lower(btrim(code)));

create index master_milestones_project_scope
  on public.master_milestones(project_id, department_id, discipline_id)
  where active;

create trigger set_updated_at
  before update on public.master_milestones
  for each row execute function public.set_updated_at();

/* ========================== milestone_updates ============================= */

create table public.milestone_updates (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT, not CASCADE: an update stream is the milestone's history, and a
  -- milestone carrying history must be archived rather than deleted.
  milestone_id uuid not null references public.master_milestones(id) on delete restrict,

  -- Which channel proposed this. 'schedule_import' joins in 13.5.
  source text not null,
  -- Set when the update came through a report. No project_id here: the project
  -- is reached through the milestone, never duplicated onto the child row.
  weekly_report_id uuid references public.weekly_reports(id) on delete set null,
  monthly_report_id uuid references public.monthly_reports(id) on delete set null,

  -- Scope carried explicitly so the row can be narrowed by
  -- weekly_can_access_scope, exactly as every other Weekly-scoped table is.
  -- A NULL discipline_id means department-level, not unknown.
  department_id uuid references public.departments(id) on delete set null,
  discipline_id uuid references public.disciplines(id) on delete set null,

  -- The reported facts.
  status text not null,
  progress_percent integer,
  forecast_date date,
  actual_date date,
  narrative text,

  -- Governance. Separate from the facts above: this records whether Project
  -- Control accepts the REPORT, not what the report says.
  approval_status text not null default 'pending',
  approved_by_contact_id uuid references public.contacts(id) on delete set null,
  approved_at timestamptz,
  decision_note text,

  -- Regression control (R7). Flagged at submission; a reason is required before
  -- an approver may accept it.
  is_regression boolean not null default false,
  regression_reason text,

  submitted_by_contact_id uuid references public.contacts(id) on delete set null,
  submitted_at timestamptz not null default now(),

  constraint milestone_updates_source_valid
    check (source in ('weekly', 'monthly', 'planning')),
  -- The same four values weekly_plan_items already uses, so the platform never
  -- carries two milestone status vocabularies.
  constraint milestone_updates_status_valid
    check (status in ('not_started', 'in_progress', 'completed', 'delayed')),
  constraint milestone_updates_progress_range
    check (progress_percent is null or progress_percent between 0 and 100),
  constraint milestone_updates_approval_valid
    check (approval_status in ('pending', 'approved', 'rejected')),
  -- An approved or rejected row must say who decided and when.
  constraint milestone_updates_decision_complete check (
    (approval_status = 'pending' and approved_at is null)
    or (approval_status <> 'pending' and approved_at is not null)
  ),
  -- An accepted regression must carry its reason. This is the whole of R7:
  -- progress may go backwards, but never silently.
  constraint milestone_updates_regression_reason check (
    not (is_regression and approval_status = 'approved')
    or length(btrim(coalesce(regression_reason, ''))) > 0
  ),
  -- A report-sourced row names its report; a planning row does not.
  constraint milestone_updates_source_report check (
    (source = 'weekly' and monthly_report_id is null)
    or (source = 'monthly' and weekly_report_id is null)
    or (source = 'planning' and weekly_report_id is null and monthly_report_id is null)
  )
);

comment on table public.milestone_updates is
  'Append-only state stream for master_milestones (Phase 13.2). Current milestone state is the latest row with approval_status = approved. Reported content is immutable once written; only the approval decision may transition, once.';

-- The lookup behind current state: newest approved row per milestone.
create index milestone_updates_current
  on public.milestone_updates(milestone_id, submitted_at desc)
  where approval_status = 'approved';

-- The approval queue.
create index milestone_updates_pending
  on public.milestone_updates(approval_status, submitted_at)
  where approval_status = 'pending';

create index milestone_updates_by_weekly
  on public.milestone_updates(weekly_report_id)
  where weekly_report_id is not null;

/* ===================== per-project approval setting ======================= */

-- R6: manual approval is the default; a project may opt into auto-approval for
-- finalized report workflows. Follows the existing reporting-config columns on
-- projects (weekly_enabled, monthly_cutoff_day, …) rather than a new table.
alter table public.projects
  add column if not exists milestone_update_approval text not null default 'manual';

alter table public.projects
  add constraint projects_milestone_update_approval_valid
    check (milestone_update_approval in ('manual', 'auto_on_report_finalized'));

comment on column public.projects.milestone_update_approval is
  'How milestone updates become official. manual (default) = Project Control approves each one; auto_on_report_finalized = updates from a report auto-approve when that report is finalized.';

/* ============================== helpers =================================== */

/*
 * Resolve a milestone's project.
 *
 * A dedicated security-definer helper, NOT a subquery inside a policy: a raw
 * subquery re-enters master_milestones' own SELECT policy and silently denies
 * or recurses. This mirrors the existing weekly_report_project().
 */
create or replace function public.milestone_project(p_milestone uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select project_id from public.master_milestones where id = p_milestone;
$$;

comment on function public.milestone_project(uuid) is
  'The project a milestone belongs to. Security definer so RLS policies on milestone_updates can reach it without re-entering master_milestones RLS.';

/*
 * Reported content is immutable; the approval decision may transition once.
 *
 * Policies cannot express "these columns are frozen but those may change", and
 * "append-only" written in a comment is not a guarantee. This is the guarantee.
 */
create or replace function public.guard_milestone_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.milestone_id is distinct from old.milestone_id
     or new.source is distinct from old.source
     or new.weekly_report_id is distinct from old.weekly_report_id
     or new.monthly_report_id is distinct from old.monthly_report_id
     or new.department_id is distinct from old.department_id
     or new.discipline_id is distinct from old.discipline_id
     or new.status is distinct from old.status
     or new.progress_percent is distinct from old.progress_percent
     or new.forecast_date is distinct from old.forecast_date
     or new.actual_date is distinct from old.actual_date
     or new.narrative is distinct from old.narrative
     or new.is_regression is distinct from old.is_regression
     or new.submitted_by_contact_id is distinct from old.submitted_by_contact_id
     or new.submitted_at is distinct from old.submitted_at
  then
    raise exception
      'A milestone update is a record of what was reported and cannot be edited. Submit a new update instead.'
      using errcode = 'restrict_violation';
  end if;

  -- A decision is final. Reversing one would rewrite history that other tiers
  -- have already read; the correction is a new update.
  if old.approval_status <> 'pending'
     and new.approval_status is distinct from old.approval_status
  then
    raise exception
      'This update has already been decided. Submit a new update rather than changing the decision.'
      using errcode = 'restrict_violation';
  end if;

  if new.approval_status is distinct from old.approval_status then
    new.approved_at := coalesce(new.approved_at, now());
    new.approved_by_contact_id :=
      coalesce(new.approved_by_contact_id, public.current_contact_id());
  end if;

  return new;
end;
$$;

create trigger milestone_updates_guard
  before update on public.milestone_updates
  for each row execute function public.guard_milestone_update();

/* ================================= RLS ==================================== */

-- Lockout pre-check: never tighten access without an administrator who can undo it.
do $$
begin
  -- P1.0: this guard exists to stop a migration locking out EXISTING accounts.
  -- With an empty profiles table there are none, so it is skipped rather than
  -- failing a fresh environment. Protection is unchanged whenever any profile
  -- exists.
  if (select count(*) from public.profiles
       where role = 'system_admin' and active) = 0
     and exists (select 1 from public.profiles) then
    raise exception 'Refusing to add policies: no active system administrator exists';
  end if;
end $$;

alter table public.master_milestones enable row level security;

create policy master_milestones_select on public.master_milestones
  for select to authenticated
  using (public.weekly_can_access_project(project_id));

-- R3: identity is written by Project Control alone.
create policy master_milestones_insert on public.master_milestones
  for insert to authenticated
  with check (public.weekly_can_manage_project(project_id));

create policy master_milestones_update on public.master_milestones
  for update to authenticated
  using (public.weekly_can_manage_project(project_id))
  with check (public.weekly_can_manage_project(project_id));

-- No DELETE policy by design. A milestone with history is archived
-- (active = false), never removed.

alter table public.milestone_updates enable row level security;

create policy milestone_updates_select on public.milestone_updates
  for select to authenticated
  using (public.weekly_can_access_project(public.milestone_project(milestone_id)));

/*
 * D1: a scoped contributor may SUBMIT. This is the one place in the module
 * where someone other than Project Control writes — narrowed to the department
 * and scope item they are actually assigned to, exactly as Weekly is.
 */
create policy milestone_updates_insert on public.milestone_updates
  for insert to authenticated
  with check (
    public.weekly_can_access_scope(
      public.milestone_project(milestone_id),
      department_id,
      discipline_id
    )
  );

/*
 * D1: approving is Project Control's. Both USING and WITH CHECK, so a row
 * cannot be moved onto a milestone the caller cannot manage. The trigger above
 * decides WHICH columns may change; this decides WHO may change them.
 */
create policy milestone_updates_update on public.milestone_updates
  for update to authenticated
  using (public.weekly_can_manage_project(public.milestone_project(milestone_id)))
  with check (public.weekly_can_manage_project(public.milestone_project(milestone_id)));

-- No DELETE policy: the stream is append-only.
