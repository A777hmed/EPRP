-- EPRP Phase 13.2d — Milestone progress reconciliation.
--
-- THE RULE THIS MIGRATION EXISTS TO ENFORCE
-- -----------------------------------------
-- Weekly and Monthly are OBSERVATIONS. They propose a figure; they do not own
-- it. The governed official progress is resolved through Master Milestone
-- governance, and a disagreement between two sources is surfaced for Project
-- Control rather than settled by whichever row happened to be written last.
--
-- Before this migration, two approved updates reporting 50% and 60% resolved to
-- "the latest approved one" — which meant the official figure depended on
-- DATA-ENTRY ORDER. Reversing the order of the same two facts flipped the
-- answer from 60 to 50. That is the defect this closes.
--
-- WHY NO NEW TABLE
--   A reconciliation is the same shape as an update: a value, for a milestone,
--   with provenance and governance. Adopting Weekly, adopting Monthly and
--   entering a fresh figure are one act with three inputs — Project Control
--   declaring the official value for a cut-off, with a reason. So it is a row
--   in milestone_updates, appended like every other, and the append-only
--   guarantee covers it automatically.
--
-- WHAT IS DERIVED RATHER THAN STORED
--   Conflict state is NOT a column. It is a function of the approved rows at a
--   cut-off, computed in `milestone-state.ts` alongside every other derived
--   figure, so there is one place the rule lives and no stored flag that can go
--   stale against the rows it describes.
--
--   "Reconciled by" and "reconciled at" are likewise not new columns: on a
--   reconciliation row, `submitted_by_contact_id` and `submitted_at` ARE the
--   reconciler and the moment. Adding a second pair would be two writable
--   stores of one fact.
--
-- R5 IS INTENTIONALLY AMENDED, with owner approval, from
--     "current = latest approved"
--   to
--     "current = latest resolved governed value for the latest resolved cut-off".
--
-- Additive only. One policy and two CHECK constraints are REPLACED (never
-- widened): the policy gains a narrower branch for reconciliation rows, and the
-- CHECKs learn the new source value. No existing row can become invalid — every
-- row already in the table has source in (weekly, monthly, planning) and NULL
-- in all four new columns.

/* ========================= the cut-off and the act ======================== */

alter table public.milestone_updates
  /*
   * The cut-off this observation describes — NOT when it was typed.
   *
   * `submitted_at` answers "when did this arrive"; as_of_date answers "as of
   * when is this true". The whole reconciliation rule turns on the difference:
   * two figures at different cut-offs are both valid history, two figures at
   * the same cut-off are a conflict.
   *
   * Nullable, because every row written before this migration has no declared
   * cut-off and inventing one for them would be fabricating data. Rows without
   * a cut-off are exempt from conflict detection — see `milestone-state.ts`.
   */
  add column if not exists as_of_date date,

  /*
   * Which reported row this reconciliation adopted, when it adopted one.
   *
   * NULL means Project Control entered an independent figure rather than
   * picking a side. RESTRICT because an adopted row is evidence for the
   * official number and must outlive nothing.
   */
  add column if not exists adopted_from_update_id uuid
    references public.milestone_updates(id) on delete restrict,

  -- Mandatory on a reconciliation, by CHECK below. A governed override of what
  -- two departments reported is not a thing to record silently.
  add column if not exists reconciliation_reason text;

comment on column public.milestone_updates.as_of_date is
  'The reporting cut-off this observation describes. Distinct from submitted_at, which is when it arrived. Same cut-off + different approved values = conflict; different cut-offs = both valid history.';
comment on column public.milestone_updates.adopted_from_update_id is
  'For a reconciliation row: the reported update whose value was adopted. NULL when Project Control entered an independent figure.';
comment on column public.milestone_updates.reconciliation_reason is
  'Why this reconciliation resolved the cut-off the way it did. Required on reconciliation rows.';

create index if not exists milestone_updates_cutoff
  on public.milestone_updates(milestone_id, as_of_date)
  where approval_status = 'approved';

