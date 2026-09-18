-- EPRP Project Planning & Control — Slice 1 (foundation).
--
-- Establishes Planning as a project-level register, separate from — and
-- feeding — Weekly/Monthly/Executive reporting, on the same identity/state
-- split this schema already uses for Master Milestones (13.2) and Master
-- Deliverables (13.3):
--
--   RAW IMPORT   planning_import_batches / planning_import_rows
--                What a source file said, verbatim. Insert-only, never
--                edited, never deleted — the audit trail an import can always
--                be checked against.
--
--   GOVERNED WBS planning_work_items / planning_activities
--                What the project's plan actually IS, as Project Control has
--                confirmed or adjusted it. Mutable, but every adjustment is
--                required to be paired with a planning_confirmations row
--                carrying a reason — the same "confirm/adjust with history,
--                never overwrite the raw value" rule the architecture asks
--                for. The raw rows above are never touched by an adjustment.
--
--   PUBLISHED    planning_snapshots
--                The immutable planning source of truth. Written once, by
--                publish_planning_snapshot(), never updated, never deleted.
--                Weekly and Monthly link to an EXACT snapshot id, not to
--                "current planning" — precisely the reference-while-drafting /
--                snapshot-at-approval discipline 03_REPORTING_ARCHITECTURE.md
--                §11 already applies to reports.
--
-- Explicitly OUT of this slice, per the brief: import UI, Dashboard
-- integration, charts, email, notifications, printing, Executive UX. This
-- migration is data model, RLS and one governed function only.
--
-- Master Milestones remain the governed milestone source (13.2/13.2c/13.2d) —
-- nothing here creates a second milestone identity. planning_milestone_links
-- is a pure reference from a planning row to an existing master_milestones
-- row, exactly as master_deliverables.milestone_id already references it.
--
-- Authorization is NOT redesigned. Every predicate below is an existing,
-- already-audited function: can_access_project() for read (2026-09-05 /
-- 2026-09-12 canonical project READ rule, portfolio-read tiers included) and
-- can_manage_project_operations() for write (2026-08-24 Authorization
-- Foundation) — the same pair master_milestones and master_deliverables use.
--
-- Published Portfolio Read (has_published_portfolio_read(), 20260912000003)
-- is wired individually onto exactly three SELECT policies — planning_snapshots,
-- planning_snapshot_activities, and planning_baselines (scoped to a baseline a
-- snapshot actually references) — the same "wire it onto the specific reader,
-- never into can_access_project()" discipline 20260912000003 itself applies to
-- projects_select and the report *_viewable() helpers. It never reaches
-- imports, confirmations, the live work-item/activity register, or Opening
-- Positions, and it grants no write authority anywhere — proven by this
-- migration's own postconditions, not merely asserted.

/* --------------------------- lockout pre-check ---------------------------- */

do $pre$
begin
  if (select count(*) from public.profiles
       where role = 'system_admin' and active) = 0
     and exists (select 1 from public.profiles) then
    raise exception 'Refusing to install Planning foundation: no active system administrator exists.';
  end if;
end;
$pre$;

/* ============================================================================
   1. Portfolio / Reporting Group — Tier 1 master data
   ========================================================================= */

-- "PSM", "PSAIM", "Construction" and so on are project data, never product
-- code. This is the same admin-managed master-data shape as clients and
-- departments, added so future grouped S-curves have somewhere to attach
-- without hardcoding a single project name anywhere.
create table public.portfolio_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  description text,
  active      boolean not null default true,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint portfolio_groups_name_not_blank check (length(btrim(name)) > 0)
);

create unique index portfolio_groups_name_unique
  on public.portfolio_groups(lower(btrim(name)));

comment on table public.portfolio_groups is
  'Admin-managed grouping of projects for future portfolio S-curves (e.g. PSM, PSAIM, Construction). Never a hardcoded list; projects assign it, they do not own it (architecture §2 rule 2).';

create trigger set_updated_at before update on public.portfolio_groups
  for each row execute function public.set_updated_at();

alter table public.portfolio_groups enable row level security;

create policy portfolio_groups_select on public.portfolio_groups
  for select to authenticated using (true);
create policy portfolio_groups_insert on public.portfolio_groups
  for insert to authenticated
  with check (public.has_global_operational_authority());
create policy portfolio_groups_update on public.portfolio_groups
  for update to authenticated
  using (public.has_global_operational_authority())
  with check (public.has_global_operational_authority());
create policy portfolio_groups_delete on public.portfolio_groups
  for delete to authenticated
  using (public.has_global_operational_authority());

-- Assignment, not ownership (architecture §4.4): a project references a
-- Portfolio Group; the group is never duplicated into the project.
alter table public.projects
  add column if not exists portfolio_group_id uuid
    references public.portfolio_groups(id) on delete set null;

comment on column public.projects.portfolio_group_id is
  'Optional Tier 1 Portfolio/Reporting Group assignment for future grouped portfolio S-curves. References portfolio_groups; never a copied name.';

/* ============================================================================
   2. Project-level Planning configuration
   ========================================================================= */

-- One row per project. "Planning is project-level" (brief) — there is no
-- platform-wide planning configuration to fall back to.
create table public.project_planning_settings (
  project_id                 uuid primary key
    references public.projects(id) on delete cascade,
  -- The three onboarding paths the product model requires:
  --   new_project             — no schedule exists yet; plan from zero.
  --   existing_active_project — already running; must publish an Opening
  --                             Position as Snapshot V1 rather than fake a
  --                             from-zero history (see planning_opening_positions).
  --   no_formal_schedule      — tracked without a formal schedule at all;
  --                             Planning stays available but nothing is implied.
  onboarding_mode            text not null default 'new_project',
  default_import_source      text,
  planning_enabled           boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint project_planning_settings_onboarding_mode_valid check (
    onboarding_mode in ('new_project', 'existing_active_project', 'no_formal_schedule')
  ),
  constraint project_planning_settings_default_source_valid check (
    default_import_source is null
    or default_import_source in ('eprp_excel', 'p6', 'msproject', 'manual')
  )
);

comment on table public.project_planning_settings is
  'Per-project Planning & Control configuration. onboarding_mode=existing_active_project requires a planning_opening_positions row to be promoted as the project''s Snapshot V1, rather than starting from a fabricated zero history.';

