-- EPRP P0 validation — local-only test identities.
--
-- ############################################################################
-- ##  LOCAL DEVELOPMENT DATABASE ONLY.                                      ##
-- ##  Never run this against a hosted Supabase project.                     ##
-- ##  It writes directly into auth.users, which is Supabase-managed.        ##
-- ############################################################################
--
-- WHY THIS EXISTS
--   01_setup_test_fixtures.sql creates a `profiles` row, and profiles.id has a
--   foreign key onto auth.users(id). So a profile cannot exist without an auth
--   user, and on a freshly reset local database there are none.
--
--   On a hosted project you would create these through the dashboard, because
--   only the Auth service can hash a password and write the matching
--   auth.identities row correctly. Here that does not matter: the P0 validation
--   scripts never sign in. They impersonate by setting request.jwt.claims and
--   the `authenticated` role, which is exactly what PostgREST does for a signed
--   in caller. These rows exist to satisfy the foreign key and to be pointed at
--   by a JWT `sub` claim — nothing more.
--
--   The passwords written here are deliberately unusable.
--
-- WHAT IT CREATES
--   ZZ-P0TEST admin   — an active system_admin. Several migrations refuse to
--                       tighten access unless one exists, and the P0 matrices
--                       need an administrator to contrast against.
--   ZZ-P0TEST viewer  — the SECOND, NON-ADMIN identity. This is the account the
--                       negative permission paths are proved with, and the one
--                       01_setup_test_fixtures.sql links to its Coordinator
--                       contact.
--
--   Both use fixed UUIDs so every later script can refer to them without
--   copying an id by hand.
--
-- HOW TO RUN
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f 00_local_test_identity.sql
--
--   That connection string is the Supabase CLI's standard LOCAL one. If yours
--   differs, take it from `supabase status`. It must be 127.0.0.1.

-- ALSO: the platform table grants.
--
--   The migration set contains NO table GRANT statements. On a hosted project
--   that does not matter — the Supabase platform grants DML on public tables to
--   anon/authenticated/service_role, and Row Level Security is what actually
--   restricts access. A locally reset database does NOT get that step, so
--   `authenticated` ends up holding only Dxtm (TRUNCATE, REFERENCES, TRIGGER,
--   MAINTAIN) and every query fails with "permission denied for table …" before
--   any policy is consulted.
--
--   Granting them here makes local a faithful mirror of production. It does not
--   weaken anything: every policy in this schema is written `to authenticated`,
--   and RLS is enabled on every table, so the grant is the door and the policy
--   is the lock. Without the grant you are not testing the lock — you are
--   testing a missing door.
--
--   Recorded as a portability gap: a fresh environment built from migrations
--   alone is not usable until something performs this step.

\set ON_ERROR_STOP on

-- Refuse to run anywhere that is not a local database.
do $guard$
begin
  if current_setting('server_version_num')::int < 130000 then
    raise exception 'Unexpected server version.';
  end if;
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception
      'REFUSING TO RUN: this connection is not local (server address %). This script writes to auth.users and is for the local development stack only.',
      host(inet_server_addr());
  end if;
  raise notice 'Local database confirmed.';
end;
$guard$;

/* ------------------- Platform table grants (local mirror) ----------------- */

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

-- Anything created later in this session inherits the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;

begin;

-- Admin identity ------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-a000-0000000000a1',
  'authenticated', 'authenticated', 'p0test.admin@example.invalid',
  'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
)
on conflict (id) do nothing;

-- Second, NON-ADMIN identity -------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-a000-0000000000b2',
  'authenticated', 'authenticated', 'p0test@example.invalid',
  'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
)
on conflict (id) do nothing;

-- The admin PROFILE. Created here rather than in 01 because several migrations
-- check for it, and because the admin is environment setup, not test data.
insert into public.profiles (id, email, full_name, role, active)
values (
  '00000000-0000-4000-a000-0000000000a1',
  'p0test.admin@example.invalid',
  'ZZ-P0TEST Administrator',
  'system_admin',
  true
)
on conflict (id) do nothing;

commit;

do $report$
declare u integer; p integer;
begin
  select count(*) into u from auth.users
   where id in ('00000000-0000-4000-a000-0000000000a1',
                '00000000-0000-4000-a000-0000000000b2');
  select count(*) into p from public.profiles where role = 'system_admin' and active;

  if u <> 2 then
    raise exception 'Expected 2 test identities, found %.', u;
  end if;

  raise notice 'Local test identities ready: 2 auth users, % active system_admin profile(s).', p;
  raise notice '  admin  : 00000000-0000-4000-a000-0000000000a1';
  raise notice '  viewer : 00000000-0000-4000-a000-0000000000b2   <- pass this as test_user_id to 01_setup_test_fixtures.sql';
end;
$report$;
