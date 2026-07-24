-- EPRP — project setup wizard links.
--
-- The wizard scopes disciplines and people to the department (and system)
-- they were chosen under. Both are project-scoped join tables rather than
-- columns on the shared master records, because the same discipline or
-- contact can serve a different system or role on another project.

create table public.project_disciplines (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  discipline_id uuid not null references public.disciplines(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  system_id     uuid references public.systems(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, discipline_id, system_id)
);

create trigger set_updated_at before update on public.project_disciplines
  for each row execute function public.set_updated_at();

create index idx_project_disciplines_project_id
  on public.project_disciplines(project_id);
create index idx_project_disciplines_discipline_id
  on public.project_disciplines(discipline_id);
create index idx_project_disciplines_department_id
  on public.project_disciplines(department_id);
create index idx_project_disciplines_system_id
  on public.project_disciplines(system_id);

alter table public.project_disciplines enable row level security;
create policy project_disciplines_authenticated_all on public.project_disciplines
  for all to authenticated using (true) with check (true);

-- Team members carry the same scoping. `project_contacts` already mirrors the
-- five responsibility roles; team rows live alongside them and are told apart
-- by `role`, so the two sets can be replaced independently.
alter table public.project_contacts
  add column department_id uuid references public.departments(id) on delete set null,
  add column system_id uuid references public.systems(id) on delete set null,
  add column discipline_id uuid references public.disciplines(id) on delete set null;

-- The old key allowed one row per (project, contact, role); a team member may
-- appear once per discipline, so the discipline has to be part of the key.
alter table public.project_contacts
  drop constraint project_contacts_project_id_contact_id_role_key;
alter table public.project_contacts
  add constraint project_contacts_unique_scope
    unique nulls not distinct (project_id, contact_id, role, discipline_id);

create index idx_project_contacts_project_id
  on public.project_contacts(project_id);
create index idx_project_contacts_department_id
  on public.project_contacts(department_id);
create index idx_project_contacts_discipline_id
  on public.project_contacts(discipline_id);

comment on table public.project_disciplines is
  'Disciplines in a project scope, linked to their department and system.';
comment on column public.project_contacts.role is
  'Responsibility role name, or ''team_member'' for wizard-added team rows.';