create trigger set_updated_at before update on public.project_planning_settings
  for each row execute function public.set_updated_at();

alter table public.project_planning_settings enable row level security;

create policy project_planning_settings_select on public.project_planning_settings
  for select to authenticated
  using (public.can_access_project(project_id));
create policy project_planning_settings_insert on public.project_planning_settings
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));
create policy project_planning_settings_update on public.project_planning_settings
  for update to authenticated
  using (public.can_manage_project_operations(project_id))
  with check (public.can_manage_project_operations(project_id));

-- No DELETE policy: settings live and die with the project (ON DELETE CASCADE
-- handles project archival at the database level; there is no standalone
-- "remove planning configuration" operation).

/* ============================================================================
   3. Raw import — immutable and auditable
   ========================================================================= */

create table public.planning_import_batches (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects(id) on delete cascade,
  source_type             text not null,
  file_name               text,
  -- Reuses the existing Project Reference Documents store rather than a new
  -- upload path — the uploaded schedule file is a project document like any
  -- other controlled reference input (13.1).
  source_document_id      uuid references public.project_documents(id) on delete set null,
  status                  text not null default 'uploaded',
  row_count               integer not null default 0,
  uploaded_by_contact_id  uuid references public.contacts(id) on delete set null,
  uploaded_at             timestamptz not null default now(),
  validated_at            timestamptz,
  validated_by_contact_id uuid references public.contacts(id) on delete set null,
  rejection_reason        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint planning_import_batches_source_valid
    check (source_type in ('eprp_excel', 'p6', 'msproject')),
  constraint planning_import_batches_status_valid
    check (status in ('uploaded', 'validated', 'rejected', 'published')),
  constraint planning_import_batches_row_count_non_negative
    check (row_count >= 0)
);

comment on table public.planning_import_batches is
  'One uploaded planning source file. Raw rows live in planning_import_rows and are never edited. Import UI is out of Slice 1 scope; this table is the foundation it will write to.';

create index planning_import_batches_project
  on public.planning_import_batches(project_id, uploaded_at desc);

create trigger set_updated_at before update on public.planning_import_batches
  for each row execute function public.set_updated_at();

-- Once published, a batch is history: the snapshot it produced is immutable,
-- so the batch that produced it must stop moving too.
create or replace function public.guard_planning_import_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if old.status = 'published' then
    raise exception
      'A published planning import batch is immutable. Import a new batch instead.'
      using errcode = 'restrict_violation';
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception
      'A planning import batch cannot be reassigned to another project.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$fn$;

create trigger planning_import_batches_guard
  before update on public.planning_import_batches
  for each row execute function public.guard_planning_import_batch();

revoke execute on function public.guard_planning_import_batch()
  from public, anon, authenticated;

alter table public.planning_import_batches enable row level security;

create policy planning_import_batches_select on public.planning_import_batches
  for select to authenticated
  using (public.can_access_project(project_id));
create policy planning_import_batches_insert on public.planning_import_batches
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));
create policy planning_import_batches_update on public.planning_import_batches
  for update to authenticated
  using (public.can_manage_project_operations(project_id))
  with check (public.can_manage_project_operations(project_id));

-- No DELETE policy: an import batch is audit trail, not working data.

