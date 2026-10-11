-- EPRP Phase 2C.3C — Project Team Membership: post-migration verification.
--
-- 100% READ-ONLY. Every statement is a SELECT inside a READ ONLY transaction
-- that ends in ROLLBACK. Run AFTER 20261007150000_project_team_membership.sql.
--
-- Proves the stored backfill IS the approved Preflight V2 dataset: the
-- proposal is recomputed with the exact same CTE as
-- 112_preflight_project_team_membership.sql and compared row by row with the
-- legacy (created_by IS NULL) memberships, then the approved totals, the
-- one-active-membership rule and the authority-free invariant are checked.
--
-- HOW TO RUN (local development stack only, from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -v confirm=VERIFY \
--     -f - < scripts/p0-validation/113_verify_project_team_membership.sql

\set ON_ERROR_STOP on
\pset pager off

\if :{?confirm}
\else
  \echo ABORTED - pass -v confirm=VERIFY to run this read-only verification. Nothing was run.
  \quit
\endif
select (:'confirm' = 'VERIFY') as proceed \gset
\if :proceed
\else
  \echo ABORTED - confirm must be VERIFY. Nothing was run.
  \quit
\endif

begin transaction read only;

-- Identical CTE to the approved Preflight V2 (copied verbatim, single line).
\set PROPOSAL 'with _fixed as (select p.id as project_id, f.role, f.contact_id from public.projects p cross join lateral (values (''project_manager'', p.project_manager_id), (''project_control_manager'', p.project_control_manager_id), (''client_representative'', p.client_representative_id), (''reporting_coordinator'', p.reporting_coordinator_id), (''project_sponsor'', p.project_sponsor_id)) as f(role, contact_id) where f.contact_id is not null), _pc as (select pc.id, pc.project_id, pc.contact_id, pc.role, pc.assignment_role, pc.department_id, case when pc.role in (''project_manager'', ''project_control_manager'', ''client_representative'', ''reporting_coordinator'', ''project_sponsor'') then exists (select 1 from _fixed f where f.project_id = pc.project_id and f.role = pc.role and f.contact_id = pc.contact_id) else true end as counts from public.project_contacts pc), _participant_sources as (select project_id, contact_id, ''fixed:'' || role as source from _fixed union select pp.project_id, pp.contact_id, ''position:'' || coalesce(jt.name, ''(unknown title)'') from public.project_positions pp left join public.job_titles jt on jt.id = pp.job_title_id union select project_id, contact_id, ''project_contacts:'' || role || coalesce(''/'' || assignment_role, '''') || case when department_id is not null then ''/dept-scoped'' else '''' end from _pc where counts), _participants as (select s.project_id, s.contact_id, array_agg(distinct s.source order by s.source) as sources, bool_or(s.source in (''fixed:project_manager'', ''fixed:project_control_manager'', ''fixed:reporting_coordinator'')) as eprom_role, bool_or(s.source = ''fixed:client_representative'') as owner_role from _participant_sources s group by s.project_id, s.contact_id), _evidence as (select pr.*, nullif(btrim(c.organization), '''') as organization, pr.eprom_role and nullif(btrim(c.organization), '''') is not null and upper(btrim(c.organization)) <> ''EPROM'' as eprom_contradicted, pr.owner_role and nullif(btrim(c.organization), '''') is not null and upper(btrim(c.organization)) not in (upper(btrim(coalesce(cl.name, ''''))), upper(btrim(coalesce(cl.short_name, ''''))), upper(btrim(coalesce(cl.code, '''')))) as owner_contradicted from _participants pr join public.contacts c on c.id = pr.contact_id join public.projects p on p.id = pr.project_id left join public.clients cl on cl.id = p.client_id), _proposal as (select e.*, case when e.eprom_role and e.owner_role then null when e.eprom_role and not e.eprom_contradicted then ''EPROM'' when e.owner_role and not e.owner_contradicted then ''Owner'' else null end as proposed_party, case when e.eprom_role and e.owner_role then ''conflict: EPROM role and Client Representative'' when e.eprom_role and e.eprom_contradicted then ''downgraded: organization contradicts EPROM'' when e.owner_role and e.owner_contradicted then ''downgraded: organization contradicts Owner/client'' when e.eprom_role or e.owner_role then ''role-derived'' when ''fixed:project_sponsor'' = any (e.sources) then ''Project Sponsor is not assumed'' else ''no role-derived party'' end as party_reason from _evidence e) '

\echo
\echo ==================== 1. Migration recorded ====================
select exists (select 1 from supabase_migrations.schema_migrations
                where version = '20261007150000') as migration_recorded,
       to_regclass('public.project_members') is not null as table_present;

\echo
\echo ==================== 2. Backfilled memberships vs approved totals ====================
\echo approved: 46 memberships, 17 people, 12 projects, EPROM 30, Owner 7, Needs party 9, Needs project role 46
select count(*) as memberships,
       count(distinct m.contact_id) as people,
       count(distinct m.project_id) as projects,
       count(*) filter (where pp.kind = 'eprom') as eprom,
       count(*) filter (where pp.kind = 'owner') as owner,
       count(*) filter (where m.party_id is null) as needs_party,
       count(*) filter (where m.project_role is null) as needs_project_role,
       count(*) filter (where m.reports_to_member_id is not null) as reports_to_set,
       count(*) filter (where m.ended_at is not null) as ended,
       (count(*) = 46 and count(distinct m.contact_id) = 17 and count(distinct m.project_id) = 12
        and count(*) filter (where pp.kind = 'eprom') = 30
        and count(*) filter (where pp.kind = 'owner') = 7
        and count(*) filter (where m.party_id is null) = 9
        and count(*) filter (where m.project_role is null) = 46) as matches_approved_v2
  from public.project_members m
  left join public.project_parties pp on pp.id = m.party_id
 where m.created_by is null;

\echo
\echo ==================== 3. Row-by-row difference from the recomputed proposal (must be empty) ====================
:PROPOSAL
, stored as (
  select m.project_id, m.contact_id,
         case pp.kind when 'eprom' then 'EPROM' when 'owner' then 'Owner' end as party
    from public.project_members m
    left join public.project_parties pp on pp.id = m.party_id
   where m.created_by is null
), expected as (
  select project_id, contact_id, proposed_party as party from _proposal
)
select 'missing from table' as difference, p.code, c.name, e.party
  from (select * from expected except select * from stored) e
  join public.projects p on p.id = e.project_id
  join public.contacts c on c.id = e.contact_id
union all
select 'unexpected in table', p.code, c.name, s.party
  from (select * from stored except select * from expected) s
  join public.projects p on p.id = s.project_id
  join public.contacts c on c.id = s.contact_id;

\echo
\echo ==================== 4. Excluded and downgraded people ====================
select p.code, c.name,
       exists (select 1 from public.project_members m
                where m.project_id = p.id and m.contact_id = c.id) as has_membership,
       (select pp.kind from public.project_members m
          left join public.project_parties pp on pp.id = m.party_id
         where m.project_id = p.id and m.contact_id = c.id) as party_kind
  from public.projects p
  join public.contacts c on c.name in ('ZZ-P0TEST Coordinator', 'Mahmoud Rashed (Demo)', 'Dina Samir (Demo)')
 where (p.code = 'ZZ-P0TEST-PRJ' and c.name = 'ZZ-P0TEST Coordinator')
    or (p.code = 'ZZ-STRUCT-UI-01' and c.name in ('Mahmoud Rashed (Demo)', 'Dina Samir (Demo)'))
 order by p.code, c.name;

\echo
\echo ==================== 5. Invariants ====================
select (select count(*) from (select project_id, contact_id from public.project_members
                               where ended_at is null group by 1, 2 having count(*) > 1) d) as duplicate_active_memberships,
       (select count(*) from public.project_members m
          join public.project_parties pp on pp.id = m.party_id
         where pp.project_id <> m.project_id) as cross_project_parties,
       (select string_agg(p.proname, ', ') from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
                or p.proname ~ '_accepts_department_input$')
           and p.prosrc ilike '%project_members%') as authority_helpers_reading_members,
       (select count(*) from pg_catalog.pg_policies
         where tablename <> 'project_members'
           and (coalesce(qual, '') ilike '%project_members%' or coalesce(with_check, '') ilike '%project_members%')) as other_policies_reading_members,
       (select convalidated from pg_catalog.pg_constraint
         where conname = 'project_members_active_requires_party_and_role') as required_rule_validated,
       (select count(*) from pg_catalog.pg_policies where tablename = 'project_members' and cmd = 'DELETE') as delete_policies;

rollback;

\echo
\echo Verification complete. Transaction rolled back; nothing was written.
