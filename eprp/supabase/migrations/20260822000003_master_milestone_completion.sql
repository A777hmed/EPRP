-- EPRP Phase 13.2c — Master Milestone completion.
--
-- 13.2 established the register and the identity/state split. This migration
-- completes the MODEL so the register can actually govern what a project
-- commits to: milestone classification, the planned/baseline/forecast/actual
-- comparison, weighting, dependencies, client approval, and the commercial
-- (payment) milestones the split was always going to need.
--
-- The 13.2 split is unchanged, and it is what decides where each new column
-- lands:
--
--   master_milestones   IDENTITY and PLAN. What a milestone IS and what was
--                       committed — type, category, planned date, weight,
--                       planned progress, dependency, and for a commercial
--                       milestone the payment that was AGREED.
--   milestone_updates   STATE. What is TRUE now — status, actual progress,
--                       forecast, and for a commercial milestone what was
--                       actually invoiced, received and recovered.
--
-- Putting "invoiced on 3 March" on the identity row would give two writable
-- stores of the same fact and bypass governance entirely. Payment facts are
-- reported and approved exactly like progress is.
--
-- THE ACCOUNTING RULE THIS MIGRATION EXISTS TO ENFORCE
-- ----------------------------------------------------
-- An Advance / Down Payment is money, not work. If the contract is 100% and a
-- 10% advance is paid, the project is NOT 110% delivered. So:
--
--   * Physical progress is weighted by `weight_percent`.
--   * Commercial progress is weighted by `payment_percent`.
--   * A commercial milestone is REFUSED a physical weight by CHECK constraint.
--
-- That last line is the guarantee. Filtering commercial rows out in TypeScript
-- would be a convention; a constraint is a rule. Both are in place — the
-- derivation in `milestone-state.ts` also excludes them by type — but only one
-- of them survives a future caller that forgets.
--
-- Additive only. No existing column, row, policy or index is modified;
-- `guard_milestone_update()` is replaced to extend its freeze list over the new
-- reported columns, which widens the existing guarantee rather than changing it.

/* ===================== master_milestones — classification ================= */

alter table public.master_milestones
  -- The behaviour-driving CLASS of milestone. Deliberately a small closed set:
  -- it decides which fields apply and whether the row counts toward physical
  -- progress, so it is architecture, not master data.
  --
  -- The user-facing, freely configurable label is `category` below. Individual
  -- milestone names ("Advance Payment", "IFC Issue", "Contract Award") are
  -- never hardcoded anywhere — they are `name` and `category` values.
  add column if not exists milestone_type text not null default 'technical',
  -- A free label within the class, chosen per project. Not a lookup, so a
  -- project may organise its register the way its own contract does.
  add column if not exists category text,

  /* ------------------------------ the plan ------------------------------- */
  -- Planned and baseline are different facts and both are kept. Baseline is the
  -- frozen contractual reference; planned is the current agreed date, which may
  -- move in a re-plan without touching the baseline. Variance is measured
  -- against either and is derived, never stored.
  add column if not exists planned_date date,
  -- Share of physical project scope this milestone carries, 0–100.
  add column if not exists weight_percent numeric(6, 3),
  -- What progress SHOULD be by now, per the plan. Actual progress is reported.
  add column if not exists planned_progress_percent integer,

  -- Dependency. One predecessor, which is what a milestone register needs; a
  -- full dependency network belongs with the schedule tables in 13.5.
  -- SET NULL, never CASCADE: losing a predecessor must not delete its successor.
  add column if not exists predecessor_milestone_id uuid
    references public.master_milestones(id) on delete set null,

  -- Client approval. Whether it is REQUIRED is part of the plan; whether it has
  -- been GIVEN is reported through milestone_updates — the same separation
  -- master_deliverables already draws (D6).
  add column if not exists client_approval_required boolean not null default false,

  add column if not exists notes text,

  /* --------------------- commercial / payment PLAN ----------------------- */
  -- What was AGREED. What actually happened is reported per update.
  add column if not exists payment_percent numeric(6, 3),
  add column if not exists payment_amount numeric(16, 2),
  add column if not exists payment_due_date date,
  -- An advance / down payment is a commercial milestone with recovery: the
  -- money is repaid out of later certificates rather than earned by work.
  add column if not exists is_advance_payment boolean not null default false;