create or replace function public.planning_import_batch_project(p_batch uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select project_id from public.planning_import_batches where id = p_batch;
$fn$;

comment on function public.planning_import_batch_project(uuid) is
  'The project an import batch belongs to. Security definer so planning_import_rows RLS can reach it without re-entering planning_import_batches RLS.';

create table public.planning_import_rows (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.planning_import_batches(id) on delete cascade,
  row_number   integer not null,
  external_id  text,
  wbs_path     text,
  name         text,
  -- Everything the parser saw for this row, verbatim. Explicit columns above
  -- are the common fields every source format shares; this is the rest.
  raw_data     jsonb not null default '{}'::jsonb,
  parse_status text not null default 'ok',
  parse_notes  text,
  created_at   timestamptz not null default now(),
  constraint planning_import_rows_parse_status_valid
    check (parse_status in ('ok', 'warning', 'error')),
  constraint planning_import_rows_batch_row_unique unique (batch_id, row_number)
);

comment on table public.planning_import_rows is
  'One raw row from a planning source file, exactly as parsed. Insert-only — no UPDATE or DELETE policy exists at all. This is the record an imported value can always be checked against; planning_work_items/planning_activities hold the confirmed, adjustable working copy.';

create index planning_import_rows_batch
  on public.planning_import_rows(batch_id, row_number);

alter table public.planning_import_rows enable row level security;

create policy planning_import_rows_select on public.planning_import_rows
  for select to authenticated
  using (public.can_access_project(public.planning_import_batch_project(batch_id)));
create policy planning_import_rows_insert on public.planning_import_rows
  for insert to authenticated
  with check (public.can_manage_project_operations(
    public.planning_import_batch_project(batch_id)));

-- No UPDATE, no DELETE policy: raw import content is immutable by design —
-- "Do not overwrite raw import values."

/* ============================================================================
   4. Governed WBS — planning_work_items / planning_activities
   ========================================================================= */

create table public.planning_work_items (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  parent_work_item_id   uuid references public.planning_work_items(id) on delete set null,
  origin_import_row_id  uuid references public.planning_import_rows(id) on delete set null,

  -- Optional linkage into the project's own structure, same nullability and
  -- delete behaviour as master_milestones' scope columns: master data is
  -- archived, never deleted, so a work item can never be orphaned by one.
  department_id         uuid references public.departments(id) on delete restrict,
  system_id             uuid references public.systems(id) on delete set null,
  discipline_id         uuid references public.disciplines(id) on delete restrict,

  code                  text not null,
  name                  text not null,
  level                 integer not null default 0,
  sort_order            integer not null default 0,
  is_milestone          boolean not null default false,
  weight_percent        numeric(6, 3),
  planned_start_date    date,
  planned_finish_date   date,
  baseline_start_date   date,
  baseline_finish_date  date,
  planned_duration_days integer,
  source                text not null default 'manual',
  active                boolean not null default true,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint planning_work_items_code_not_blank check (length(btrim(code)) > 0),
  constraint planning_work_items_name_not_blank check (length(btrim(name)) > 0),
  constraint planning_work_items_source_valid check (source in ('import', 'manual')),
  constraint planning_work_items_weight_range
    check (weight_percent is null or weight_percent between 0 and 100),
  constraint planning_work_items_duration_non_negative
    check (planned_duration_days is null or planned_duration_days >= 0),
  constraint planning_work_items_planned_date_order
    check (planned_start_date is null or planned_finish_date is null
           or planned_start_date <= planned_finish_date),
  constraint planning_work_items_baseline_date_order
    check (baseline_start_date is null or baseline_finish_date is null
           or baseline_start_date <= baseline_finish_date),
  constraint planning_work_items_parent_not_self
    check (parent_work_item_id is distinct from id)
);

comment on table public.planning_work_items is
  'The project''s governed WBS register: what the plan currently IS, as Project Control has confirmed or adjusted it. Planned/baseline dates and weight are mutable; every adjustment is expected to be paired with a planning_confirmations row carrying a reason. Raw origin_import_row_id is never edited by an adjustment.';
comment on column public.planning_work_items.baseline_start_date is
  'The frozen contractual reference, distinct from planned_start_date, which may move in a re-plan without touching this. Same distinction 13.2c draws for milestones.';

create unique index planning_work_items_project_code_unique
  on public.planning_work_items(project_id, lower(btrim(code)))
  where active;

create index planning_work_items_project_parent
  on public.planning_work_items(project_id, parent_work_item_id)
  where active;
create index planning_work_items_project_scope
  on public.planning_work_items(project_id, department_id, discipline_id)
  where active;

create trigger set_updated_at before update on public.planning_work_items
  for each row execute function public.set_updated_at();

-- Same shape as guard_milestone_identity(): keep a dependency inside its own
-- project and free of loops.
create or replace function public.guard_planning_work_item_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project uuid;
  v_cursor uuid := new.parent_work_item_id;
  v_depth integer := 0;
begin
  if new.parent_work_item_id is null then
    return new;
  end if;

  select project_id into v_project
    from public.planning_work_items
   where id = new.parent_work_item_id;

  if v_project is null or v_project <> new.project_id then
    raise exception
      'A planning work item can only nest under another work item in the same project.'
      using errcode = 'foreign_key_violation';
  end if;

  while v_cursor is not null and v_depth < 100 loop
    if v_cursor = new.id then
      raise exception
        'That parent assignment would form a loop in the work breakdown structure.'
        using errcode = 'check_violation';
    end if;
    select parent_work_item_id into v_cursor
      from public.planning_work_items
     where id = v_cursor;
    v_depth := v_depth + 1;
  end loop;

  if v_depth >= 100 then
    raise exception
      'The work breakdown structure is too deep to validate.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create trigger planning_work_items_hierarchy_guard
  before insert or update on public.planning_work_items
  for each row execute function public.guard_planning_work_item_hierarchy();

revoke execute on function public.guard_planning_work_item_hierarchy()
  from public, anon, authenticated;

alter table public.planning_work_items enable row level security;

create policy planning_work_items_select on public.planning_work_items
  for select to authenticated
  using (public.can_access_project(project_id));
create policy planning_work_items_insert on public.planning_work_items
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));
create policy planning_work_items_update on public.planning_work_items
  for update to authenticated
  using (public.can_manage_project_operations(project_id))
  with check (public.can_manage_project_operations(project_id));

-- No DELETE policy: a work item is archived (active = false), never removed —
-- the same rule master_milestones already applies.

create or replace function public.planning_work_item_project(p_work_item uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select project_id from public.planning_work_items where id = p_work_item;
$fn$;

comment on function public.planning_work_item_project(uuid) is
  'The project a planning work item belongs to. Security definer so planning_confirmations RLS can reach it without re-entering planning_work_items RLS.';

create table public.planning_activities (
  id                          uuid primary key default gen_random_uuid(),
  project_id                  uuid not null references public.projects(id) on delete cascade,
  work_item_id                uuid references public.planning_work_items(id) on delete set null,
  origin_import_row_id        uuid references public.planning_import_rows(id) on delete set null,

  external_id                 text,
  code                        text,
  name                        text not null,
  is_milestone                boolean not null default false,
  planned_start_date          date,
  planned_finish_date         date,
  baseline_start_date         date,
  baseline_finish_date        date,
  planned_duration_days       integer,
  -- The schedule's own %complete, as reported by P6/MSProject or entered
  -- manually. Deliberately distinct from Weekly/Monthly reported progress —
  -- this table never receives a report-sourced value.
  percent_complete_planned    numeric(6, 3),
  weight_percent              numeric(6, 3),
  source                      text not null default 'manual',
  active                      boolean not null default true,
  archived_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint planning_activities_name_not_blank check (length(btrim(name)) > 0),
  constraint planning_activities_source_valid check (source in ('import', 'manual')),
  constraint planning_activities_percent_range
    check (percent_complete_planned is null or percent_complete_planned between 0 and 100),
  constraint planning_activities_weight_range
    check (weight_percent is null or weight_percent between 0 and 100),
  constraint planning_activities_duration_non_negative
    check (planned_duration_days is null or planned_duration_days >= 0),
  constraint planning_activities_planned_date_order
    check (planned_start_date is null or planned_finish_date is null
           or planned_start_date <= planned_finish_date),
  constraint planning_activities_baseline_date_order
    check (baseline_start_date is null or baseline_finish_date is null
           or baseline_start_date <= baseline_finish_date)
);

comment on table public.planning_activities is
  'Schedule-level activities under a planning_work_items WBS node (P6 activities / MS Project tasks). Same governed-adjustment rule as planning_work_items: mutable, adjustments expected to be logged in planning_confirmations.';

create index planning_activities_project_work_item
  on public.planning_activities(project_id, work_item_id)
  where active;
create unique index planning_activities_external_unique
  on public.planning_activities(project_id, external_id)
  where external_id is not null;

create trigger set_updated_at before update on public.planning_activities
  for each row execute function public.set_updated_at();

-- An activity's work item, if set, must belong to the same project — the same
-- cross-project leak guard used throughout this migration.
create or replace function public.guard_planning_activity_work_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_work_item_project uuid;
begin
  if new.work_item_id is null then
    return new;
  end if;

  select project_id into v_work_item_project
    from public.planning_work_items
   where id = new.work_item_id;

  if v_work_item_project is null or v_work_item_project <> new.project_id then
    raise exception
      'A planning activity can only attach to a work item in the same project.'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$fn$;

create trigger planning_activities_work_item_guard
  before insert or update on public.planning_activities
  for each row execute function public.guard_planning_activity_work_item();

revoke execute on function public.guard_planning_activity_work_item()
  from public, anon, authenticated;

alter table public.planning_activities enable row level security;

create policy planning_activities_select on public.planning_activities
  for select to authenticated
  using (public.can_access_project(project_id));
create policy planning_activities_insert on public.planning_activities
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));
create policy planning_activities_update on public.planning_activities
  for update to authenticated
  using (public.can_manage_project_operations(project_id))
  with check (public.can_manage_project_operations(project_id));

