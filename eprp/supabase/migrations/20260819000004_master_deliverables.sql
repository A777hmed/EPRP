-- EPRP Phase 13.3 — Master Deliverables (M4).
--
-- The same split 13.2 established, applied to submittable items:
--
--   master_deliverables  IDENTITY. What a deliverable IS — code, title, scope,
--                        the milestone it serves, its planned submission and
--                        its evidence file. Project Control's.
--   deliverable_updates  STATE. What is TRUE of it now — where it stands with
--                        the client, when it was actually submitted, at what
--                        revision. Append-only; current state is the latest
--                        APPROVED row.
--
-- D2: a deliverable is a first-class master record. Weekly activities are not
-- the master and never were — a Weekly row naming a deliverable is a report
-- about one of these, not a definition of one.
--
-- THE DECISION THIS TABLE EXISTS TO ENCODE (D6): two approvals that must never
-- be conflated.
--
--   client_review_status  is REPORTED DATA — a fact about what the client did.
--   approval_status       is GOVERNANCE  — Project Control accepting that the
--                         report of that fact is accurate.
--
-- So a row may legitimately read client_review_status = 'approved' while
-- approval_status = 'pending': someone has reported that the client approved
-- the deliverable, and Project Control has not yet confirmed the report. The
-- column names are deliberately asymmetric so the two can never be read as one
-- field, and no UI may render them in a single control or status chip.
--
-- Kept as its own table rather than merged into milestone_updates behind a
-- discriminator: a client review cycle is not a progress percentage, and the
-- two vocabularies have nothing in common but their governance columns.
--
-- Frozen rules honoured here:
--   R1  this register is the only place a deliverable identity exists
--   R3  nothing outside Project Control writes identity
--   R4  Weekly/Monthly submit updates, never identities
--   R5  current state = latest APPROVED update
--   R6  Project Control approves
--
-- Deferred by D8, exactly as in 13.2: primavera_activity_id and
-- source_schedule_revision_id belong with the schedule tables in 13.5. Adding
-- them now would leave columns nothing can populate and an FK with no target.
--
-- Additive only. No existing table, row, policy or helper is modified.

/* ========================= master_deliverables ============================ */

create table public.master_deliverables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,

  code text not null,
  title text not null,
  description text,

  -- Scope, matching master_milestones exactly so one move/rename repairs both.
  department_id uuid references public.departments(id) on delete restrict,
  system_id uuid references public.systems(id) on delete set null,
  discipline_id uuid references public.disciplines(id) on delete restrict,

  owner_contact_id uuid references public.contacts(id) on delete set null,

  /*
   * The milestone this deliverable serves.
   *
   * A REFERENCE, never a copy: no milestone code, name or date is duplicated
   * onto this row, so master_milestones stays the single authoritative
   * milestone source. SET NULL rather than RESTRICT because a deliverable
   * outlives the plan it was drawn against — an archived or re-scoped
   * milestone must not take its deliverables with it.
   */
  milestone_id uuid references public.master_milestones(id) on delete set null,

  -- The plan. Actual submission, client review and reported revision are
  -- deliberately ABSENT — they live in deliverable_updates.
  planned_submission_date date,
  -- The revision this deliverable is PLANNED at, e.g. 'IFR', 'Rev B'. The
  -- revision actually submitted is reported per update.
  revision text,

  /*
   * Evidence. Reuses project_documents rather than introducing a second file
   * store, so a deliverable's file carries the same revision chain, controlled
   * status and delete protection every other reference input has.
   */
  document_id uuid references public.project_documents(id) on delete set null,

  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint master_deliverables_code_not_blank check (length(btrim(code)) > 0),
  constraint master_deliverables_title_not_blank check (length(btrim(title)) > 0)
);

comment on table public.master_deliverables is
  'The authoritative deliverable register for a project (Phase 13.3). Identity and plan only — client review status, actual submission date and submitted revision are derived from the latest approved row in deliverable_updates. milestone_id references master_milestones and never copies from it.';

-- Case-insensitive on the trimmed code, the same convention master_milestones
-- and job_titles use: "D-01" and "d-01" are one code.
create unique index master_deliverables_project_code_unique
  on public.master_deliverables(project_id, lower(btrim(code)));

