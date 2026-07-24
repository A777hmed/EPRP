-- EPRP OC-2 — project organization charts.
--
-- Hierarchy is stored relationally (`parent_position_id` + `sort_order`),
-- never as canvas coordinates: the shape of the org is data, and any layout
-- the editor needs is derived at render time.
--
-- People come from `contacts`, the platform's existing person record. There
-- is no separate employees table, so a position is filled by a contact.

/* ----------------------------- Charts ------------------------------------ */

create table public.organization_charts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  description text,
  -- draft → active → archived. Only one chart per project may be `active`.
  status      text not null default 'draft',
  -- How the chart was started, for reporting on template/import adoption.
  source      text not null default 'blank',
  version     integer not null default 1,

  -- Soft delete (platform convention).
  active      boolean not null default true,
  archived_at timestamptz,

  -- Audit. `auth.uid()` is null until authentication lands, which is why
  -- these are nullable rather than required.
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint organization_charts_status_valid
    check (status in ('draft', 'active', 'archived')),
  constraint organization_charts_source_valid
    check (source in ('blank', 'template', 'excel_import')),
  -- Lets child rows carry the project and have the database prove it
  -- matches the chart's project.
  constraint organization_charts_id_project_key unique (id, project_id)
);

-- One live chart per project. Partial so drafts and archived charts are
-- unconstrained, and so a soft-deleted chart frees the slot.
create unique index organization_charts_one_active_per_project
  on public.organization_charts(project_id)
  where status = 'active' and active;

create index idx_organization_charts_project_id
  on public.organization_charts(project_id);
create index idx_organization_charts_status
  on public.organization_charts(status);
create index idx_organization_charts_active
  on public.organization_charts(active) where active;

/* ---------------------------- Positions ---------------------------------- */

create table public.organization_positions (
  id                 uuid not null default gen_random_uuid(),
  chart_id           uuid not null,
  -- Denormalised so a position is provably scoped to both chart and project.
  project_id         uuid not null,
  parent_position_id uuid,

  title              text not null,
  code               text,
  role               text,
  notes              text,

  -- Master data this position reports through.
  department_id      uuid references public.departments(id) on delete set null,
  discipline_id      uuid references public.disciplines(id) on delete set null,
  -- The person currently filling the position; null means vacant.
  contact_id         uuid references public.contacts(id) on delete set null,

  -- Ordering among siblings. Presentation order only — not a coordinate.
  sort_order         integer not null default 0,

  active             boolean not null default true,
  archived_at        timestamptz,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  primary key (id),

  -- The chart must belong to the project the position claims.
  constraint organization_positions_chart_project_fk
    foreign key (chart_id, project_id)
    references public.organization_charts(id, project_id)
    on delete cascade,

  -- Needed so the parent FK below can assert "same chart".
  constraint organization_positions_id_chart_key unique (id, chart_id),

  -- A parent must live in the same chart. Deleting a parent removes the
  -- branch beneath it.
  constraint organization_positions_parent_fk
    foreign key (parent_position_id, chart_id)
    references public.organization_positions(id, chart_id)
    on delete cascade,

  constraint organization_positions_no_self_parent
    check (parent_position_id is null or parent_position_id <> id)
);

create index idx_organization_positions_chart_id
  on public.organization_positions(chart_id);
create index idx_organization_positions_project_id
  on public.organization_positions(project_id);
create index idx_organization_positions_parent_id
  on public.organization_positions(parent_position_id);
create index idx_organization_positions_department_id
  on public.organization_positions(department_id);
create index idx_organization_positions_discipline_id
  on public.organization_positions(discipline_id);
create index idx_organization_positions_contact_id
  on public.organization_positions(contact_id);
-- Sibling reads: children of a parent in display order.
create index idx_organization_positions_sibling_order
  on public.organization_positions(chart_id, parent_position_id, sort_order);

/* ------------------------ Assignment history ----------------------------- */

-- Append-only: who held which position and when. Deliberately has no soft
-- delete or `updated_at` — an audit trail that can be edited is not one.
create table public.position_assignment_history (
  id                  uuid primary key default gen_random_uuid(),
  position_id         uuid not null references public.organization_positions(id) on delete cascade,
  chart_id            uuid not null references public.organization_charts(id) on delete cascade,
  project_id          uuid not null references public.projects(id) on delete cascade,

  -- Null `contact_id` records a vacancy.
  contact_id          uuid references public.contacts(id) on delete set null,
  previous_contact_id uuid references public.contacts(id) on delete set null,
  action              text not null,

  effective_from      date not null default current_date,
  effective_to        date,
  note                text,

  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),

  constraint position_assignment_history_action_valid
    check (action in ('assigned', 'reassigned', 'vacated')),
  constraint position_assignment_history_period_valid
    check (effective_to is null or effective_to >= effective_from)
);

create index idx_position_assignment_history_position_id
  on public.position_assignment_history(position_id);
create index idx_position_assignment_history_chart_id
  on public.position_assignment_history(chart_id);
create index idx_position_assignment_history_project_id
  on public.position_assignment_history(project_id);
create index idx_position_assignment_history_contact_id
  on public.position_assignment_history(contact_id);
create index idx_position_assignment_history_created_at
  on public.position_assignment_history(created_at desc);

/* ------------------------------ Triggers --------------------------------- */

create trigger set_updated_at before update on public.organization_charts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.organization_positions
  for each row execute function public.set_updated_at();

/* -------------------------------- RLS ------------------------------------ */

alter table public.organization_charts          enable row level security;
alter table public.organization_positions       enable row level security;
alter table public.position_assignment_history  enable row level security;

-- Matches the temporary "authenticated full access" policies used by every
-- other table. TODO: replace with role-based policies once auth + RBAC exist.
do $$
declare
  tbl text;
  tables text[] := array[
    'organization_charts',
    'organization_positions',
    'position_assignment_history'
  ];
begin
  foreach tbl in array tables loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      tbl || '_authenticated_all',
      tbl
    );
  end loop;
end;
$$;

/* ------------------------------ Comments --------------------------------- */

comment on table public.organization_charts is
  'Project organization charts. One chart per project may have status = active.';
comment on column public.organization_positions.parent_position_id is
  'Relational hierarchy. Layout is derived at render time, never stored.';
comment on column public.organization_positions.sort_order is
  'Order among siblings only — not a canvas coordinate.';
comment on column public.organization_positions.contact_id is
  'The person filling this position; null means vacant.';
comment on table public.position_assignment_history is
  'Append-only record of who filled a position and when.';