-- Deterministic ordering. `submitted_at` alone ties when several rows are
-- written in one transaction — which is exactly what 13.4's finalization hook
-- will do — and a tie made "current state" depend on the order the database
-- happened to return rows in.
create index if not exists milestone_updates_current_ordered
  on public.milestone_updates(milestone_id, submitted_at desc, id desc)
  where approval_status = 'approved';

/* ============================= constraints =============================== */

do $guard$
begin
  -- 'reconciliation' joins the source vocabulary.
  alter table public.milestone_updates
    drop constraint if exists milestone_updates_source_valid;
  alter table public.milestone_updates
    add constraint milestone_updates_source_valid
      check (source in ('weekly', 'monthly', 'planning', 'reconciliation'));

  -- A reconciliation is authored inside governance, so it names no report —
  -- the same rule 'planning' already follows.
  alter table public.milestone_updates
    drop constraint if exists milestone_updates_source_report;
  alter table public.milestone_updates
    add constraint milestone_updates_source_report check (
      (source = 'weekly' and monthly_report_id is null)
      or (source = 'monthly' and weekly_report_id is null)
      or (source in ('planning', 'reconciliation')
          and weekly_report_id is null and monthly_report_id is null)
    );

  if not exists (
    select 1 from pg_constraint where conname = 'milestone_updates_reconciliation_complete'
  ) then
    /*
     * A reconciliation must actually resolve something: a cut-off to resolve, a
     * figure to resolve it to, and a reason. Without all three it is not a
     * governance decision, it is a note.
     */
    alter table public.milestone_updates
      add constraint milestone_updates_reconciliation_complete check (
        source <> 'reconciliation'
        or (as_of_date is not null
            and progress_percent is not null
            and length(btrim(coalesce(reconciliation_reason, ''))) > 0)
      );

    -- The reconciliation columns belong to reconciliation rows. A Weekly row
    -- carrying a "reason" would read as governed when it is not.
    alter table public.milestone_updates
      add constraint milestone_updates_reconciliation_fields check (
        source = 'reconciliation'
        or (adopted_from_update_id is null and reconciliation_reason is null)
      );

    /*
     * A reconciliation IS the governance decision, so it is never a proposal.
     * Creating it already approved is what stops a resolution from sitting in a
     * queue waiting for the same person who wrote it.
     */
    alter table public.milestone_updates
      add constraint milestone_updates_reconciliation_is_decided check (
        source <> 'reconciliation' or approval_status = 'approved'
      );
  end if;
end
$guard$;

/* ============================== authority ================================ */

/*
 * Who may reconcile. PROJECT CONTROL ONLY.
 *
 *   ALLOWED  system_admin
 *            project_control_admin          (portfolio-wide, architecture 8.1)
 *            the project's assigned Project Control Manager
 *
 *   REFUSED  reporting_coordinator, department manager, team member lead,
 *            team member, every other contributor
 *
 * WHY THIS IS WRITTEN OUT RATHER THAN DELEGATED.
 *   The obvious move is `can_manage_project_setup(p_project)`, and it is wrong.
 *   That predicate resolves through `is_project_consolidator()`, which treats
 *   the Reporting Coordinator as equivalent to the Project Control Manager —
 *   correct for setup and for accepting a report, and NOT correct here. A
 *   Reporting Coordinator coordinates Weekly and Monthly reporting and surfaces
 *   a conflict; deciding the governed official figure is not theirs.
 *
 *   So this restates the Project-Control-Manager half deliberately. It is the
 *   one place in this schema where the consolidator pair is split, and the
 *   duplication is the point: silently inheriting a wider rule is exactly the
 *   failure being avoided.
 *
 * Narrowing only. Nothing that could reconcile before and should still be able
 * to has lost anything, and no other predicate or policy is touched.
 */