comment on column public.master_milestones.milestone_type is
  'Class of milestone: technical (project delivery), contractual, or commercial (payment). Decides which fields apply and whether the row counts toward physical progress. The freely configurable label is category.';
comment on column public.master_milestones.category is
  'Project-chosen label within the milestone type. Free text by design — milestone naming is never hardcoded.';
comment on column public.master_milestones.planned_date is
  'The current agreed date. baseline_date is the frozen contractual reference; the two differ after a re-plan and both are kept.';
comment on column public.master_milestones.weight_percent is
  'Share of PHYSICAL project scope. Refused on commercial milestones by CHECK — an advance payment is money, not delivered work.';
comment on column public.master_milestones.is_advance_payment is
  'An advance / down payment: paid up front and recovered from later certificates. Tracked inside contract value, never added to it.';

do $guard$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'master_milestones_type_valid'
  ) then
    alter table public.master_milestones
      add constraint master_milestones_type_valid
        check (milestone_type in ('technical', 'contractual', 'commercial'));

    alter table public.master_milestones
      add constraint master_milestones_weight_range
        check (weight_percent is null or weight_percent between 0 and 100);

    alter table public.master_milestones
      add constraint master_milestones_planned_progress_range
        check (planned_progress_percent is null
               or planned_progress_percent between 0 and 100);

    alter table public.master_milestones
      add constraint master_milestones_payment_percent_range
        check (payment_percent is null or payment_percent between 0 and 100);

    alter table public.master_milestones
      add constraint master_milestones_payment_amount_positive
        check (payment_amount is null or payment_amount >= 0);

    -- Payment fields belong to payment milestones. A technical milestone
    -- carrying an amount would appear in a commercial roll-up nobody filed it
    -- into.
    alter table public.master_milestones
      add constraint master_milestones_payment_needs_commercial check (
        milestone_type = 'commercial'
        or (payment_percent is null
            and payment_amount is null
            and payment_due_date is null
            and is_advance_payment = false)
      );

    /*
     * THE ACCOUNTING RULE, as a constraint.
     *
     * A commercial milestone may not carry physical weight. This is what stops
     * a 10% advance on a 100% contract from reading as 110% delivered, and it
     * holds for every writer — the UI, a future import, a hand-written fix.
     */
    alter table public.master_milestones
      add constraint master_milestones_commercial_no_physical_weight check (
        milestone_type <> 'commercial' or coalesce(weight_percent, 0) = 0
      );

    alter table public.master_milestones
      add constraint master_milestones_predecessor_not_self
        check (predecessor_milestone_id is distinct from id);
  end if;
end
$guard$;

-- The lookup behind "what does this milestone wait on?" and its reverse.
create index if not exists master_milestones_predecessor
  on public.master_milestones(predecessor_milestone_id)
  where predecessor_milestone_id is not null;

create index if not exists master_milestones_project_type
  on public.master_milestones(project_id, milestone_type)
  where active;

/* ==================== milestone_updates — reported facts ================== */

alter table public.milestone_updates
  /* ------------------- commercial / payment ACTUALS ---------------------- */
  -- Where the money actually stands. Reported and governed exactly like
  -- progress: it becomes official only once approved.
  add column if not exists payment_status text,
  add column if not exists invoice_reference text,
  add column if not exists invoiced_date date,
  add column if not exists received_date date,
  -- Recovery of an advance. The AMOUNT is stored because that is the figure
  -- accounting actually records; recovery % and outstanding advance are derived
  -- against the agreed payment_amount, so each has one writable store.
  add column if not exists recovered_amount numeric(16, 2),

  /* --------------------------- client approval --------------------------- */
  -- Reported data about what the CLIENT did. Never the same field as
  -- approval_status, which is Project Control accepting the report — the same
  -- asymmetry deliverable_updates draws (D6).
  add column if not exists client_approval_status text,
  add column if not exists client_approval_date date;

comment on column public.milestone_updates.payment_status is
  'Reported position of the payment: planned, due, invoiced, received, partially_recovered, fully_recovered. Reported DATA, gated by approval_status like every other reported column here.';
