# Supabase (Phase 5C — Foundation)

This directory holds the database foundation. The app runs on **mock data by
default** and switches to Supabase automatically once the public env vars are
set — no page or form changes required (gradual migration).

## Structure

- `config.toml` — local Supabase CLI configuration
- `migrations/20260719000001_schema.sql` — tables, keys, indexes, `updated_at` triggers
- `migrations/20260719000002_rls.sql` — RLS enabled + temporary authenticated Admin CRUD policies
- `seed.sql` — master data + representative projects (mirrors the mock data)

## First-time setup

1. Create a project at [supabase.com](https://supabase.com) (or run locally).
2. Copy `../.env.example` to `../.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — never exposed to the browser)

## Run migrations + seed

**Local stack** (requires Docker Desktop):

```bash
supabase start          # boots Postgres + Studio locally
supabase db reset       # applies all migrations, then seed.sql
```

**Linked hosted project:**

```bash
supabase link --project-ref <your-ref>
supabase db push        # applies migrations
psql "$DATABASE_URL" -f supabase/seed.sql   # or run seed via the SQL editor
```

## Regenerate typed models

```bash
supabase gen types typescript --local > src/lib/supabase/database.types.ts
```

## Notes

- **RLS**: enabled on all 10 tables. The temporary policies grant
  `authenticated` users full CRUD (the "Admin" role until real auth + RBAC
  land). Anonymous access is denied — so browser CRUD requires a signed-in
  session, which arrives in a later phase. The service-role key bypasses RLS
  and is server-only.
- **Safe delete**: enforced at the DB level via `ON DELETE RESTRICT` on
  referencing foreign keys, and surfaced in the UI by each service's
  `canDelete` reference check.
