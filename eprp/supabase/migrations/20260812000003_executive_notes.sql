-- EPRP Phase 10 — Executive-authored notes.
--
-- WHY A NEW TABLE
--   Neither existing comment table can hold an Executive note:
--
--   * `weekly_entries.weekly_report_id` and `monthly_comments.monthly_report_id`
--     are NOT NULL. A portfolio-level note belongs to no report, so no id
--     exists to satisfy either foreign key.
--   * `monthly_comments` rows are rendered inside the Monthly Report document
--     and are compiled by the Monthly engine. Writing Executive notes there
--     would silently change an approved Monthly's content, which Law 4 forbids,
--     and would feed Executive text back into Monthly compilation through
--     `source_weekly_entry_id`.
--
--   This table is therefore ADDITIVE and self-contained. It changes no existing
--   table, no existing policy, no existing function and no existing row. The
--   Weekly and Monthly engines cannot see it, so compilation and the
--   Weekly→Monthly dedupe are untouched.
--
-- OWNERSHIP
--   `project_id` NULL means the note is about the portfolio as a whole.
--   A non-NULL `project_id` scopes it to one project. `on delete restrict`
--   deliberately refuses to delete a project that still carries Executive
--   notes, rather than destroying commentary as a side effect — the platform
--   archives projects, it does not delete them.
--
-- ATTRIBUTION
--   `created_by` links to `profiles`, and `created_by_name` snapshots the name
--   at authorship. The snapshot is not redundant: `profiles` RLS restricts a
--   user to their OWN row, so without it no reader could resolve another
--   author's name. Author identity is immutable once written.

create table public.executive_notes (
  id uuid primary key default gen_random_uuid(),
  -- NULL = portfolio-level note.
  project_id uuid references public.projects(id) on delete restrict,
  category text not null default 'executive_comment',
  priority text not null default 'medium',
  body text not null,
  include_in_summary boolean not null default true,
  include_in_print boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint executive_notes_body_not_blank
    check (length(btrim(body)) > 0),
  constraint executive_notes_category_valid
    check (category in (
      'executive_comment',
      'management_direction',
      'decision',
      'risk_concern',
      'follow_up'
    )),
  constraint executive_notes_priority_valid
    check (priority in ('low', 'medium', 'high', 'critical'))
);

create trigger set_updated_at
  before update on public.executive_notes
  for each row execute function public.set_updated_at();

comment on table public.executive_notes is
  'Executive-authored commentary. Additive and self-contained: never read or written by the Weekly or Monthly engines, so it cannot affect Monthly compilation or the Weekly-to-Monthly dedupe.';
comment on column public.executive_notes.project_id is
  'NULL means the note applies to the portfolio as a whole rather than to one project.';
comment on column public.executive_notes.created_by_name is
  'Author name snapshotted at creation. profiles RLS restricts a reader to their own row, so this is the only way another reader can resolve authorship.';

/* ------------------------------- Authorship -------------------------------- */

create or replace function public.set_executive_note_authorship()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  select full_name into actor_name from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_by_name := coalesce(new.created_by_name, actor_name);
    new.updated_by := new.created_by;
    new.updated_by_name := new.created_by_name;
  else
    -- Authorship is immutable; an edit changes content and records the editor,
    -- never who wrote it originally.
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.updated_by := coalesce(auth.uid(), old.updated_by);
    new.updated_by_name := coalesce(actor_name, old.updated_by_name);
  end if;
  return new;
end;
$$;

create trigger executive_notes_authorship
  before insert or update on public.executive_notes
  for each row execute function public.set_executive_note_authorship();

/* ------------------------------ Authorization ------------------------------ */

-- Mirrors the application gate in `features/executive-reports/executive-access.ts`:
-- the roles holding Executive-report permissions, and nobody else.
create or replace function public.executive_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_system_admin()
      or public.current_user_role() in ('project_control_admin', 'executive');
$$;

comment on function public.executive_can_manage() is
  'True for the roles permitted to author Executive content: System Administrator, Project Control Admin, Executive. Mirrors ROLE_PERMISSIONS in config/permissions.ts.';

create index idx_executive_notes_project on public.executive_notes(project_id, created_at desc);
create index idx_executive_notes_portfolio on public.executive_notes(created_at desc) where project_id is null;

alter table public.executive_notes enable row level security;

-- Read: a portfolio note is visible to any authenticated reader of the
-- Executive module; a project note follows that project's access rule, which is
-- the same predicate Weekly and Monthly already use.
create policy executive_notes_select on public.executive_notes
  for select to authenticated
  using (
    project_id is null
    or public.weekly_can_access_project(project_id)
  );

-- Write: Executive authorship only. Department accounts cannot reach this table
-- at all, whatever the UI offers them.
create policy executive_notes_insert on public.executive_notes
  for insert to authenticated
  with check (public.executive_can_manage());

create policy executive_notes_update on public.executive_notes
  for update to authenticated
  using (public.executive_can_manage())
  with check (public.executive_can_manage());

create policy executive_notes_delete on public.executive_notes
  for delete to authenticated
  using (public.executive_can_manage());

/* -------------------------- Post-condition check --------------------------- */

do $$
declare open_policies integer;
begin
  select count(*) into open_policies
    from pg_policies
   where schemaname = 'public'
     and tablename = 'executive_notes'
     and (qual = 'true' or with_check = 'true');

  if open_policies > 0 then
    raise exception 'Post-check failed: % blanket policy/policies on executive_notes.', open_policies;
  end if;

  raise notice 'executive_notes created with scoped RLS; no blanket policies.';
end;
$$;