comment on column public.milestone_updates.recovered_amount is
  'Advance recovered to date, in money. Recovery % and outstanding advance are derived from master_milestones.payment_amount rather than stored twice.';
comment on column public.milestone_updates.client_approval_status is
  'What the CLIENT did. Distinct from approval_status, which is whether Project Control accepts this report. The two must never share a UI control.';

do $guard$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'milestone_updates_payment_status_valid'
  ) then
    alter table public.milestone_updates
      add constraint milestone_updates_payment_status_valid check (
        payment_status is null or payment_status in (
          'planned', 'due', 'invoiced', 'received',
          'partially_recovered', 'fully_recovered'
        )
      );

    alter table public.milestone_updates
      add constraint milestone_updates_recovered_amount_positive
        check (recovered_amount is null or recovered_amount >= 0);

    alter table public.milestone_updates
      add constraint milestone_updates_client_approval_valid check (
        client_approval_status is null or client_approval_status in (
          'pending', 'approved', 'rejected'
        )
      );

    /*
     * Nothing has been decided, so nothing can be dated as decided.
     *
     * `coalesce`, not a bare IN. `client_approval_status` is nullable, and
     * `null in ('approved','rejected')` evaluates to NULL — which a CHECK
     * accepts, because only FALSE rejects. Written the obvious way, this
     * constraint let through the exact row it exists to refuse: a decision date
     * with no decision. Caught by runtime test 13.2c-R4.
     */
    alter table public.milestone_updates
      add constraint milestone_updates_client_approval_date_needs_decision check (
        client_approval_date is null
        or coalesce(client_approval_status, '') in ('approved', 'rejected')
      );
  end if;
end
$guard$;

/* ================================ guards ================================= */

/*
 * Identity validation a CHECK cannot express.
 *
 * Two rules, both about the predecessor link:
 *   - it must point inside the same project. A cross-project dependency would
 *     leak one project's plan into another's register, and the reader would see
 *     a code RLS will not let them resolve.
 *   - the chain must not cycle. "A waits on B waits on A" is not a plan.
 *
 * Depth-bounded rather than written as a recursive CTE: the bound IS the cycle
 * detector, and it cannot itself hang.
 */
create or replace function public.guard_milestone_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_project uuid;
  v_cursor uuid := new.predecessor_milestone_id;
  v_depth integer := 0;
begin
  if new.predecessor_milestone_id is null then
    return new;
  end if;

  select project_id into v_project
  from public.master_milestones
  where id = new.predecessor_milestone_id;

  if v_project is null or v_project <> new.project_id then
    raise exception
      'A milestone can only depend on another milestone in the same project.'
      using errcode = 'foreign_key_violation';
  end if;

  while v_cursor is not null and v_depth < 100 loop
    if v_cursor = new.id then
      raise exception
        'That dependency would form a loop: the milestone would end up waiting on itself.'
        using errcode = 'check_violation';
    end if;
    select predecessor_milestone_id into v_cursor
    from public.master_milestones
    where id = v_cursor;
    v_depth := v_depth + 1;
  end loop;

  if v_depth >= 100 then
    raise exception
      'The dependency chain for this milestone is too deep to validate.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

comment on function public.guard_milestone_identity() is
  'Keeps a milestone dependency inside its own project and free of loops. Security definer so it can read predecessors the writer may not select.';

drop trigger if exists master_milestones_identity_guard on public.master_milestones;
create trigger master_milestones_identity_guard
  before insert or update on public.master_milestones
  for each row execute function public.guard_milestone_identity();

/*
 * Extend the append-only guarantee over the columns added above.
 *
 * Identical to the 13.2 function with the new reported columns added to the
 * freeze list. Replaced rather than supplemented, so there is exactly one
 * statement of which columns are frozen.
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
     -- 13.2c reported columns. Payment facts are a record of what was invoiced
     -- and received, and are no more editable than a progress figure.
     or new.payment_status is distinct from old.payment_status
     or new.invoice_reference is distinct from old.invoice_reference
     or new.invoiced_date is distinct from old.invoiced_date
     or new.received_date is distinct from old.received_date
     or new.recovered_amount is distinct from old.recovered_amount
     or new.client_approval_status is distinct from old.client_approval_status
     or new.client_approval_date is distinct from old.client_approval_date
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
$fn$;
