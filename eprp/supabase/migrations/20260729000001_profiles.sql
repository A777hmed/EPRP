-- EPRP Phase A1 — profiles and the role foundation.
--
-- Credentials live in Supabase's managed `auth.users`. Application identity
-- (display name, role, active flag) lives here, one row per account.
--
-- `public.contacts` is deliberately NOT reused: it is the project people
-- directory (master data that Project Control edits freely), not a list of
-- accounts. `profiles.contact_id` optionally links an account to its
-- directory entry without merging the two concepts.
--
-- This migration does NOT relax any existing policy. Every table keeps its
-- `for all to authenticated` policy, so anonymous writes stay rejected — the
-- application starts succeeding only once a user actually signs in.
--
-- Public sign-up must be disabled in the Supabase dashboard
-- (Authentication → Providers → Email → "Enable signups" off). Accounts are
-- created by the System Administrator.

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text not null,
  role       text not null default 'viewer',
  -- Optional link to the project people directory.
  contact_id uuid references public.contacts(id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_full_name_not_blank
    check (length(btrim(full_name)) > 0),
  constraint profiles_role_valid
    check (
      role in (
        'system_admin',
        'project_control_admin',
        'project_manager',
        'department_lead',
        'department_user',
        'reviewer',
        'approver',
        'executive',
        'viewer'
      )
    )
);

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create index idx_profiles_role on public.profiles(role);
create index idx_profiles_contact_id on public.profiles(contact_id);
create unique index profiles_email_unique on public.profiles(lower(email));

/* ------------------------------ Role helper ------------------------------- */

-- SECURITY DEFINER so a policy can read the caller's role without needing a
-- select policy on `profiles` — that would recurse. `search_path` is pinned
-- because definer functions run with the owner's privileges.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

comment on function public.current_user_role() is
  'Role of the calling user, or null when unauthenticated. For use in RLS policies without recursing through profiles.';

revoke execute on function public.current_user_role() from anon;
grant execute on function public.current_user_role() to authenticated;

/* ---------------------------------- RLS ----------------------------------- */

alter table public.profiles enable row level security;

-- A signed-in user may read their own profile. Nothing here grants anon
-- access, and no other table's policy is touched.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- The System Administrator manages every account. Splitting this from the
-- self-select policy keeps "read yourself" working even before any admin
-- exists, which matters for the very first sign-in.
create policy profiles_admin_select_all on public.profiles
  for select to authenticated
  using (public.current_user_role() = 'system_admin');

create policy profiles_admin_insert on public.profiles
  for insert to authenticated
  with check (public.current_user_role() = 'system_admin');

create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.current_user_role() = 'system_admin')
  with check (public.current_user_role() = 'system_admin');

-- Deliberately no delete policy: accounts are deactivated via `active`,
-- matching the archive-never-delete rule for referenced records.

/* -------------------------------- Comments -------------------------------- */

comment on table public.profiles is
  'Application identity for a Supabase auth user: display name, role, active flag. One row per account.';
comment on column public.profiles.role is
  'One of the nine EPRP roles. Kept in step with UserRole in src/types/admin.ts.';
comment on column public.profiles.contact_id is
  'Optional link to the project people directory. Not a merge of the two concepts.';
comment on column public.profiles.active is
  'False deactivates the account in the application. Credentials are managed separately in auth.users.';
