-- ============================================================================
-- Executive Reports — baseline DML privileges (prerequisite, additive only)
-- ============================================================================
--
-- Why this exists
--   `20260812000004_executive_reports.sql` created this table with RLS
--   policies only (executive_reports_insert/_update/_delete, all gated by
--   executive_can_manage()) and never issued an explicit GRANT. On every
--   environment where these migrations were first applied, `authenticated`
--   already held baseline table privileges from that project's own bootstrap,
--   so the omission was never visible. A from-scratch project has no such
--   bootstrap state: RLS alone cannot authorize anything until the role also
--   holds the underlying table-level privilege, so INSERT/UPDATE/DELETE are
--   unenforceable and `20260926000001_executive_summary_visibility.sql`'s own
--   post-check ("authenticated lost UPDATE on executive_summary") fails
--   immediately after it, before ever reaching the auth.users trigger
--   migration two files later. This migration restates that missing baseline
--   explicitly so a clean replay behaves the same as every already-provisioned
--   environment.
--
-- Why SELECT is deliberately excluded — this is the load-bearing decision
--   PostgreSQL privileges are strictly additive: nothing here could ever
--   narrow a broader grant issued elsewhere, and nothing issued elsewhere can
--   narrow a broader grant issued here. `20260926000001` intentionally
--   replaces the table-wide SELECT with a column list that OMITS
--   `executive_summary`. If this file granted table-level (or even
--   column-list) SELECT, then on any environment where `20260926000001` has
--   ALREADY run — which is true of the existing local 91/91 database, since
--   this file's timestamp sorts BEFORE four migrations already applied there
--   — applying it later via `--include-all` would ADD BACK a SELECT grant on
--   top of the already-narrowed one, silently re-exposing
--   `executive_summary` to every authenticated user. Excluding SELECT
--   entirely makes this file provably inert with respect to read access,
--   regardless of the order in which any environment ever applies it.
--   Read access to executive_reports remains 20260926000001's sole
--   responsibility, unchanged.
--
-- RLS remains the authorization boundary
--   Granting insert/update/delete here only clears PostgreSQL's first gate —
--   does the role hold the privilege at all. It does not touch, weaken or
--   bypass the existing `using` / `with check` clauses on
--   executive_reports_insert / _update / _delete (both reference
--   executive_can_manage(), untouched by this file). An authenticated user
--   who does not satisfy executive_can_manage() is still refused by RLS after
--   this migration, exactly as before. This mirrors the same additive-grant
--   pattern already used for other tables in this codebase
--   (20260822000002_p1a_project_setup_write_authority.sql,
--   20260926000002_project_setup_atomic_save.sql).
--
-- Idempotency
--   GRANT in PostgreSQL is idempotent: re-granting a privilege a role already
--   holds is a harmless no-op. Safe to apply on any environment regardless of
--   whether it already has this privilege from bootstrap defaults.
-- ============================================================================

grant insert, update, delete on public.executive_reports to authenticated;

/* -------------------------- Post-condition check --------------------------- */

do $$
begin
  if not has_table_privilege('authenticated', 'public.executive_reports', 'INSERT') then
    raise exception 'Post-check failed: authenticated missing INSERT on executive_reports.';
  end if;
  if not has_table_privilege('authenticated', 'public.executive_reports', 'UPDATE') then
    raise exception 'Post-check failed: authenticated missing UPDATE on executive_reports.';
  end if;
  if not has_table_privilege('authenticated', 'public.executive_reports', 'DELETE') then
    raise exception 'Post-check failed: authenticated missing DELETE on executive_reports.';
  end if;

  raise notice 'executive_reports baseline write privileges (insert/update/delete only) confirmed for authenticated. SELECT is untouched by this migration and remains governed solely by 20260926000001.';
end;
$$;
