-- EPRP Phase 2C.3C — Project Team Membership: backfill preflight (V2).
--
-- 100% READ-ONLY. Every statement is a SELECT inside a READ ONLY transaction
-- that ends in ROLLBACK. There is no INSERT, UPDATE, DELETE, CREATE, DROP,
-- ALTER or GRANT anywhere in this file. Safe to run repeatedly.
--
-- Purpose: show, BEFORE any schema change, exactly which memberships the
-- approved backfill would create, with which party, and why.
--
-- Approved backfill rules (2C.3C, V2):
--   R1 Participation evidence (one membership per project + person):
--      * the project's CURRENT fixed-role columns;
--      * project_positions rows;
--      * project_contacts rows — BUT a fixed-role-named row counts only when
--        its person is the CURRENT holder of that fixed role. A stale mirror
--        row is never participation evidence on its own. Team / scoped rows
--        (role = team_member) count independently.
--   R2 Party, from the CURRENT fixed-role columns only:
--        Project Manager / Project Control Manager / Reporting Coordinator -> EPROM
--        Client Representative                                        -> Owner
--      Project Sponsor is not assumed. Nothing else assigns a party.
--   R3 contacts.organization NEVER assigns a party. A non-empty organization
--      that contradicts a role-derived party DOWNGRADES it to Needs party.
--        EPROM contradicted: organization is not "EPROM" (trim, case-insensitive).
--        Owner contradicted: organization matches none of the project's client
--        name / short name / code (trim, case-insensitive).
--   R4 EPROM-role + Owner-role on the same person = conflict -> Needs party.
--   R5 Project Role is never derived: every backfilled row is Needs project role.
--   R6 Reports To is not backfilled.
--   R7 Archived projects and test fixtures are included as history.
--
-- HOW TO RUN (local development stack only, from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -v confirm=PREFLIGHT \
--     -f - < scripts/p0-validation/112_preflight_project_team_membership.sql

\set ON_ERROR_STOP on
\pset pager off

\if :{?confirm}
\else
  \echo ABORTED - pass -v confirm=PREFLIGHT to run this read-only preflight. Nothing was run.
  \quit
\endif
select (:'confirm' = 'PREFLIGHT') as proceed \gset
\if :proceed
\else
  \echo ABORTED - confirm must be PREFLIGHT. Nothing was run.
  \quit
\endif

begin transaction read only;

\echo
\echo ==================== 0. Target and preconditions ====================
select current_database() as database,
       inet_server_addr() as server_addr,
       now() as run_at,
       exists (select 1 from supabase_migrations.schema_migrations
                where version = '20261007120000') as has_2c3b_migration,
       to_regclass('public.project_members') is null as project_members_absent;

-- Shared CTE prefix (a read-only transaction cannot create even temporary
-- views). psql variables are single-line, hence the long line. It defines:
--   _fixed               current fixed-role holders (authoritative)
--   _pc                  every project_contacts row + whether it counts (R1)
--   _participant_sources one row per (project, person, counted source)
--   _proposal            one row per (project, person): sources, role-derived
--                        party, contradiction flags, proposed party + reason
\set PROPOSAL 'with _fixed as (select p.id as project_id, f.role, f.contact_id from public.projects p cross join lateral (values (''project_manager'', p.project_manager_id), (''project_control_manager'', p.project_control_manager_id), (''client_representative'', p.client_representative_id), (''reporting_coordinator'', p.reporting_coordinator_id), (''project_sponsor'', p.project_sponsor_id)) as f(role, contact_id) where f.contact_id is not null), _pc as (select pc.id, pc.project_id, pc.contact_id, pc.role, pc.assignment_role, pc.department_id, case when pc.role in (''project_manager'', ''project_control_manager'', ''client_representative'', ''reporting_coordinator'', ''project_sponsor'') then exists (select 1 from _fixed f where f.project_id = pc.project_id and f.role = pc.role and f.contact_id = pc.contact_id) else true end as counts from public.project_contacts pc), _participant_sources as (select project_id, contact_id, ''fixed:'' || role as source from _fixed union select pp.project_id, pp.contact_id, ''position:'' || coalesce(jt.name, ''(unknown title)'') from public.project_positions pp left join public.job_titles jt on jt.id = pp.job_title_id union select project_id, contact_id, ''project_contacts:'' || role || coalesce(''/'' || assignment_role, '''') || case when department_id is not null then ''/dept-scoped'' else '''' end from _pc where counts), _participants as (select s.project_id, s.contact_id, array_agg(distinct s.source order by s.source) as sources, bool_or(s.source in (''fixed:project_manager'', ''fixed:project_control_manager'', ''fixed:reporting_coordinator'')) as eprom_role, bool_or(s.source = ''fixed:client_representative'') as owner_role from _participant_sources s group by s.project_id, s.contact_id), _evidence as (select pr.*, nullif(btrim(c.organization), '''') as organization, pr.eprom_role and nullif(btrim(c.organization), '''') is not null and upper(btrim(c.organization)) <> ''EPROM'' as eprom_contradicted, pr.owner_role and nullif(btrim(c.organization), '''') is not null and upper(btrim(c.organization)) not in (upper(btrim(coalesce(cl.name, ''''))), upper(btrim(coalesce(cl.short_name, ''''))), upper(btrim(coalesce(cl.code, '''')))) as owner_contradicted from _participants pr join public.contacts c on c.id = pr.contact_id join public.projects p on p.id = pr.project_id left join public.clients cl on cl.id = p.client_id), _proposal as (select e.*, case when e.eprom_role and e.owner_role then null when e.eprom_role and not e.eprom_contradicted then ''EPROM'' when e.owner_role and not e.owner_contradicted then ''Owner'' else null end as proposed_party, case when e.eprom_role and e.owner_role then ''conflict: EPROM role and Client Representative'' when e.eprom_role and e.eprom_contradicted then ''downgraded: organization contradicts EPROM'' when e.owner_role and e.owner_contradicted then ''downgraded: organization contradicts Owner/client'' when e.eprom_role or e.owner_role then ''role-derived'' when ''fixed:project_sponsor'' = any (e.sources) then ''Project Sponsor is not assumed'' else ''no role-derived party'' end as party_reason from _evidence e) '

\echo
\echo ============ 1. Memberships to create: sources and proposed party ============
:PROPOSAL
select p.code as project, p.status, coalesce(p.structure_family, 'legacy') as family,
       c.name as person,
       coalesce(x.proposed_party, 'Needs party') as proposed_party,
       x.party_reason,
       'Needs project role' as project_role,
       array_to_string(x.sources, ', ') as sources
  from _proposal x
  join public.projects p on p.id = x.project_id
  join public.contacts c on c.id = x.contact_id
 order by p.code, coalesce(x.proposed_party, 'zz'), c.name;

\echo
\echo ==================== 2. Per-project counts ====================
:PROPOSAL
select p.code as project, p.status, coalesce(p.structure_family, 'legacy') as family,
       count(*) as memberships,
       count(*) filter (where x.proposed_party = 'EPROM') as eprom,
       count(*) filter (where x.proposed_party = 'Owner') as owner,
       count(*) filter (where x.proposed_party is null) as needs_party,
       count(*) as needs_project_role
  from _proposal x
  join public.projects p on p.id = x.project_id
 group by p.code, p.status, p.structure_family
 order by p.code;

\echo
\echo ==================== 3. Totals ====================
:PROPOSAL
select count(*) as memberships_to_create,
       count(distinct contact_id) as distinct_people,
       count(distinct project_id) as projects,
       count(*) filter (where proposed_party = 'EPROM') as eprom,
       count(*) filter (where proposed_party = 'Owner') as owner,
       count(*) filter (where proposed_party is null) as needs_party,
       count(*) as needs_project_role,
       count(*) filter (where party_reason like 'downgraded%') as downgraded,
       count(*) filter (where party_reason like 'conflict%') as conflicts
  from _proposal;

\echo
\echo ==================== 4. Needs party, with reason ====================
:PROPOSAL
select p.code as project, c.name as person, x.party_reason,
       array_to_string(x.sources, ', ') as sources
  from _proposal x
  join public.projects p on p.id = x.project_id
  join public.contacts c on c.id = x.contact_id
 where x.proposed_party is null
 order by x.party_reason, p.code, c.name;

\echo
\echo ============ 5. Role-derived mappings DOWNGRADED by contradictory organization ============
:PROPOSAL
select p.code as project, c.name as person, x.party_reason,
       x.organization as organization_free_text,
       cl.name as project_client, cl.short_name as client_short_name, cl.code as client_code,
       array_to_string(x.sources, ', ') as sources
  from _proposal x
  join public.projects p on p.id = x.project_id
  join public.contacts c on c.id = x.contact_id
  left join public.clients cl on cl.id = p.client_id
 where x.party_reason like 'downgraded%'
 order by p.code, c.name;

\echo
\echo ============ 6. Stale fixed-role project_contacts rows EXCLUDED as evidence ============
\echo (independent_evidence = the person still qualifies through another counted source on that project)
:PROPOSAL
select p.code as project, pc.role as stale_role, c.name as person,
       coalesce(cur.name, '(role unassigned)') as current_holder,
       exists (select 1 from _participant_sources s
                where s.project_id = pc.project_id and s.contact_id = pc.contact_id) as independent_evidence,
       case when exists (select 1 from _participant_sources s
                          where s.project_id = pc.project_id and s.contact_id = pc.contact_id)
            then 'person kept through other evidence'
            else 'person EXCLUDED from backfill' end as outcome
  from _pc pc
  join public.projects p on p.id = pc.project_id
  join public.contacts c on c.id = pc.contact_id
  left join _fixed f on f.project_id = pc.project_id and f.role = pc.role
  left join public.contacts cur on cur.id = f.contact_id
 where not pc.counts
 order by p.code, pc.role;

\echo
\echo ==================== 7. Duplicates, conflicts and anomalies ====================
\echo 7a. More than one proposed membership for the same project + person (must be empty)
:PROPOSAL
select project_id, contact_id, count(*) from _proposal group by 1, 2 having count(*) > 1;

\echo 7b. EPROM-role + Client Representative conflicts
:PROPOSAL
select p.code as project, c.name as person, array_to_string(x.sources, ', ') as sources
  from _proposal x
  join public.projects p on p.id = x.project_id
  join public.contacts c on c.id = x.contact_id
 where x.party_reason like 'conflict%';

\echo 7c. Fixed-role-named project_contacts rows that also carry department scope (counted only because they match the current holder)
select p.code as project, pc.role, pc.assignment_role, c.name as person, d.name as department,
       (pc.contact_id = p.project_manager_id) as is_current_project_manager
  from public.project_contacts pc
  join public.projects p on p.id = pc.project_id
  join public.contacts c on c.id = pc.contact_id
  left join public.departments d on d.id = pc.department_id
 where pc.role <> 'team_member'
   and (pc.department_id is not null or pc.assignment_role is not null)
 order by p.code, c.name;

\echo 7d. Current fixed holders with NO project_contacts row (must be empty)
:PROPOSAL
select p.code as project, f.role, c.name as person
  from _fixed f
  join public.projects p on p.id = f.project_id
  join public.contacts c on c.id = f.contact_id
 where not exists (select 1 from public.project_contacts pc
                    where pc.project_id = f.project_id and pc.contact_id = f.contact_id);

\echo 7e. Inactive or archived people who would become members
:PROPOSAL
select p.code as project, c.name as person, c.active, c.archived_at
  from _proposal x
  join public.projects p on p.id = x.project_id
  join public.contacts c on c.id = x.contact_id
 where not c.active or c.archived_at is not null;

\echo 7f. Possible duplicate PEOPLE in the master among proposed members (same normalized name or email, different ids)
:PROPOSAL
select 'name:' || lower(btrim(c.name)) as key, count(distinct c.id) as contact_ids
  from public.contacts c
 where c.id in (select contact_id from _proposal)
 group by lower(btrim(c.name))
having count(distinct c.id) > 1
union all
select 'email:' || lower(btrim(c.email)), count(distinct c.id)
  from public.contacts c
 where c.id in (select contact_id from _proposal) and c.email is not null
 group by lower(btrim(c.email))
having count(distinct c.id) > 1;

\echo 7g. Projects without exactly one EPROM and one Owner party (must be empty)
select p.code as project,
       count(*) filter (where pp.kind = 'eprom') as eprom_parties,
       count(*) filter (where pp.kind = 'owner') as owner_parties
  from public.projects p
  left join public.project_parties pp on pp.project_id = p.id
 group by p.code
having count(*) filter (where pp.kind = 'eprom') <> 1
    or count(*) filter (where pp.kind = 'owner') <> 1;

\echo 7h. Projects that would receive no memberships
:PROPOSAL
select p.code as project, p.status
  from public.projects p
 where not exists (select 1 from _proposal x where x.project_id = p.id);

\echo 7i. Department Reports To on project_contacts (NOT backfilled; informational)
select count(*) as rows_with_department_reports_to
  from public.project_contacts
 where reports_to_contact_id is not null;

\echo 7j. Subcontractor parties (none receive backfilled members)
select count(*) as subcontractor_parties
  from public.project_parties
 where kind = 'subcontractor';

\echo 7k. Proposed members linked to a sign-in account (informational: membership grants no authority)
:PROPOSAL
select count(distinct x.contact_id) as members_with_account
  from _proposal x
 where exists (select 1 from public.profiles pr where pr.contact_id = x.contact_id);

rollback;

\echo
\echo Preflight V2 complete. Transaction rolled back; nothing was written.