create index master_deliverables_project_scope
  on public.master_deliverables(project_id, department_id, discipline_id)
  where active;

-- The lookup behind "what is this milestone's evidence?".
create index master_deliverables_by_milestone
  on public.master_deliverables(milestone_id)
  where milestone_id is not null;

create trigger set_updated_at
  before update on public.master_deliverables
  for each row execute function public.set_updated_at();

/* ========================= deliverable_updates ============================ */

create table public.deliverable_updates (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT, matching milestone_updates: a deliverable carrying history is
  -- archived, never deleted.
  deliverable_id uuid not null references public.master_deliverables(id) on delete restrict,

  source text not null,
  weekly_report_id uuid references public.weekly_reports(id) on delete set null,
  monthly_report_id uuid references public.monthly_reports(id) on delete set null,

  -- Scope carried explicitly so the row can be narrowed by
  -- weekly_can_access_scope. A NULL discipline_id means department-level.
  department_id uuid references public.departments(id) on delete set null,
  discipline_id uuid references public.disciplines(id) on delete set null,

  /*
   * THE REPORTED FACTS — what the client did, and when we sent it.
   *
   * client_review_status is a lifecycle the DELIVERABLE goes through. It is
   * data, not a decision of ours: 'approved' here means the client approved,
   * and says nothing about whether we accept the report saying so.
   */
  client_review_status text not null default 'not_submitted',
  client_review_date date,
  -- The client's own transmittal or comment-sheet reference, so their record
  -- and ours can be reconciled without guessing.
  client_reference text,
  forecast_date date,
  actual_submission_date date,
  -- The revision actually submitted, which can differ from the planned one.
  revision text,
  narrative text,

  /*
   * THE GOVERNANCE DECISION — a gate the REPORTING goes through.
   *
   * Separate from every column above, and named so it can never be mistaken
   * for one. This records whether Project Control accepts the report, not what
   * the report says.
   */
  approval_status text not null default 'pending',
  approved_by_contact_id uuid references public.contacts(id) on delete set null,
  approved_at timestamptz,
  decision_note text,

  submitted_by_contact_id uuid references public.contacts(id) on delete set null,
  submitted_at timestamptz not null default now(),

  constraint deliverable_updates_source_valid
    check (source in ('weekly', 'monthly', 'planning')),

  -- The seven-state client review lifecycle, as locked in the architecture
  -- review. 'approved_with_comments' is its own state rather than 'approved'
  -- plus a note: it carries an obligation to respond, and collapsing it into
  -- 'approved' would lose that.
  constraint deliverable_updates_client_review_valid check (
    client_review_status in (
      'not_submitted', 'submitted', 'under_review',
      'approved', 'approved_with_comments', 'rejected', 'resubmit'
    )
  ),

  constraint deliverable_updates_approval_valid
    check (approval_status in ('pending', 'approved', 'rejected')),

  -- An approved or rejected row must say when it was decided.
  constraint deliverable_updates_decision_complete check (
    (approval_status = 'pending' and approved_at is null)
    or (approval_status <> 'pending' and approved_at is not null)
  ),

  -- Nothing has reached the client, so nothing can be dated as reviewed.
  constraint deliverable_updates_review_date_needs_submission check (
    client_review_status <> 'not_submitted'
    or (client_review_date is null and client_reference is null)
  ),

  -- A report-sourced row names its report; a planning row does not.
  constraint deliverable_updates_source_report check (
    (source = 'weekly' and monthly_report_id is null)
    or (source = 'monthly' and weekly_report_id is null)
    or (source = 'planning' and weekly_report_id is null and monthly_report_id is null)
  )
);

comment on table public.deliverable_updates is
  'Append-only state stream for master_deliverables (Phase 13.3). Current deliverable state is the latest row with approval_status = approved. D6: client_review_status is REPORTED DATA about the client; approval_status is GOVERNANCE over the report. They are independent — a row may read client-approved / internally-pending — and must never share a UI control.';

-- The lookup behind current state: newest approved row per deliverable.
create index deliverable_updates_current
  on public.deliverable_updates(deliverable_id, submitted_at desc)
  where approval_status = 'approved';

