-- EPRP — project contact assignment structure + weekly delegation.
--
-- Extends the EXISTING project_contacts link (no parallel architecture):
--   * assignment_role         — Department Manager / Team Member Lead / Team
--                               Member, per project. Not a job title and not a
--                               platform permission role.
--   * functional_title        — free-text project responsibility ("RBI Lead",
--                               "Element 10 Owner"). Display only; a title
--                               containing "Lead" grants nothing.
--   * reports_to_contact_id   — who this member reports to on this project.
--                               Same-project/-department eligibility is
--                               enforced by the application layer that writes
--                               these rows.
--
-- Adds project_delegations: a Department Manager temporarily hands selected
-- Weekly responsibilities to someone in the same project department. The
-- primary manager row is untouched; expiry is derived from end_date at read
-- time (never a scheduled job), and created_by/created_at follow the
-- position_assignment_history audit precedent.
--
-- Additive only: no applied migration edited, no column renamed or dropped,
-- no existing row rewritten, no RLS beyond the standing temporary
-- `for all to authenticated` pattern every table carries.

/* --------------------------- project_contacts ----------------------------- */

alter table public.project_contacts
  add column if not exists assignment_role text,
  add column if not exists functional_title text,
  add column if not exists reports_to_contact_id uuid
    references public.contacts(id) on delete set null;

alter table public.project_contacts
  add constraint project_contacts_assignment_role_valid
  check (
    assignment_role is null
    or assignment_role in ('department_manager', 'team_member_lead', 'team_member')
  );

create index if not exists idx_project_contacts_reports_to
  on public.project_contacts(reports_to_contact_id);

comment on column public.project_contacts.assignment_role is
  'Project-specific team role (department_manager / team_member_lead / team_member). Not a job title, not a permission.';
comment on column public.project_contacts.functional_title is
  'Free-text functional responsibility for this project assignment only. Grants no permissions.';
comment on column public.project_contacts.reports_to_contact_id is
  'Manager or lead this member reports to, within the same project and department.';

/* --------------------------- project_delegations -------------------------- */

create table public.project_delegations (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  department_id       uuid not null references public.departments(id) on delete restrict,
  delegate_contact_id uuid not null references public.contacts(id) on delete restrict,
  -- Selected responsibility keys, e.g. ["review_submissions"].
  responsibilities    jsonb not null default '[]'::jsonb,
  start_date          date not null default current_date,
  end_date            date not null,
  note                text,
  -- False once revoked. Expiry is end_date-derived, never flag-driven.
  active              boolean not null default true,
  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint project_delegations_period_valid check (end_date >= start_date)
);

create trigger set_updated_at before update on public.project_delegations
  for each row execute function public.set_updated_at();

create index idx_project_delegations_project_id
  on public.project_delegations(project_id);
create index idx_project_delegations_department_id
  on public.project_delegations(department_id);

alter table public.project_delegations enable row level security;

-- The same temporary policy every table carries until Phase 7 RBAC.
create policy project_delegations_authenticated_all on public.project_delegations
  for all to authenticated using (true) with check (true);

comment on table public.project_delegations is
  'Temporary hand-over of selected Weekly responsibilities within one project department. The primary Department Manager assignment is never modified by a delegation.';