-- No DELETE policy: archived, never removed — same rule as planning_work_items.

/* ============================================================================
   5. Confirmations / adjustments — append-only history
   ========================================================================= */

create table public.planning_confirmations (
  id                        uuid primary key default gen_random_uuid(),
  work_item_id              uuid not null
    references public.planning_work_items(id) on delete cascade,
  import_row_id             uuid references public.planning_import_rows(id) on delete set null,
  action                    text not null,
  field_name                text not null,
  previous_value            text,
  new_value                 text,
  reason                    text not null,
  confirmed_by_contact_id   uuid references public.contacts(id) on delete set null,
  confirmed_at              timestamptz not null default now(),
  constraint planning_confirmations_action_valid
    check (action in ('confirm', 'adjust')),
  constraint planning_confirmations_field_not_blank
    check (length(btrim(field_name)) > 0),
  constraint planning_confirmations_reason_not_blank
    check (length(btrim(reason)) > 0)
);

comment on table public.planning_confirmations is
  'Append-only record of every confirm/adjust decision made against a planning_work_items value, with a required reason. Never edited or removed — this is the history the "confirm/adjust, never overwrite the raw import" rule depends on.';

create index planning_confirmations_work_item
  on public.planning_confirmations(work_item_id, confirmed_at desc);

alter table public.planning_confirmations enable row level security;

create policy planning_confirmations_select on public.planning_confirmations
  for select to authenticated
  using (public.can_access_project(
    public.planning_work_item_project(work_item_id)));
create policy planning_confirmations_insert on public.planning_confirmations
  for insert to authenticated
  with check (public.can_manage_project_operations(
    public.planning_work_item_project(work_item_id)));

-- No UPDATE, no DELETE policy: append-only audit, exactly like milestone_updates.

/* ============================================================================
   6. Baselines — named, immutable captures
   ========================================================================= */

create table public.planning_baselines (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  name                   text not null,
  baseline_date          date not null,
  -- A frozen copy of the work items' planned/baseline values at capture time.
  -- Free-form by design, same convention as weekly_submissions.accomplishments
  -- — this is a point-in-time record, not a queryable working table.
  captured_items         jsonb not null default '[]'::jsonb,
  notes                  text,
  created_by_contact_id  uuid references public.contacts(id) on delete set null,
  created_at             timestamptz not null default now(),
  constraint planning_baselines_name_not_blank check (length(btrim(name)) > 0)
);

comment on table public.planning_baselines is
  'A named, immutable capture of planning_work_items at a point in time (e.g. "Original Baseline", "Rebaseline 1"). The current contractual baseline is the latest row for the project, or the one a planning_snapshots row explicitly references — there is no separate "is current" flag to drift from that.';

create index planning_baselines_project
  on public.planning_baselines(project_id, created_at desc);

alter table public.planning_baselines enable row level security;

-- Published Portfolio Read is wired onto this policy further below, once
-- planning_snapshots exists (this table is created first, in section 6;
-- referencing planning_snapshots here would forward-reference a table that
-- does not exist yet).
create policy planning_baselines_select on public.planning_baselines
  for select to authenticated
  using (public.can_access_project(project_id));
create policy planning_baselines_insert on public.planning_baselines
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));

-- No UPDATE, no DELETE policy: a baseline is a frozen record, immutable like
-- an approved report snapshot.

/* ============================================================================
   7. Milestone links — reference only, never a copy
   ========================================================================= */

-- Master Milestones remain the governed milestone source (13.2). This table
-- links a planning row that represents a milestone in the schedule to the
-- existing master_milestones identity — it never creates a second milestone
-- identity, and no milestone field is denormalized here (same rule 13.3
-- applies to master_deliverables.milestone_id).
create table public.planning_milestone_links (
  id                     uuid primary key default gen_random_uuid(),
  master_milestone_id    uuid not null references public.master_milestones(id) on delete cascade,
  work_item_id           uuid references public.planning_work_items(id) on delete cascade,
  activity_id            uuid references public.planning_activities(id) on delete cascade,
  created_by_contact_id  uuid references public.contacts(id) on delete set null,
  created_at             timestamptz not null default now(),
  constraint planning_milestone_links_one_target check (
    (work_item_id is not null and activity_id is null)
    or (work_item_id is null and activity_id is not null)
  )
);

comment on table public.planning_milestone_links is
  'Links a planning work item or activity to its governed Master Milestone identity. Reference only — master_milestones stays the single place a milestone is defined, and this table denormalizes none of its fields.';

create unique index planning_milestone_links_work_item_unique
  on public.planning_milestone_links(master_milestone_id, work_item_id)
  where work_item_id is not null;
create unique index planning_milestone_links_activity_unique
  on public.planning_milestone_links(master_milestone_id, activity_id)
  where activity_id is not null;

-- The linked work item / activity must belong to the same project as the
-- Master Milestone it is being tied to.
create or replace function public.guard_planning_milestone_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_milestone_project uuid;
  v_target_project uuid;
begin
  v_milestone_project := public.milestone_project(new.master_milestone_id);

  if new.work_item_id is not null then
    v_target_project := public.planning_work_item_project(new.work_item_id);
  else
    select project_id into v_target_project
      from public.planning_activities
     where id = new.activity_id;
  end if;

  if v_target_project is null or v_target_project <> v_milestone_project then
    raise exception
      'A planning milestone link must connect a work item or activity to a Master Milestone in the same project.'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$fn$;

create trigger planning_milestone_links_guard
  before insert or update on public.planning_milestone_links
  for each row execute function public.guard_planning_milestone_link();

revoke execute on function public.guard_planning_milestone_link()
  from public, anon, authenticated;

alter table public.planning_milestone_links enable row level security;

