-- EPRP Phase 2C.1 — Project Category PSM/PSAIM name-code consistency audit.
--
-- 100% READ-ONLY. Every statement is a SELECT, inside a READ ONLY transaction
-- that ends in ROLLBACK. There is no INSERT, UPDATE, DELETE, CREATE, DROP,
-- ALTER or GRANT anywhere in this file. Safe to run repeatedly.
--
-- Confirmed target project ref: cwvtoenftdqgkikjqfjd
--
-- Tolerates a database without migration 20261001000001: allows_custom_name
-- and structure_family are read through to_jsonb(), so a missing column shows
-- as NULL instead of failing the query.
--
-- HOW TO RUN (from eprp/, PowerShell; psql prompts for the password):
--   docker run --rm -it -v "${PWD}\scripts\p0-validation:/audit:ro" postgres:17 \
--     psql "postgresql://postgres.cwvtoenftdqgkikjqfjd@aws-1-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=require" \
--     -v ON_ERROR_STOP=1 -f /audit/109_audit_project_category_psm_consistency.sql

\set ON_ERROR_STOP on
\pset pager off

\echo ==================================================================
\echo  EPRP - Project Category PSM/PSAIM consistency audit (READ-ONLY)
\echo  Expected project ref: cwvtoenftdqgkikjqfjd
\echo  TARGET CONNECTION:
\echo ==================================================================
\conninfo

-- Safety gate 1: the connection user must carry the confirmed project ref.
select (:'USER' = 'postgres.cwvtoenftdqgkikjqfjd') as ref_ok \gset
\if :ref_ok
\else
  \echo ABORTED - connection user is not postgres.cwvtoenftdqgkikjqfjd. Nothing was run.
  \quit
\endif

-- Safety gate 2: explicit operator confirmation.
\prompt 'Type AUDIT to run the read-only audit against the target above: ' go
select (:'go' = 'AUDIT') as proceed \gset
\if :proceed
\else
  \echo ABORTED - confirmation not given. Nothing was run.
  \quit
\endif

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

\echo === 0. Session identity ===
select current_database()                        as database,
       current_user                              as role,
       current_setting('transaction_read_only')  as read_only,
       current_setting('server_version')         as server_version,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'projects'
           and column_name = 'structure_family') = 1 as classification_migration_present;

\echo === 1A. Reserved name (PSM / PSAIM / Process Safety) with a nonblank non-PSM code (expect 0 rows) ===
with pt as (
  select t.id, t.name, t.code, t.active,
         to_jsonb(t) ->> 'allows_custom_name' as allows_custom_name,
         nullif(btrim(coalesce(t.code, '')), '') is not null as code_nonblank,
         coalesce(btrim(t.code) ~* '^(PSM|PSAIM)\y', false) as code_psm,
         (coalesce(t.name, '') ~* '\y(PSM|PSAIM)\y'
          or coalesce(t.name, '') ~* 'process\s+safety') as name_reserved
    from public.project_types t
)
select 'A: reserved name, non-PSM code' as mismatch,
       f.id   as project_type_id,
       f.name,
       f.code,
       f.active,
       f.allows_custom_name,
       count(p.id) as referencing_projects,
       array_agg(p.id   order by p.code) filter (where p.id is not null) as project_ids,
       array_agg(p.code order by p.code) filter (where p.id is not null) as project_codes,
       array_agg(p.name order by p.code) filter (where p.id is not null) as project_names,
       array_agg(coalesce(to_jsonb(p) ->> 'structure_family', '(null)') order by p.code)
         filter (where p.id is not null) as project_structure_families
  from pt f
  left join public.projects p on p.project_type_id = f.id
 where f.name_reserved and f.code_nonblank and not f.code_psm
 group by f.id, f.name, f.code, f.active, f.allows_custom_name
 order by f.name, f.code;

\echo === 1B. PSM/PSAIM-family code with a name that does not look PSM / PSAIM / Process Safety (expect 0 rows) ===
with pt as (
  select t.id, t.name, t.code, t.active,
         to_jsonb(t) ->> 'allows_custom_name' as allows_custom_name,
         nullif(btrim(coalesce(t.code, '')), '') is not null as code_nonblank,
         coalesce(btrim(t.code) ~* '^(PSM|PSAIM)\y', false) as code_psm,
         (coalesce(t.name, '') ~* '\y(PSM|PSAIM)\y'
          or coalesce(t.name, '') ~* 'process\s+safety') as name_reserved
    from public.project_types t
)
select 'B: PSM/PSAIM code, unrelated name' as mismatch,
       f.id   as project_type_id,
       f.name,
       f.code,
       f.active,
       f.allows_custom_name,
       count(p.id) as referencing_projects,
       array_agg(p.id   order by p.code) filter (where p.id is not null) as project_ids,
       array_agg(p.code order by p.code) filter (where p.id is not null) as project_codes,
       array_agg(p.name order by p.code) filter (where p.id is not null) as project_names,
       array_agg(coalesce(to_jsonb(p) ->> 'structure_family', '(null)') order by p.code)
         filter (where p.id is not null) as project_structure_families
  from pt f
  left join public.projects p on p.project_type_id = f.id
 where f.code_psm and not f.name_reserved
 group by f.id, f.name, f.code, f.active, f.allows_custom_name
 order by f.name, f.code;

\echo === 2. Summary ===
with pt as (
  select t.id,
         nullif(btrim(coalesce(t.code, '')), '') is not null as code_nonblank,
         coalesce(btrim(t.code) ~* '^(PSM|PSAIM)\y', false) as code_psm,
         (coalesce(t.name, '') ~* '\y(PSM|PSAIM)\y'
          or coalesce(t.name, '') ~* 'process\s+safety') as name_reserved
    from public.project_types t
), flagged as (
  select pt.*,
         (name_reserved and code_nonblank and not code_psm) as mismatch_a,
         (code_psm and not name_reserved)                   as mismatch_b
    from pt
)
select (select count(*) from flagged)                         as total_project_types,
       (select count(*) from flagged where mismatch_a)        as mismatch_a_count,
       (select count(*) from flagged where mismatch_b)        as mismatch_b_count,
       (select count(*) from flagged where not code_nonblank) as blank_code_rows,
       (select count(distinct p.id)
          from public.projects p
          join flagged f on f.id = p.project_type_id
         where f.mismatch_a or f.mismatch_b)                  as projects_on_mismatched_categories;

ROLLBACK;
\echo === Audit finished. Transaction rolled back; nothing was written. ===
