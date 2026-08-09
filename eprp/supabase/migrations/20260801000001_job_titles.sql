-- EPRP Collaboration Phase C1 — job titles as master data.
--
-- Job titles are currently free text in `contacts.position`, which makes them
-- unmanageable: no archive, no rename-in-one-place, no consistency. This
-- migration makes them an admin-managed master-data kind following the same
-- shape as clients / project_types / departments (name, code, description,
-- active, archived_at, timestamps + set_updated_at trigger).
--
-- A job title describes what a person is CALLED. It is deliberately not a
-- permission: see docs/07_COLLABORATION_AND_APPROVALS.md §3.2. Nothing here
-- grants or checks any access.
--
-- Additive only:
--   * no applied migration is edited
--   * `contacts.position` is KEPT and unchanged — no data migration, nothing
--     to break, and no decision forced about backfilling it yet
--   * `contacts.job_title_id` is nullable, so every existing contact stays
--     valid without being touched
--   * RLS uses the same temporary `for all to authenticated` pattern every
--     other table already carries. No existing policy is modified, and no
--     scoped policy is introduced (that is a later, separately approved step).

/* ------------------------------- job_titles ------------------------------- */

create table public.job_titles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  description text,
  active      boolean not null default true,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint job_titles_name_not_blank check (length(btrim(name)) > 0),
  constraint job_titles_code_not_blank check (code is null or length(btrim(code)) > 0)
);

-- Case-insensitive uniqueness, matching what the application already enforces:
-- `assertNoDuplicate` in features/master-data/services.ts compares lowercased
-- values, so "Project Manager" and "project manager" are one title. A plain
-- `unique` would let the database accept a pair the mock service rejects.
-- Codes are optional; a partial index leaves NULL codes unconstrained.
create unique index job_titles_name_unique
  on public.job_titles (lower(btrim(name)));

create unique index job_titles_code_unique
  on public.job_titles (lower(btrim(code)))
  where code is not null;

create index idx_job_titles_active on public.job_titles(active);

create trigger set_updated_at before update on public.job_titles
  for each row execute function public.set_updated_at();

/* --------------------------- contacts.job_title_id ------------------------ */

-- `on delete set null` matches contacts.department_id. Deleting a title is
-- already blocked while it is referenced (the service's canDelete check), so
-- this only covers the archive-then-delete-when-unused path.
alter table public.contacts
  add column if not exists job_title_id uuid
    references public.job_titles(id) on delete set null;

create index idx_contacts_job_title_id on public.contacts(job_title_id);

/* ----------------------------------- RLS ---------------------------------- */

alter table public.job_titles enable row level security;

-- The same temporary policy every other table carries. Replacing these with
-- per-role rules is a separate approved step and is NOT done here.
create policy job_titles_authenticated_all on public.job_titles
  for all to authenticated using (true) with check (true);

/* -------------------------------- Comments -------------------------------- */

comment on table public.job_titles is
  'Admin-managed job titles (Collaboration Phase C1). A display label only — never a permission. See docs/07_COLLABORATION_AND_APPROVALS.md §3.1-3.2.';
comment on column public.job_titles.code is
  'Optional short code. Unique (case-insensitive) when supplied.';
comment on column public.job_titles.active is
  'False = archived. Archived titles stay readable on existing contacts and are excluded from new selections.';
comment on column public.contacts.job_title_id is
  'Optional managed job title. The free-text contacts.position is retained alongside it and is unchanged by Phase C1.';