create policy planning_milestone_links_select on public.planning_milestone_links
  for select to authenticated
  using (public.can_access_project(public.milestone_project(master_milestone_id)));
create policy planning_milestone_links_insert on public.planning_milestone_links
  for insert to authenticated
  with check (public.can_manage_project_operations(
    public.milestone_project(master_milestone_id)));
create policy planning_milestone_links_delete on public.planning_milestone_links
  for delete to authenticated
  using (public.can_manage_project_operations(
    public.milestone_project(master_milestone_id)));

-- No UPDATE policy: a link is created or removed, never edited in place.

/* ============================================================================
   8. Planning Snapshots — the published source of truth
   ========================================================================= */

create table public.planning_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects(id) on delete cascade,
  version                 integer not null,
  source_import_batch_id  uuid references public.planning_import_batches(id) on delete set null,
  baseline_id             uuid references public.planning_baselines(id) on delete set null,
  is_opening_snapshot     boolean not null default false,
  label                   text,
  -- Full captured planning content at publish time: work items, activities
  -- and milestone links, exactly as approved-report snapshots capture their
  -- own compiled content (03_REPORTING_ARCHITECTURE.md §11.2).
  snapshot_data           jsonb not null,
  published_by_contact_id uuid references public.contacts(id) on delete set null,
  published_at            timestamptz not null default now(),
  constraint planning_snapshots_project_version_unique unique (project_id, version),
  constraint planning_snapshots_version_positive check (version > 0)
);

comment on table public.planning_snapshots is
  'The Published Planning Snapshot: the planning source of truth. Written exactly once per row, only through public.publish_planning_snapshot() — no UPDATE or DELETE policy exists. Weekly and Monthly reports link to an exact planning_snapshot_id, never to "current planning".';

create index planning_snapshots_project_version
  on public.planning_snapshots(project_id, version desc);

alter table public.planning_snapshots enable row level security;

-- Every row in this table is, by construction, published output — it is
-- written exactly once, immutably, only by publish_planning_snapshot(). So
-- unlike the report tiers (which gate published visibility on a status
-- column such as finalized/locked), no further status check is needed here:
-- has_published_portfolio_read() alone is the correct gate, across every
-- project, mirroring how projects_select already reads for this tier
-- (20260912000003). Full tier keeps its existing reach via can_access_project().
create policy planning_snapshots_select on public.planning_snapshots
  for select to authenticated
  using (
    public.can_access_project(project_id)
    or public.has_published_portfolio_read()
  );
create policy planning_snapshots_insert on public.planning_snapshots
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));

-- No UPDATE, no DELETE policy: immutable once published, exactly like an
-- approved report's snapshot. The UNIQUE(project_id, version) constraint
-- means only public.publish_planning_snapshot() can produce a coherent
-- sequence; a hand-crafted insert cannot silently overwrite it.

-- Completes planning_baselines_select, deferred from section 6 to avoid
-- forward-referencing this table before it existed. Published Portfolio Read
-- sees a baseline only when a published snapshot actually references it —
-- "minimal published baseline metadata required to interpret" a snapshot,
-- not the whole baseline register. A baseline captured but never published in
-- any snapshot stays invisible to this tier, same as any other working
-- Planning content.
alter policy planning_baselines_select on public.planning_baselines
  using (
    public.can_access_project(project_id)
    or (
      public.has_published_portfolio_read()
      and exists (
        select 1 from public.planning_snapshots s
         where s.baseline_id = planning_baselines.id
      )
    )
  );

/* ============================================================================
   8b. Opening Positions — for a project onboarded mid-execution
   ========================================================================= */

-- "Do not create fake history": a project already running when it adopts
-- EPRP has no from-zero activity history to import, and inventing one would
-- misrepresent what was actually planned and done before today. An Opening
-- Position is the honest alternative — a single declared position as of a
-- data date — which becomes the project's Snapshot V1 with no fabricated
-- work items or activities beneath it.
create table public.planning_opening_positions (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references public.projects(id) on delete cascade,
  data_date                 date not null,
  -- Nullable: an existing project may honestly not know one or both figures
  -- as of the data date. Absence is not zero (architecture principle 7).
  planned_progress_percent  numeric(6, 3),
  actual_progress_percent   numeric(6, 3),
  forecast_finish_date      date,
  -- Free text by design — this describes provenance ("Prior contractor
  -- S-curve", "Client handover report"), not a closed business taxonomy this
  -- migration has no authority to invent.
  source                    text not null,
  status                    text not null default 'draft',
  promoted_at               timestamptz,
  promoted_to_snapshot_id   uuid references public.planning_snapshots(id) on delete set null,
  created_by_contact_id     uuid references public.contacts(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint planning_opening_positions_source_not_blank check (length(btrim(source)) > 0),
  constraint planning_opening_positions_status_valid check (status in ('draft', 'promoted')),
  constraint planning_opening_positions_planned_range
    check (planned_progress_percent is null or planned_progress_percent between 0 and 100),
  constraint planning_opening_positions_actual_range
    check (actual_progress_percent is null or actual_progress_percent between 0 and 100),
  -- Both promotion fields arrive together, from public.publish_planning_snapshot()
  -- only — never independently, and never before the other.
  constraint planning_opening_positions_promotion_complete check (
    (status = 'draft' and promoted_at is null and promoted_to_snapshot_id is null)
    or (status = 'promoted' and promoted_at is not null and promoted_to_snapshot_id is not null)
  )
);

comment on table public.planning_opening_positions is
  'A declared starting position for a project onboarded mid-execution (onboarding_mode=existing_active_project), as of a data date. Promoted into Snapshot V1 by public.publish_planning_snapshot() — never used to fabricate planning_work_items/planning_activities history that never existed.';

-- At most one open draft per project — editing an existing draft is
-- unambiguous, and there is never a queue of competing starting positions.
create unique index planning_opening_positions_one_draft
  on public.planning_opening_positions(project_id)
  where status = 'draft';

create index planning_opening_positions_project
  on public.planning_opening_positions(project_id, created_at desc);

create trigger set_updated_at before update on public.planning_opening_positions
  for each row execute function public.set_updated_at();

-- Once promoted, a position is history: it produced Snapshot V1, so it must
-- stop moving too — same shape as guard_planning_import_batch().
create or replace function public.guard_planning_opening_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if old.status = 'promoted' then
    raise exception
      'A promoted Opening Position is immutable. It has already produced a Planning Snapshot.'
      using errcode = 'restrict_violation';
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception
      'An Opening Position cannot be reassigned to another project.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$fn$;

create trigger planning_opening_positions_guard
  before update on public.planning_opening_positions
  for each row execute function public.guard_planning_opening_position();

revoke execute on function public.guard_planning_opening_position()
  from public, anon, authenticated;

alter table public.planning_opening_positions enable row level security;

create policy planning_opening_positions_select on public.planning_opening_positions
  for select to authenticated
  using (public.can_access_project(project_id));
create policy planning_opening_positions_insert on public.planning_opening_positions
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));
create policy planning_opening_positions_update on public.planning_opening_positions
  for update to authenticated
  using (public.can_manage_project_operations(project_id))
  with check (public.can_manage_project_operations(project_id));