create or replace function public.can_reconcile_milestone(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select
    public.is_system_admin()
    or public.current_user_role() = 'project_control_admin'
    or (
      public.current_contact_id() is not null
      and (
        -- Named on the project itself.
        exists (
          select 1 from public.projects pr
           where pr.id = p_project
             and pr.project_control_manager_id = public.current_contact_id()
        )
        -- Or assigned the role through project_contacts. Note that the
        -- coordinator role is absent here — that omission IS the rule, and
        -- 89_runtime_reconciliation.sql asserts this body never mentions it.
        or exists (
          select 1 from public.project_contacts pc
           where pc.project_id = p_project
             and pc.contact_id = public.current_contact_id()
             and pc.role = 'project_control_manager'
        )
      )
    );
$fn$;

comment on function public.can_reconcile_milestone(uuid) is
  'Whether the caller may declare the official milestone progress for a cut-off. system_admin, project_control_admin, or the project''s assigned Project Control Manager. Deliberately EXCLUDES the Reporting Coordinator, who coordinates reporting and surfaces conflicts but does not adjudicate them — which is why this does not delegate to can_manage_project_setup().';

/*
 * Validation a CHECK cannot express: an adopted value must be a real, approved
 * observation of THE SAME milestone at THE SAME cut-off.
 *
 * Without this, "adopt Weekly" could point at another project's row, or at a
 * different cut-off, and the provenance trail would assert something false.
 */
create or replace function public.guard_milestone_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_milestone uuid;
  v_as_of date;
  v_approval text;
begin
  if new.adopted_from_update_id is null then
    return new;
  end if;

  select milestone_id, as_of_date, approval_status
    into v_milestone, v_as_of, v_approval
  from public.milestone_updates
  where id = new.adopted_from_update_id;

  if v_milestone is null or v_milestone <> new.milestone_id then
    raise exception
      'A reconciliation can only adopt a value reported against the same milestone.'
      using errcode = 'foreign_key_violation';
  end if;

  if v_approval <> 'approved' then
    raise exception
      'A reconciliation can only adopt a value that Project Control has already approved.'
      using errcode = 'check_violation';
  end if;

  if v_as_of is distinct from new.as_of_date then
    raise exception
      'A reconciliation can only adopt a value reported for the same cut-off date.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists milestone_updates_reconciliation_guard on public.milestone_updates;
create trigger milestone_updates_reconciliation_guard
  before insert on public.milestone_updates
  for each row execute function public.guard_milestone_reconciliation();

/*
 * Widen the append-only freeze over the new columns.
 *
 * Same function as 13.2c with three names added. A reconciliation's cut-off,
 * adopted source and reason are part of the record and are no more editable
 * than the figure itself.
 */
create or replace function public.guard_milestone_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
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
     -- 13.2c reported columns.
     or new.payment_status is distinct from old.payment_status
     or new.invoice_reference is distinct from old.invoice_reference
     or new.invoiced_date is distinct from old.invoiced_date
     or new.received_date is distinct from old.received_date
     or new.recovered_amount is distinct from old.recovered_amount
     or new.client_approval_status is distinct from old.client_approval_status
     or new.client_approval_date is distinct from old.client_approval_date
     -- 13.2d reconciliation columns.
     or new.as_of_date is distinct from old.as_of_date
     or new.adopted_from_update_id is distinct from old.adopted_from_update_id
     or new.reconciliation_reason is distinct from old.reconciliation_reason
  then
    raise exception
      'A milestone update is a record of what was reported and cannot be edited. Submit a new update instead.'
      using errcode = 'restrict_violation';
  end if;

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
$fn$;

/* ================================= RLS =================================== */

-- Lockout pre-check, matching every other policy migration in this schema.
do $$
begin
  if (select count(*) from public.profiles
       where role = 'system_admin' and active) = 0
     and exists (select 1 from public.profiles) then
    raise exception 'Refusing to change policies: no active system administrator exists';
  end if;
end $$;

/*
 * REPLACED, not added — a second permissive policy would be OR'd with the first
 * and would WIDEN insert rights, which is the opposite of the intent.
 *
 * The contributor branch is character-for-character the existing predicate, so
 * nobody who can submit today loses that. Only the new reconciliation source is
 * gated, and it is gated tighter.
 */
drop policy if exists milestone_updates_insert on public.milestone_updates;
create policy milestone_updates_insert on public.milestone_updates
  for insert to authenticated
  with check (
    case
      when source = 'reconciliation' then
        public.can_reconcile_milestone(public.milestone_project(milestone_id))
      else
        public.weekly_can_access_scope(
          public.milestone_project(milestone_id),
          department_id,
          discipline_id
        )
    end
  );