-- The approval queue.
create index deliverable_updates_pending
  on public.deliverable_updates(approval_status, submitted_at)
  where approval_status = 'pending';

create index deliverable_updates_by_weekly
  on public.deliverable_updates(weekly_report_id)
  where weekly_report_id is not null;

/* ============================== helpers =================================== */

/*
 * Resolve a deliverable's project.
 *
 * A dedicated security-definer helper, NOT a subquery inside a policy: a raw
 * subquery re-enters master_deliverables' own SELECT policy and silently denies
 * or recurses. Mirrors milestone_project() and weekly_report_project().
 */
create or replace function public.deliverable_project(p_deliverable uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select project_id from public.master_deliverables where id = p_deliverable;
$$;

comment on function public.deliverable_project(uuid) is
  'The project a deliverable belongs to. Security definer so RLS policies on deliverable_updates can reach it without re-entering master_deliverables RLS.';

/*
 * Reported content is immutable; the approval decision may transition once.
 *
 * The same guarantee guard_milestone_update() gives, over this table's own
 * columns. Written out rather than shared, because the two streams have
 * different reported columns and a shared trigger would have to be rewritten
 * every time either table gained one.
 */
create or replace function public.guard_deliverable_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deliverable_id is distinct from old.deliverable_id
     or new.source is distinct from old.source
     or new.weekly_report_id is distinct from old.weekly_report_id
     or new.monthly_report_id is distinct from old.monthly_report_id
     or new.department_id is distinct from old.department_id
     or new.discipline_id is distinct from old.discipline_id
     or new.client_review_status is distinct from old.client_review_status
     or new.client_review_date is distinct from old.client_review_date
     or new.client_reference is distinct from old.client_reference
     or new.forecast_date is distinct from old.forecast_date
     or new.actual_submission_date is distinct from old.actual_submission_date
     or new.revision is distinct from old.revision
     or new.narrative is distinct from old.narrative
     or new.submitted_by_contact_id is distinct from old.submitted_by_contact_id
     or new.submitted_at is distinct from old.submitted_at
  then
    raise exception
      'A deliverable update is a record of what was reported and cannot be edited. Submit a new update instead.'
      using errcode = 'restrict_violation';
  end if;

  -- A decision is final. Reversing one would rewrite history other tiers have
  -- already read; the correction is a new update.
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

create trigger deliverable_updates_guard
  before update on public.deliverable_updates
  for each row execute function public.guard_deliverable_update();

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

alter table public.master_deliverables enable row level security;

create policy master_deliverables_select on public.master_deliverables
  for select to authenticated
  using (public.weekly_can_access_project(project_id));

-- R3: identity is written by Project Control alone.
create policy master_deliverables_insert on public.master_deliverables
  for insert to authenticated
  with check (public.weekly_can_manage_project(project_id));

create policy master_deliverables_update on public.master_deliverables
  for update to authenticated
  using (public.weekly_can_manage_project(project_id))
  with check (public.weekly_can_manage_project(project_id));

-- No DELETE policy by design. A deliverable with history is archived
-- (active = false), never removed.

alter table public.deliverable_updates enable row level security;

create policy deliverable_updates_select on public.deliverable_updates
  for select to authenticated
  using (public.weekly_can_access_project(public.deliverable_project(deliverable_id)));

/*
 * D1: a scoped contributor may SUBMIT — narrowed to the department and scope
 * item they are actually assigned to, exactly as Weekly and milestone updates
 * are.
 */
create policy deliverable_updates_insert on public.deliverable_updates
  for insert to authenticated
  with check (
    public.weekly_can_access_scope(
      public.deliverable_project(deliverable_id),
      department_id,
      discipline_id
    )
  );

/*
 * D1: approving is Project Control's. Both USING and WITH CHECK, so a row
 * cannot be moved onto a deliverable the caller cannot manage. The trigger
 * decides WHICH columns may change; this decides WHO may change them.
 */
create policy deliverable_updates_update on public.deliverable_updates
  for update to authenticated
  using (public.weekly_can_manage_project(public.deliverable_project(deliverable_id)))
  with check (public.weekly_can_manage_project(public.deliverable_project(deliverable_id)));

-- No DELETE policy: the stream is append-only.