-- No DELETE policy: same audit-preserving rule as every other table here.

-- Completes the reference the table above started: a snapshot may now record
-- which Opening Position produced it, exactly as it already records which
-- import batch did. Added here, not in section 8, purely to avoid a circular
-- forward reference between the two tables at creation time.
alter table public.planning_snapshots
  add column source_opening_position_id uuid
    references public.planning_opening_positions(id) on delete set null;

alter table public.planning_snapshots
  add constraint planning_snapshots_source_exclusive check (
    source_import_batch_id is null or source_opening_position_id is null
  );

comment on column public.planning_snapshots.source_opening_position_id is
  'Set when this snapshot was published from an Opening Position (onboarding_mode=existing_active_project). Mutually exclusive with source_import_batch_id.';

/* ============================================================================
   8c. Snapshot-owned activity history — normalized, immutable, drillable
   ========================================================================= */

-- A published snapshot's `snapshot_data` JSON captures the whole point-in-time
-- picture (work items, activities, milestone links) for archival fidelity,
-- but a JSON blob cannot be queried, joined, or paginated — and Weekly/
-- Monthly drill-down needs exactly that. This table is the normalized,
-- immutable per-activity record a specific snapshot owns, so "what did
-- Snapshot v3 say about Activity A-104" is a row, not a JSON traversal.
--
-- A later edit or import to planning_activities can NEVER alter this table:
-- these rows are copied once, at publish time, by public.publish_planning_snapshot()
-- alone, and carry no live reference back to the mutable working register
-- other than an informational, nullable pointer.
create table public.planning_snapshot_activities (
  id                        uuid primary key default gen_random_uuid(),
  snapshot_id               uuid not null references public.planning_snapshots(id) on delete cascade,
  -- Traceability only, not authority: the working row may later be edited,
  -- archived, or deleted (ON DELETE SET NULL) without touching this history.
  source_activity_id        uuid references public.planning_activities(id) on delete set null,
  source_work_item_id       uuid references public.planning_work_items(id) on delete set null,
  code                      text,
  name                      text not null,
  is_milestone              boolean not null default false,
  planned_start_date        date,
  planned_finish_date       date,
  baseline_start_date       date,
  baseline_finish_date      date,
  percent_complete_planned  numeric(6, 3),
  weight_percent            numeric(6, 3),
  created_at                timestamptz not null default now()
);

comment on table public.planning_snapshot_activities is
  'Normalized, immutable per-activity record owned by one planning_snapshots row, written exactly once by public.publish_planning_snapshot(). This is the queryable drill-down/provenance path for a snapshot''s activity data — snapshot_data''s JSON is a convenience archive, not the only record.';

create index planning_snapshot_activities_snapshot
  on public.planning_snapshot_activities(snapshot_id);

alter table public.planning_snapshot_activities enable row level security;

