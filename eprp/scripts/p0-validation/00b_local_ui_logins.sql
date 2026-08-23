-- EPRP — local UI rehearsal logins.
--
-- ############################################################################
-- ##  LOCAL DEVELOPMENT DATABASE ONLY.                                      ##
-- ##  Never run this against a hosted Supabase project.                     ##
-- ##  It writes directly into auth.users and sets a KNOWN, SHARED password. ##
-- ############################################################################
--
-- WHY THIS EXISTS
--   00_local_test_identity.sql creates two identities whose passwords are
--   deliberately unusable — the validation scripts never sign in, they
--   impersonate by setting request.jwt.claims. That is correct for those
--   scripts and useless for a HUMAN UI pass, which has to actually log in.
--
--   This file provisions sign-in-able logins for the two roles the Master
--   Milestones pass needs to tell apart, bound to contacts that ALREADY hold
--   those assignments on PSAIM-001 in the seed data. No assignment is invented.
--
-- WHO GETS WHAT, AND WHY IT IS SHAPED THIS WAY
--   Khaled Fahmy  — the project's Project Control Manager  -> MAY reconcile
--   Nour Adel     — the project's Reporting Coordinator    -> MAY NOT reconcile
--
--   Both are given the LOW platform role `viewer` on purpose. Project Control
--   authority is a PROJECT ASSIGNMENT, not a platform role (architecture
--   §24.3), so a privileged platform role would mask the very distinction the
--   pass exists to check. If Khaled can reconcile and Nour cannot while both
--   are `viewer`, the assignment is doing the work.
--
--   There is deliberately NO project_control_admin login here. That role is
--   portfolio-wide and would pass everywhere, which tells you nothing about
--   whether the per-project rule holds.
--
-- THE PASSWORD IS A THROWAWAY AND IS MEANT TO BE PUBLIC:
--       LocalRehearsal2026!
--   It is hashed with bcrypt via pgcrypto, which is what GoTrue verifies
--   against. It grants access to a Docker Postgres bound to 127.0.0.1 holding
--   nothing but seed data, and it is destroyed by the next `supabase db reset`.
--   No production credential appears anywhere in this repository.
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 00b_local_ui_logins.sql

\set ON_ERROR_STOP on

-- Refuse to run anywhere that is not a local database.
do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception
      'REFUSING TO RUN: this connection is not local (server address %). This script writes to auth.users and sets a known password.',
      host(inet_server_addr());
  end if;
end;
$guard$;

begin;

/*
 * One login, bound to an existing seeded contact.
 *
 * Idempotent: re-running resets the password rather than failing, so the script
 * can be re-applied after a partial run without hand-cleaning anything.
 */
create or replace function pg_temp.make_login(
  p_user_id uuid,
  p_contact_email text,
  p_password text
) returns void
language plpgsql
as $fn$
declare
  v_contact_id uuid;
  v_name text;
begin
  select id, name into v_contact_id, v_name
    from public.contacts where email = p_contact_email;
  if v_contact_id is null then
    raise exception 'No seeded contact with email %. Has the seed changed?',
      p_contact_email;
  end if;

  /*
   * The four empty strings at the end are not decoration.
   *
   * confirmation_token, recovery_token, email_change_token_new and email_change
   * are nullable in the schema and have NO default, but GoTrue scans them into
   * non-nullable Go strings. Leave them NULL and every sign-in fails with a
   * misleading "Database error querying schema" — the password and the identity
   * row are both fine, and the query that reads the user blows up before it
   * gets to them. Writing '' is what the Auth service itself does.
   */
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    p_user_id,
    'authenticated', 'authenticated', p_contact_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_name),
    now(), now(),
    '', '', '', ''
  )
  on conflict (id) do update
    set encrypted_password     = excluded.encrypted_password,
        email_confirmed_at     = excluded.email_confirmed_at,
        confirmation_token     = '',
        recovery_token         = '',
        email_change_token_new = '',
        email_change           = '';

  -- GoTrue resolves an email sign-in through auth.identities, not auth.users
  -- alone. Without this row the password is correct and the login still fails.
  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, created_at, updated_at
  )
  values (
    gen_random_uuid(), p_user_id::text, p_user_id,
    jsonb_build_object('sub', p_user_id::text, 'email', p_contact_email,
                       'email_verified', true),
    'email', now(), now()
  )
  on conflict (provider, provider_id) do nothing;

  -- The platform profile. `viewer` deliberately — see the header.
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  values (p_user_id, p_contact_email, v_name, 'viewer', v_contact_id, true)
  on conflict (id) do update
    set contact_id = excluded.contact_id,
        role       = excluded.role,
        active     = excluded.active;
end;
$fn$;

-- Project Control Manager on PSAIM-001. MAY reconcile.
select pg_temp.make_login(
  '00000000-0000-4000-a000-00000000c001',
  'k.fahmy@eprom.com.eg',
  'LocalRehearsal2026!'
);

-- Reporting Coordinator on PSAIM-001. MAY NOT reconcile.
select pg_temp.make_login(
  '00000000-0000-4000-a000-00000000c002',
  'n.adel@eprom.com.eg',
  'LocalRehearsal2026!'
);

commit;

/* ------------------------------ report ---------------------------------- */

do $report$
declare r record;
begin
  raise notice 'Local UI rehearsal logins ready (password: LocalRehearsal2026!)';
  for r in
    select p.email,
           p.full_name,
           p.role as platform_role,
           coalesce(pc.role, '(none)') as project_role,
           public.can_reconcile_milestone(pr.id) as would_reconcile
      from public.profiles p
      join public.contacts c on c.id = p.contact_id
      cross join (select id from public.projects where code = 'PSAIM-001') pr
      left join public.project_contacts pc
        on pc.project_id = pr.id and pc.contact_id = c.id
     where p.email in ('k.fahmy@eprom.com.eg', 'n.adel@eprom.com.eg')
     order by p.email
  loop
    raise notice '  % | platform=% | project=% ', r.email, r.platform_role, r.project_role;
  end loop;
end;
$report$;
