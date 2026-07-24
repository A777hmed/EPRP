-- EPRP Phase 5C — Core master-data & project schema.
-- UUID PKs, created_at/updated_at, active + archived_at soft-delete fields,
-- foreign keys with safe-delete semantics, unique codes, and indexes.

create extension if not exists "pgcrypto";

-- updated_at maintenance ---------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Master data: clients -----------------------------------------------------

create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text unique,
  short_name    text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  country       text,
  city          text,
  address       text,
  logo_ref      text,
  active        boolean not null default true,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Master data: project_types ----------------------------------------------

create table public.project_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text unique,
  description text,
  active      boolean not null default true,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Master data: project_phases ---------------------------------------------

create table public.project_phases (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text unique,
  description   text,
  display_order integer not null default 0,
  active        boolean not null default true,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Master data: departments (lead FK added after contacts exists) ----------

create table public.departments (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  code            text not null unique,
  description     text,
  lead_contact_id uuid,
  active          boolean not null default true,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Master data: contacts ----------------------------------------------------

create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  position      text,
  role          text,
  organization  text,
  email         text,
  phone         text,
  department_id uuid references public.departments(id) on delete set null,
  active        boolean not null default true,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Circular FK: department lead references a contact.
alter table public.departments
  add constraint departments_lead_contact_id_fkey
  foreign key (lead_contact_id) references public.contacts(id) on delete set null;

-- Master data: systems -----------------------------------------------------

create table public.systems (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text not null unique,
  department_id uuid references public.departments(id) on delete set null,
  description   text,
  active        boolean not null default true,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Master data: disciplines -------------------------------------------------

create table public.disciplines (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text not null unique,
  department_id uuid references public.departments(id) on delete set null,
  description   text,
  active        boolean not null default true,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Projects -----------------------------------------------------------------
-- Responsibility roles are 1:1 columns (safe-delete via RESTRICT on the
-- manager, SET NULL on optional roles). `project_contacts` below holds any
-- additional many-to-many project↔contact links.

create table public.projects (
  id                         uuid primary key default gen_random_uuid(),
  code                       text not null unique,
  name                       text not null,
  short_name                 text,
  description                text,
  project_type_id            uuid references public.project_types(id) on delete restrict,
  client_id                  uuid not null references public.clients(id) on delete restrict,
  contract_number            text,
  purchase_order_number      text,

  contract_start_date        date,
  planned_start_date         date not null,
  actual_start_date          date,
  planned_finish_date        date not null,
  forecast_finish_date       date,
  actual_finish_date         date,

  project_manager_id         uuid not null references public.contacts(id) on delete restrict,
  project_control_manager_id uuid references public.contacts(id) on delete set null,
  client_representative_id   uuid references public.contacts(id) on delete set null,
  reporting_coordinator_id   uuid references public.contacts(id) on delete set null,
  project_sponsor_id         uuid references public.contacts(id) on delete set null,

  status                     text not null default 'planning',
  overall_status             text not null default 'on_track',
  planned_progress           integer not null default 0,
  actual_progress            integer not null default 0,
  current_phase_id           uuid references public.project_phases(id) on delete set null,
  priority                   text not null default 'medium',

  weekly_enabled             boolean not null default true,
  monthly_enabled            boolean not null default true,
  executive_enabled          boolean not null default true,
  weekly_reporting_day       text not null default 'thursday',
  monthly_cutoff_day         integer not null default 25,
  currency                   text not null default 'EGP',
  working_week               text not null default 'Sun – Thu',
  time_zone                  text not null default 'Africa/Cairo',

  site                       text,
  country                    text,
  city                       text,
  client_contact_name        text,
  client_contact_email       text,
  client_contact_phone       text,

  project_logo_ref           text,
  client_logo_ref            text,
  report_header_title        text,
  report_footer_text         text,
  report_reference_prefix    text,
  default_language           text not null default 'en',
  include_qr_code            boolean not null default true,
  include_signature_section  boolean not null default true,

  active                     boolean not null default true,
  archived_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint projects_planned_progress_range check (planned_progress between 0 and 100),
  constraint projects_actual_progress_range check (actual_progress between 0 and 100),
  constraint projects_planned_dates check (planned_finish_date >= planned_start_date)
);

-- Join: project ↔ department (with per-project lead, reporting flag, systems)

create table public.project_departments (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  department_id      uuid not null references public.departments(id) on delete restrict,
  lead_name          text,
  reporting_required boolean not null default true,
  -- Per-project system assignments (denormalized name/code snapshots).
  systems            jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, department_id)
);

-- Join: project ↔ contact (additional links beyond the responsibility roles)

create table public.project_contacts (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  role       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, contact_id, role)
);

-- updated_at triggers ------------------------------------------------------

create trigger set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.project_types
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.project_phases
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.departments
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.systems
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.disciplines
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.project_departments
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.project_contacts
  for each row execute function public.set_updated_at();

-- Indexes ------------------------------------------------------------------

create index idx_contacts_department_id on public.contacts(department_id);
create index idx_departments_lead_contact_id on public.departments(lead_contact_id);
create index idx_systems_department_id on public.systems(department_id);
create index idx_disciplines_department_id on public.disciplines(department_id);

create index idx_projects_client_id on public.projects(client_id);
create index idx_projects_project_type_id on public.projects(project_type_id);
create index idx_projects_current_phase_id on public.projects(current_phase_id);
create index idx_projects_project_manager_id on public.projects(project_manager_id);
create index idx_projects_status on public.projects(status);
create index idx_projects_active on public.projects(active);

create index idx_project_departments_project_id on public.project_departments(project_id);
create index idx_project_departments_department_id on public.project_departments(department_id);
create index idx_project_contacts_project_id on public.project_contacts(project_id);
create index idx_project_contacts_contact_id on public.project_contacts(contact_id);

-- Partial indexes for the common "active only" list queries.
create index idx_clients_active on public.clients(active) where active;
create index idx_departments_active on public.departments(active) where active;
create index idx_systems_active on public.systems(active) where active;
create index idx_disciplines_active on public.disciplines(active) where active;
create index idx_contacts_active on public.contacts(active) where active;