create or replace function public.planning_snapshot_project(p_snapshot uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select project_id from public.planning_snapshots where id = p_snapshot;
$fn$;

comment on function public.planning_snapshot_project(uuid) is
  'The project a planning snapshot belongs to. Security definer so planning_snapshot_activities RLS can reach it without re-entering planning_snapshots RLS.';

-- Same reasoning as planning_snapshots_select: every row here is immutable
-- content of an already-published snapshot, so the published tier's gate is
-- unconditional once granted — there is no draft state to exclude.
create policy planning_snapshot_activities_select on public.planning_snapshot_activities
  for select to authenticated
  using (
    public.can_access_project(public.planning_snapshot_project(snapshot_id))
    or public.has_published_portfolio_read()
  );
create policy planning_snapshot_activities_insert on public.planning_snapshot_activities
  for insert to authenticated
  with check (public.can_manage_project_operations(
    public.planning_snapshot_project(snapshot_id)));

-- No UPDATE, no DELETE policy: immutable, exactly like the snapshot that owns
-- these rows. A later edit or import to planning_activities cannot reach here.

/* ============================================================================
   9. Weekly / Monthly linkage — nullable until Planning is initialized
   ========================================================================= */

alter table public.weekly_reports
  add column if not exists planning_snapshot_id uuid
    references public.planning_snapshots(id) on delete set null;
alter table public.monthly_reports
  add column if not exists planning_snapshot_id uuid
    references public.planning_snapshots(id) on delete set null;

comment on column public.weekly_reports.planning_snapshot_id is
  'The exact Published Planning Snapshot this report was raised against. Nullable: a project without an initialized Planning register falls back to its own planned_progress/actual_progress fields, per the Planning Slice 1 brief.';
comment on column public.monthly_reports.planning_snapshot_id is
  'The exact Published Planning Snapshot this report compiles against. Nullable until Planning is initialized for the project.';

create index weekly_reports_planning_snapshot
  on public.weekly_reports(planning_snapshot_id)
  where planning_snapshot_id is not null;
create index monthly_reports_planning_snapshot
  on public.monthly_reports(planning_snapshot_id)
  where planning_snapshot_id is not null;

/* ============================================================================
   10. publish_planning_snapshot() — the one governed publish path
   ========================================================================= */

/*
 * Publishes the CURRENT governed planning register (planning_work_items,
 * planning_activities, planning_milestone_links) for a project as one new,
 * immutable planning_snapshots row, plus one normalized, immutable
 * planning_snapshot_activities row per active activity — the drillable
 * history a JSON blob alone cannot serve. When raised from an import, the
 * source batch is marked published in the same transaction; when raised from
 * an Opening Position, that position is marked promoted instead.
 *
 * p_import_batch_id and p_opening_position_id are mutually exclusive and both
 * optional: a project may also publish from its own confirmed manual planning
 * with neither (the "manual fallback" path). p_baseline_id is optional and,
 * if given, must belong to the same project.
 *
 * An Opening Position can only ever become Snapshot V1 — "Do not create fake
 * history" means there is no from-zero work-item/activity content beneath it,
 * only the declared position itself, captured in snapshot_data.opening_position.
 *
 * Authorization is re-checked explicitly inside this SECURITY DEFINER
 * function rather than left to table RLS alone — the same discipline
 * submit_finalized_weekly_milestones() already applies, because a definer
 * function's own privileges are not a substitute for verifying the caller's.
 */
create or replace function public.publish_planning_snapshot(
  p_project_id uuid,
  p_import_batch_id uuid default null,
  p_baseline_id uuid default null,
  p_is_opening_snapshot boolean default false,
  p_label text default null,
  p_opening_position_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_batch_project uuid;
  v_batch_status text;
  v_baseline_project uuid;
  v_position_project uuid;
  v_position_status text;
  v_position_data_date date;
  v_position_planned numeric(6, 3);
  v_position_actual numeric(6, 3);
  v_position_forecast date;
  v_position_source text;
  v_onboarding_mode text;
  v_version integer;
  v_snapshot_data jsonb;
  v_is_opening boolean;
  v_snapshot_id uuid;
begin
  if not public.can_manage_project_operations(p_project_id) then
    raise exception
      'Publishing a Planning Snapshot requires Project Control authority on this project.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_import_batch_id is not null and p_opening_position_id is not null then
    raise exception
      'A Planning Snapshot can be published from an import batch or an Opening Position, never both.'
      using errcode = 'check_violation';
  end if;

  -- Serializes concurrent publishes for the same project so the version
  -- sequence below cannot race. Same pattern as the existing project
  -- responsibility-membership guards.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text, 0)
  );

  if p_import_batch_id is not null then
    select project_id, status into v_batch_project, v_batch_status
      from public.planning_import_batches
     where id = p_import_batch_id
       for update;

    if v_batch_project is null then
      raise exception 'Planning import batch % not found.', p_import_batch_id
        using errcode = 'foreign_key_violation';
    end if;
    if v_batch_project <> p_project_id then
      raise exception
        'This import batch belongs to a different project.'
        using errcode = 'foreign_key_violation';
    end if;
    if v_batch_status = 'published' then
      raise exception
        'This import batch has already been published. Import a new batch to publish again.'
        using errcode = 'restrict_violation';
    end if;
  end if;

  if p_baseline_id is not null then
    select project_id into v_baseline_project
      from public.planning_baselines
     where id = p_baseline_id;

    if v_baseline_project is null or v_baseline_project <> p_project_id then
      raise exception
        'This baseline does not belong to the project being published.'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.planning_snapshots
   where project_id = p_project_id;

  v_is_opening := p_opening_position_id is not null or coalesce(p_is_opening_snapshot, false);

  if p_opening_position_id is not null then
    select project_id, status, data_date, planned_progress_percent,
           actual_progress_percent, forecast_finish_date, source
      into v_position_project, v_position_status, v_position_data_date,
           v_position_planned, v_position_actual, v_position_forecast,
           v_position_source
      from public.planning_opening_positions
     where id = p_opening_position_id
       for update;

    if not found then
      raise exception 'Opening Position % not found.', p_opening_position_id
        using errcode = 'foreign_key_violation';
    end if;
    if v_position_project <> p_project_id then
      raise exception
        'This Opening Position belongs to a different project.'
        using errcode = 'foreign_key_violation';
    end if;
    if v_position_status = 'promoted' then
      raise exception
        'This Opening Position has already been promoted to a Planning Snapshot.'
        using errcode = 'restrict_violation';
    end if;

    select onboarding_mode into v_onboarding_mode
      from public.project_planning_settings
     where project_id = p_project_id;

    if v_onboarding_mode is distinct from 'existing_active_project' then
      raise exception
        'An Opening Position can only be promoted for a project whose Planning Onboarding Mode is existing_active_project.'
        using errcode = 'check_violation';
    end if;
    if v_version <> 1 then
      raise exception
        'An Opening Position can only become the project''s first Planning Snapshot (version 1). This project already has a published snapshot.'
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- "Do not create fake history": when publishing from an Opening Position,
  -- planning_work_items/planning_activities are read exactly as they stand —
  -- normally empty, because none were fabricated — never seeded here.
  select jsonb_build_object(
    'work_items', coalesce((
      select jsonb_agg(to_jsonb(wi) order by wi.sort_order, wi.code)
        from public.planning_work_items wi
       where wi.project_id = p_project_id and wi.active
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.work_item_id, a.code)
        from public.planning_activities a
       where a.project_id = p_project_id and a.active
    ), '[]'::jsonb),
    'milestone_links', coalesce((
      select jsonb_agg(to_jsonb(l))
        from public.planning_milestone_links l
       where l.master_milestone_id in (
         select id from public.master_milestones where project_id = p_project_id
       )
    ), '[]'::jsonb),
    'opening_position', case when p_opening_position_id is not null then
      jsonb_build_object(
        'id', p_opening_position_id,
        'data_date', v_position_data_date,
        'planned_progress_percent', v_position_planned,
        'actual_progress_percent', v_position_actual,
        'forecast_finish_date', v_position_forecast,
        'source', v_position_source
      )
    else null end
  ) into v_snapshot_data;

  insert into public.planning_snapshots (
    project_id,
    version,
    source_import_batch_id,
    source_opening_position_id,
    baseline_id,
    is_opening_snapshot,
    label,
    snapshot_data,
    published_by_contact_id
  ) values (
    p_project_id,
    v_version,
    p_import_batch_id,
    p_opening_position_id,
    p_baseline_id,
    v_is_opening,
    p_label,
    v_snapshot_data,
    public.current_contact_id()
  )
  returning id into v_snapshot_id;

  -- The normalized, drillable activity history this snapshot owns. Empty for
  -- a from-zero Opening Position, by design — see the note above.
  insert into public.planning_snapshot_activities (
    snapshot_id, source_activity_id, source_work_item_id, code, name,
    is_milestone, planned_start_date, planned_finish_date,
    baseline_start_date, baseline_finish_date,
    percent_complete_planned, weight_percent
  )
  select
    v_snapshot_id, a.id, a.work_item_id, a.code, a.name, a.is_milestone,
    a.planned_start_date, a.planned_finish_date,
    a.baseline_start_date, a.baseline_finish_date,
    a.percent_complete_planned, a.weight_percent
  from public.planning_activities a
  where a.project_id = p_project_id and a.active;

  if p_import_batch_id is not null then
    update public.planning_import_batches
       set status = 'published'
     where id = p_import_batch_id;
  end if;

  if p_opening_position_id is not null then
    update public.planning_opening_positions
       set status = 'promoted',
           promoted_at = now(),
           promoted_to_snapshot_id = v_snapshot_id
     where id = p_opening_position_id;
  end if;

  return v_snapshot_id;
end;
$fn$;

comment on function public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid) is
  'Governed publish path for a Planning Snapshot: captures the project''s current planning_work_items/planning_activities/planning_milestone_links into one immutable planning_snapshots row plus normalized planning_snapshot_activities rows, and marks the source import batch published or Opening Position promoted when one is given. The only writer of planning_snapshots/planning_snapshot_activities as a matter of policy; direct inserts remain technically possible to Project Control but must independently satisfy the version sequence and the Opening-Position-is-always-V1 rule.';

revoke execute on function public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid)
  from public, anon;
grant execute on function public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid)
  to authenticated, service_role;

/* ----------------------------- postconditions ----------------------------- */

do $post$
declare
  v_missing_rls integer;
  v_blanket integer;
  v_portfolio_read_leak integer;
  v_tables text[] := array[
    'portfolio_groups', 'project_planning_settings',
    'planning_import_batches', 'planning_import_rows',
    'planning_work_items', 'planning_activities',
    'planning_confirmations', 'planning_baselines',
    'planning_milestone_links', 'planning_snapshots',
    'planning_opening_positions', 'planning_snapshot_activities'
  ];
begin
  select count(*) into v_missing_rls
    from unnest(v_tables) t(tablename)
   where not exists (
     select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = t.tablename
        and c.relrowsecurity
   );
  if v_missing_rls > 0 then
    raise exception 'Post-check failed: % Planning table(s) missing RLS.', v_missing_rls;
  end if;

  -- SELECT is intentionally excluded: portfolio_groups_select is `using (true)`
  -- by design, the same open-read convention clients/departments already use
  -- for Tier 1 master data (20260824000001). This check exists to catch a
  -- blanket WRITE policy, exactly like the Authorization Foundation's own
  -- postcondition does.
  select count(*) into v_blanket
    from pg_policies
   where schemaname = 'public'
     and tablename = any(v_tables)
     and cmd <> 'SELECT'
     and (qual = 'true' or with_check = 'true');
  if v_blanket > 0 then
    raise exception 'Post-check failed: % blanket (unconditional true) write policy/policies on Planning tables.', v_blanket;
  end if;

  if has_function_privilege('anon', 'public.publish_planning_snapshot(uuid, uuid, uuid, boolean, text, uuid)', 'EXECUTE') then
    raise exception 'Post-check failed: publish_planning_snapshot() is executable by anon.';
  end if;

  -- Proof, not assertion: a portfolio-wide READ ONLY grant (has_full_portfolio_read /
  -- has_published_portfolio_read / portfolio_read_tier, 20260912000003) must never
  -- appear in a Planning WRITE policy. Every Planning write policy in this
  -- migration uses can_manage_project_operations() alone; this queries
  -- pg_policies directly, the same proof pattern 20260912000003 uses for its
  -- own helpers.
  select count(*) into v_portfolio_read_leak
    from pg_policies
   where schemaname = 'public'
     and tablename = any(v_tables)
     and cmd <> 'SELECT'
     and (
       coalesce(qual, '') || coalesce(with_check, '') like '%has_full_portfolio_read%'
       or coalesce(qual, '') || coalesce(with_check, '') like '%has_published_portfolio_read%'
       or coalesce(qual, '') || coalesce(with_check, '') like '%portfolio_read_tier%'
       or coalesce(qual, '') || coalesce(with_check, '') like '%weekly_report_viewable%'
       or coalesce(qual, '') || coalesce(with_check, '') like '%monthly_report_viewable%'
     );
  if v_portfolio_read_leak > 0 then
    raise exception
      'Post-check failed: % Planning write polic(y/ies) reference a portfolio-read-only helper — write authority would leak from a read grant.',
      v_portfolio_read_leak;
  end if;

  -- Positive proof, mirroring 20260912000003's own count-based check: exactly
  -- these three SELECT policies carry the published-tier branch — the
  -- published planning_snapshots header, its immutable
  -- planning_snapshot_activities detail, and the minimal referenced
  -- planning_baselines row needed to interpret either. No other Planning
  -- table (imports, confirmations, the live work-item/activity register,
  -- Opening Positions) may ever gain one.
  if (
    select count(*) from pg_policies
     where schemaname = 'public'
       and cmd = 'SELECT'
       and tablename in ('planning_snapshots', 'planning_snapshot_activities', 'planning_baselines')
       and coalesce(qual, '') like '%has_published_portfolio_read%'
  ) <> 3 then
    raise exception
      'Post-check failed: expected exactly 3 Planning SELECT policies wired to has_published_portfolio_read() (planning_snapshots, planning_snapshot_activities, planning_baselines).';
  end if;

  if (
    select count(*) from pg_policies
     where schemaname = 'public'
       and tablename in (
         'planning_import_batches', 'planning_import_rows', 'planning_confirmations',
         'planning_work_items', 'planning_activities', 'planning_opening_positions',
         'planning_milestone_links', 'project_planning_settings', 'portfolio_groups'
       )
       and coalesce(qual, '') || coalesce(with_check, '') like '%has_published_portfolio_read%'
  ) > 0 then
    raise exception
      'Post-check failed: has_published_portfolio_read() leaked onto a table it must never reach (draft imports, confirmations, live work items/activities, or Opening Positions).';
  end if;

  raise notice 'Planning Slice 1 foundation installed: % tables, all RLS-enabled, no blanket write policy, no portfolio-read-grant write leak, Published Portfolio Read wired to exactly snapshots/snapshot-activities/referenced-baselines, publish_planning_snapshot() gated to authenticated + internal authorization check.', array_length(v_tables, 1);
end;
$post$;
