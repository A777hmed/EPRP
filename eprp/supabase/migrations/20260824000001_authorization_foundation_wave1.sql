-- EPRP Authorization Foundation — Implementation Wave 1.
--
-- Server/database authorization only. This migration deliberately:
--   * keeps the legacy profiles.role vocabulary compatible;
--   * treats only system_admin and project_control_admin as global authority;
--   * resolves Project Control / Planning and Report Coordinator assignments
--     exclusively from project_contacts;
--   * separates reporting, project operations, responsibilities, department
--     comments, Executive preparation and Calendar management;
--   * changes no Master Milestone/Deliverable data model or row;
--   * never repairs or waives an existing responsibility-membership exception;
--     unresolved rows abort this migration before any authorization DDL runs.

/* --------------------------- lockout / data preflight -------------------- */

do $pre$
declare
  admins integer;
  fixed_membership_exceptions integer;
  position_membership_exceptions integer;
  history_scope_exceptions integer;
begin
  select count(*) into admins
    from public.profiles
   where role = 'system_admin' and active;

  if admins = 0 and exists (select 1 from public.profiles) then
    raise exception
      'Refusing to install Authorization Foundation: no active system_admin profile exists.';
  end if;

  select count(*) into position_membership_exceptions
    from public.project_positions pp
   where not exists (
     select 1
       from public.project_contacts pc
      where pc.project_id = pp.project_id
        and pc.contact_id = pp.contact_id
   );

  select count(*) into fixed_membership_exceptions
    from public.projects p
    cross join lateral (
      values
        (p.project_manager_id),
        (p.project_control_manager_id),
        (p.client_representative_id),
        (p.reporting_coordinator_id),
        (p.project_sponsor_id)
    ) holder(contact_id)
   where holder.contact_id is not null
     and not exists (
       select 1
         from public.project_contacts pc
        where pc.project_id = p.id
          and pc.contact_id = holder.contact_id
     );

  select count(*) into history_scope_exceptions
    from public.position_assignment_history pah
   where not exists (
     select 1
       from public.organization_positions op
       join public.organization_charts oc
         on oc.id = op.chart_id
        and oc.project_id = op.project_id
      where op.id = pah.position_id
        and op.chart_id = pah.chart_id
        and op.project_id = pah.project_id
   );

  raise notice 'Authorization preflight: % active system administrator(s).', admins;
  if fixed_membership_exceptions > 0
     or position_membership_exceptions > 0
     or history_scope_exceptions > 0 then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'Authorization deployment precondition failed: %s fixed-responsibility membership exception(s), %s project-position membership exception(s), and %s cross-project assignment-history exception(s) must be resolved explicitly before deployment. No row was changed.',
        fixed_membership_exceptions,
        position_membership_exceptions,
        history_scope_exceptions
      );
  end if;

  raise notice
    'Authorization responsibility preflight passed: fixed %, additional %, assignment-history % exception(s).',
    fixed_membership_exceptions,
    position_membership_exceptions,
    history_scope_exceptions;
end;
$pre$;

/* -------------------------- assignment integrity ------------------------- */

-- Project Control / Planning and Report Coordinator are project-wide roles.
-- A row carrying either role may not also carry technical department, system,
-- work-item or reporting-line scope. Current live data passed this condition.
do $constraint$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.project_contacts'::regclass
       and conname = 'project_contacts_project_authority_unscoped'
  ) then
    alter table public.project_contacts
      add constraint project_contacts_project_authority_unscoped check (
        role not in ('project_control_manager', 'reporting_coordinator')
        or (
          department_id is null
          and system_id is null
          and discipline_id is null
          and assignment_role is null
          and reports_to_contact_id is null
        )
      );
  end if;
end;
$constraint$;

-- The history row's three scope keys are one fact, not three independent
-- caller-supplied references. The composite FK makes the database prove that
-- the position belongs to the stated chart and project. The preflight above
-- gives existing mismatches a clear deployment error before this is added.
do $history_constraints$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.organization_positions'::regclass
       and conname = 'organization_positions_id_chart_project_key'
  ) then
    alter table public.organization_positions
      add constraint organization_positions_id_chart_project_key
      unique (id, chart_id, project_id);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.position_assignment_history'::regclass
       and conname = 'position_assignment_history_position_chart_project_fk'
  ) then
    alter table public.position_assignment_history
      add constraint position_assignment_history_position_chart_project_fk
      foreign key (position_id, chart_id, project_id)
      references public.organization_positions(id, chart_id, project_id)
      on delete cascade;
  end if;
end;
$history_constraints$;

/* ------------------------------- identity -------------------------------- */

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.role
    from public.profiles p
   where p.id = (select auth.uid())
     and p.active;
$fn$;

create or replace function public.current_contact_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.contact_id
    from public.profiles p
   where p.id = (select auth.uid())
     and p.active;
$fn$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.role = 'system_admin'
       and p.active
  );
$fn$;

create or replace function public.is_project_control_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.role = 'project_control_admin'
       and p.active
  );
$fn$;

create or replace function public.has_global_operational_authority()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.is_system_admin() or public.is_project_control_admin();
$fn$;

comment on function public.has_global_operational_authority() is
  'True for active System Admin or Project Control Admin accounts. These are the only platform-wide operational authorities in the pilot model.';

/* ------------------------- project-scoped authority ---------------------- */

create or replace function public.is_project_control_planning(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.current_contact_id() is not null
     and exists (
       select 1
         from public.project_contacts pc
        where pc.project_id = p_project
          and pc.contact_id = public.current_contact_id()
          and pc.role = 'project_control_manager'
          and pc.department_id is null
          and pc.system_id is null
          and pc.discipline_id is null
          and pc.assignment_role is null
     );
$fn$;

create or replace function public.is_report_coordinator(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.current_contact_id() is not null
     and exists (
       select 1
         from public.project_contacts pc
        where pc.project_id = p_project
          and pc.contact_id = public.current_contact_id()
          and pc.role = 'reporting_coordinator'
          and pc.department_id is null
          and pc.system_id is null
          and pc.discipline_id is null
          and pc.assignment_role is null
     );
$fn$;

-- Compatibility only. New policies below do not use this broad pair for
-- unrelated writes.
create or replace function public.is_project_consolidator(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.is_project_control_planning(p_project)
      or public.is_report_coordinator(p_project);
$fn$;

comment on function public.is_project_consolidator(uuid) is
  'Compatibility reporting predicate: assigned Project Control / Planning OR assigned Report Coordinator. Do not use for Project Setup, Calendar, Master Milestones, Master Deliverables, project structure or other operations.';

create or replace function public.is_department_user(
  p_project uuid,
  p_department uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_department is not null
     and public.current_contact_id() is not null
     and exists (
       select 1
         from public.project_contacts pc
         join public.project_departments pd
           on pd.project_id = pc.project_id
          and pd.department_id = pc.department_id
        where pc.project_id = p_project
          and pc.department_id = p_department
          and pc.contact_id = public.current_contact_id()
          and pc.role = 'team_member'
          and pc.assignment_role in (
            'department_manager', 'team_member_lead', 'team_member'
          )
     );
$fn$;

create or replace function public.can_manage_reporting_workflow(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_global_operational_authority()
      or public.is_project_control_planning(p_project)
      or public.is_report_coordinator(p_project);
$fn$;

create or replace function public.can_manage_project_operations(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_global_operational_authority()
      or public.is_project_control_planning(p_project);
$fn$;

create or replace function public.can_manage_project_responsibilities(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_manage_project_operations(p_project);
$fn$;

create or replace function public.can_manage_position_assignment_history(
  p_position uuid,
  p_chart uuid,
  p_project uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.organization_positions op
      join public.organization_charts oc
        on oc.id = op.chart_id
       and oc.project_id = op.project_id
     where op.id = p_position
       and op.chart_id = p_chart
       and op.project_id = p_project
       and public.can_manage_project_operations(op.project_id)
  );
$fn$;

comment on function public.can_manage_position_assignment_history(uuid, uuid, uuid) is
  'Authorizes assignment-history insertion only when position, chart and project resolve to one canonical organization-position scope and the caller may manage that actual project.';

create or replace function public.can_edit_department_report_comment(
  p_project uuid,
  p_department uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_manage_reporting_workflow(p_project)
      or public.is_department_user(p_project, p_department);
$fn$;

create or replace function public.can_manage_calendar()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_global_operational_authority();
$fn$;

create or replace function public.can_manage_project_executive(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_manage_reporting_workflow(p_project);
$fn$;

/* ---------------------------- compatibility helpers ---------------------- */

-- This legacy name now means reporting workflow only. It remains for the
-- controlled Weekly lifecycle writer and older reporting callers.
create or replace function public.weekly_can_manage_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_manage_reporting_workflow(p_project);
$fn$;

create or replace function public.monthly_can_manage_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_manage_reporting_workflow(p_project);
$fn$;

create or replace function public.weekly_can_access_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_global_operational_authority()
      or public.is_project_control_planning(p_project)
      or public.is_report_coordinator(p_project)
      or (
        public.current_contact_id() is not null
        and exists (
          select 1
            from public.project_contacts pc
           where pc.project_id = p_project
             and pc.contact_id = public.current_contact_id()
        )
      );
$fn$;

create or replace function public.weekly_can_access_scope(
  p_project uuid,
  p_department uuid,
  p_discipline uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_global_operational_authority()
      or public.is_project_control_planning(p_project)
      or public.is_report_coordinator(p_project)
      or (
        public.is_department_user(p_project, p_department)
        and exists (
          select 1
            from public.project_contacts pc
           where pc.project_id = p_project
             and pc.department_id = p_department
             and pc.contact_id = public.current_contact_id()
             and pc.role = 'team_member'
             and (p_discipline is null or pc.discipline_id = p_discipline)
        )
      );
$fn$;

create or replace function public.can_create_project()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_global_operational_authority();
$fn$;

create or replace function public.can_manage_project_setup(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_manage_project_operations(p_project);
$fn$;

create or replace function public.can_bin_project_document(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_manage_project_operations(p_project);
$fn$;

create or replace function public.can_reconcile_milestone(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_manage_project_operations(p_project);
$fn$;

-- Portfolio-level Executive persistence has no project_id. It therefore stays
-- with the two global authorities; project-scoped coordination uses notes.
create or replace function public.executive_can_manage()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_global_operational_authority();
$fn$;

/* -------------------------- helper execution rights ---------------------- */

revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.current_contact_id() from public, anon;
revoke execute on function public.is_system_admin() from public, anon;
revoke execute on function public.is_project_control_admin() from public, anon;
revoke execute on function public.has_global_operational_authority() from public, anon;
revoke execute on function public.is_project_control_planning(uuid) from public, anon;
revoke execute on function public.is_report_coordinator(uuid) from public, anon;
revoke execute on function public.is_project_consolidator(uuid) from public, anon;
revoke execute on function public.is_department_user(uuid, uuid) from public, anon;
revoke execute on function public.can_manage_reporting_workflow(uuid) from public, anon;
revoke execute on function public.can_manage_project_operations(uuid) from public, anon;
revoke execute on function public.can_manage_project_responsibilities(uuid) from public, anon;
revoke execute on function public.can_manage_position_assignment_history(uuid, uuid, uuid) from public, anon;
revoke execute on function public.can_edit_department_report_comment(uuid, uuid) from public, anon;
revoke execute on function public.can_manage_calendar() from public, anon;
revoke execute on function public.can_manage_project_executive(uuid) from public, anon;
revoke execute on function public.weekly_can_manage_project(uuid) from public, anon;
revoke execute on function public.monthly_can_manage_project(uuid) from public, anon;
revoke execute on function public.weekly_can_access_project(uuid) from public, anon;
revoke execute on function public.weekly_can_access_scope(uuid, uuid, uuid) from public, anon;
revoke execute on function public.can_create_project() from public, anon;
revoke execute on function public.can_manage_project_setup(uuid) from public, anon;
revoke execute on function public.can_bin_project_document(uuid) from public, anon;
revoke execute on function public.can_reconcile_milestone(uuid) from public, anon;
revoke execute on function public.executive_can_manage() from public, anon;

grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.current_contact_id() to authenticated, service_role;
grant execute on function public.is_system_admin() to authenticated, service_role;
grant execute on function public.is_project_control_admin() to authenticated, service_role;
grant execute on function public.has_global_operational_authority() to authenticated, service_role;
grant execute on function public.is_project_control_planning(uuid) to authenticated, service_role;
grant execute on function public.is_report_coordinator(uuid) to authenticated, service_role;
grant execute on function public.is_project_consolidator(uuid) to authenticated, service_role;
grant execute on function public.is_department_user(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_manage_reporting_workflow(uuid) to authenticated, service_role;
grant execute on function public.can_manage_project_operations(uuid) to authenticated, service_role;
grant execute on function public.can_manage_project_responsibilities(uuid) to authenticated, service_role;
grant execute on function public.can_manage_position_assignment_history(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_edit_department_report_comment(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_manage_calendar() to authenticated, service_role;
grant execute on function public.can_manage_project_executive(uuid) to authenticated, service_role;
grant execute on function public.weekly_can_manage_project(uuid) to authenticated, service_role;
grant execute on function public.monthly_can_manage_project(uuid) to authenticated, service_role;
grant execute on function public.weekly_can_access_project(uuid) to authenticated, service_role;
grant execute on function public.weekly_can_access_scope(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_create_project() to authenticated, service_role;
grant execute on function public.can_manage_project_setup(uuid) to authenticated, service_role;
grant execute on function public.can_bin_project_document(uuid) to authenticated, service_role;
grant execute on function public.can_reconcile_milestone(uuid) to authenticated, service_role;
grant execute on function public.executive_can_manage() to authenticated, service_role;

/* ----------------------- platform/master-data writes --------------------- */

-- These tables still carried the bootstrap `authenticated_all` policies.
-- Reads stay open; platform-wide writes are limited to the two global roles.
do $master_policies$
declare
  tbl text;
  tables text[] := array[
    'clients', 'project_types', 'project_phases', 'departments',
    'contacts', 'systems', 'disciplines', 'job_titles'
  ];
begin
  foreach tbl in array tables loop
    execute format('drop policy if exists %I on public.%I', tbl || '_authenticated_all', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_select', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      tbl || '_select', tbl
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.has_global_operational_authority()))',
      tbl || '_insert', tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.has_global_operational_authority())) with check ((select public.has_global_operational_authority()))',
      tbl || '_update', tbl
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.has_global_operational_authority()))',
      tbl || '_delete', tbl
    );
  end loop;
end;
$master_policies$;

/* ------------------------- project structure / setup --------------------- */

-- Organization Chart is project structure, not reporting. Reads stay open.
do $org_policies$
declare
  tbl text;
  tables text[] := array['organization_charts', 'organization_positions'];
begin
  foreach tbl in array tables loop
    execute format('drop policy if exists %I on public.%I', tbl || '_authenticated_all', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_select', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      tbl || '_select', tbl
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_manage_project_operations(project_id))',
      tbl || '_insert', tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_manage_project_operations(project_id)) with check (public.can_manage_project_operations(project_id))',
      tbl || '_update', tbl
    );
  end loop;
end;
$org_policies$;

drop policy if exists position_assignment_history_authenticated_all
  on public.position_assignment_history;
drop policy if exists position_assignment_history_select
  on public.position_assignment_history;
drop policy if exists position_assignment_history_insert
  on public.position_assignment_history;
drop policy if exists position_assignment_history_update
  on public.position_assignment_history;
drop policy if exists position_assignment_history_delete
  on public.position_assignment_history;

create policy position_assignment_history_select
  on public.position_assignment_history
  for select to authenticated using (true);
create policy position_assignment_history_insert
  on public.position_assignment_history
  for insert to authenticated
  with check (
    public.can_manage_position_assignment_history(
      position_id, chart_id, project_id
    )
  );

-- Project setup policies already call this helper. Redefining it above removes
-- Report Coordinator authority from projects, project_contacts, departments,
-- disciplines and delegations without rewriting their stable policy shapes.

drop policy if exists project_sites_insert on public.project_sites;
drop policy if exists project_sites_update on public.project_sites;
drop policy if exists project_sites_delete on public.project_sites;
create policy project_sites_insert on public.project_sites
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));
create policy project_sites_update on public.project_sites
  for update to authenticated
  using (public.can_manage_project_operations(project_id))
  with check (public.can_manage_project_operations(project_id));
create policy project_sites_delete on public.project_sites
  for delete to authenticated
  using (public.can_manage_project_operations(project_id));

drop policy if exists project_documents_insert on public.project_documents;
drop policy if exists project_documents_update on public.project_documents;
create policy project_documents_insert on public.project_documents
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));
create policy project_documents_update on public.project_documents
  for update to authenticated
  using (public.can_manage_project_operations(project_id))
  with check (public.can_manage_project_operations(project_id));

drop policy if exists project_reference_documents_insert on storage.objects;
drop policy if exists project_reference_documents_update on storage.objects;
create policy project_reference_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-reference-documents'
    and public.can_manage_project_operations(
      public.project_id_from_storage_path(name)
    )
  );
create policy project_reference_documents_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-reference-documents'
    and public.can_manage_project_operations(
      public.project_id_from_storage_path(name)
    )
  )
  with check (
    bucket_id = 'project-reference-documents'
    and public.can_manage_project_operations(
      public.project_id_from_storage_path(name)
    )
  );

/* -------------------------- Project Responsibilities --------------------- */

-- Project creation is now two-stage: create the project without fixed holders,
-- create its responsibility membership rows, then set the five holder columns.
-- This is the smallest way to keep every committed state valid when the client
-- uses separate PostgREST statements. Project Manager remains required by the
-- application workflow, while the database permits the short setup state.
alter table public.projects
  alter column project_manager_id drop not null;

comment on column public.projects.project_manager_id is
  'Project Manager contact. May be null only while a new project is being staged; once set, same-project project_contacts membership is mandatory.';

create or replace function public.guard_fixed_project_responsibility_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  holder uuid;
begin
  foreach holder in array array[
    new.project_manager_id,
    new.project_control_manager_id,
    new.client_representative_id,
    new.reporting_coordinator_id,
    new.project_sponsor_id
  ]
  loop
    if holder is null then
      continue;
    end if;

    -- Serialize every membership check for this project/contact pair. This
    -- closes the race between assigning a responsibility and deleting its last
    -- membership row in another transaction.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.id::text || ':' || holder::text, 0)
    );

    perform 1
      from public.project_contacts pc
     where pc.project_id = new.id
       and pc.contact_id = holder
     for key share;

    if not found then
      raise exception
        'A fixed Project Responsibility may only be assigned to a person already assigned to the same project.'
        using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end;
$fn$;

drop trigger if exists trg_fixed_project_responsibility_membership
  on public.projects;
create constraint trigger trg_fixed_project_responsibility_membership
  after insert or update
  on public.projects
  deferrable initially immediate
  for each row
  execute function public.guard_fixed_project_responsibility_membership();

revoke execute on function public.guard_fixed_project_responsibility_membership()
  from public, anon, authenticated, service_role;

drop policy if exists project_positions_insert on public.project_positions;
drop policy if exists project_positions_update on public.project_positions;
drop policy if exists project_positions_delete on public.project_positions;
create policy project_positions_insert on public.project_positions
  for insert to authenticated
  with check (public.can_manage_project_responsibilities(project_id));
create policy project_positions_update on public.project_positions
  for update to authenticated
  using (public.can_manage_project_responsibilities(project_id))
  with check (public.can_manage_project_responsibilities(project_id));
create policy project_positions_delete on public.project_positions
  for delete to authenticated
  using (public.can_manage_project_responsibilities(project_id));

create or replace function public.guard_project_position_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.project_id::text || ':' || new.contact_id::text,
      0
    )
  );

  perform 1
    from public.project_contacts pc
   where pc.project_id = new.project_id
     and pc.contact_id = new.contact_id
   for key share;

  if not found then
    raise exception
      'A Project Responsibility may only be assigned to a person already assigned to the same project.'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_project_position_membership
  on public.project_positions;
create trigger trg_project_position_membership
  before insert or update on public.project_positions
  for each row execute function public.guard_project_position_membership();

revoke execute on function public.guard_project_position_membership()
  from public, anon, authenticated, service_role;

-- A membership row may be removed or moved only while another row still
-- represents the same person on the same project, or when no responsibility
-- references that membership. This is deliberately contact-level: one person
-- may hold several scoped project_contacts rows, and removing one of several
-- must not be mistaken for removing the person's project membership.
create or replace function public.guard_project_contact_membership_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.project_id = old.project_id
     and new.contact_id = old.contact_id then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      old.project_id::text || ':' || old.contact_id::text,
      0
    )
  );

  -- A parent-project cascade removes the responsibilities too, so no orphan
  -- can survive and the child-row guard must not block that cascade.
  if not exists (
    select 1 from public.projects p where p.id = old.project_id
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform 1
    from public.project_contacts pc
   where pc.project_id = old.project_id
     and pc.contact_id = old.contact_id
     and pc.id <> old.id
   for key share;

  if found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if exists (
    select 1
      from public.projects p
     where p.id = old.project_id
       and old.contact_id = any (array[
         p.project_manager_id,
         p.project_control_manager_id,
         p.client_representative_id,
         p.reporting_coordinator_id,
         p.project_sponsor_id
       ])
  ) or exists (
    select 1
      from public.project_positions pp
     where pp.project_id = old.project_id
       and pp.contact_id = old.contact_id
  ) then
    raise exception
      'The last project membership for this person cannot be removed or reassigned while an active Project Responsibility still references it.'
      using errcode = 'foreign_key_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;

drop trigger if exists trg_project_contact_membership_removal
  on public.project_contacts;
create trigger trg_project_contact_membership_removal
  before delete or update of project_id, contact_id
  on public.project_contacts
  for each row
  execute function public.guard_project_contact_membership_removal();

revoke execute on function public.guard_project_contact_membership_removal()
  from public, anon, authenticated, service_role;

/* --------------------------- Weekly workflow ----------------------------- */

drop policy if exists weekly_reports_insert on public.weekly_reports;
drop policy if exists weekly_reports_update on public.weekly_reports;
drop policy if exists weekly_reports_delete on public.weekly_reports;
create policy weekly_reports_insert on public.weekly_reports
  for insert to authenticated
  with check (public.can_manage_reporting_workflow(project_id));
create policy weekly_reports_update on public.weekly_reports
  for update to authenticated
  using (public.can_manage_reporting_workflow(project_id))
  with check (public.can_manage_reporting_workflow(project_id));
create policy weekly_reports_delete on public.weekly_reports
  for delete to authenticated
  using (public.can_manage_reporting_workflow(project_id));

drop policy if exists weekly_submissions_insert on public.weekly_submissions;
drop policy if exists weekly_submissions_update on public.weekly_submissions;
drop policy if exists weekly_submissions_delete on public.weekly_submissions;
create policy weekly_submissions_insert on public.weekly_submissions
  for insert to authenticated
  with check (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));
create policy weekly_submissions_update on public.weekly_submissions
  for update to authenticated
  using (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)))
  with check (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));
create policy weekly_submissions_delete on public.weekly_submissions
  for delete to authenticated
  using (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));

drop policy if exists weekly_activities_insert on public.weekly_activities;
drop policy if exists weekly_activities_update on public.weekly_activities;
drop policy if exists weekly_activities_delete on public.weekly_activities;
create policy weekly_activities_insert on public.weekly_activities
  for insert to authenticated
  with check (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));
create policy weekly_activities_update on public.weekly_activities
  for update to authenticated
  using (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)))
  with check (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));
create policy weekly_activities_delete on public.weekly_activities
  for delete to authenticated
  using (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));

drop policy if exists weekly_entries_insert on public.weekly_entries;
drop policy if exists weekly_entries_update on public.weekly_entries;
drop policy if exists weekly_entries_delete on public.weekly_entries;
create policy weekly_entries_insert on public.weekly_entries
  for insert to authenticated
  with check (
    public.can_manage_reporting_workflow(
      public.weekly_report_project(weekly_report_id)
    )
    or (
      entry_type = 'comment'
      and department_id is not null
      and public.can_edit_department_report_comment(
        public.weekly_report_project(weekly_report_id), department_id
      )
    )
  );
create policy weekly_entries_update on public.weekly_entries
  for update to authenticated
  using (
    public.can_manage_reporting_workflow(
      public.weekly_report_project(weekly_report_id)
    )
    or (
      entry_type = 'comment'
      and department_id is not null
      and public.can_edit_department_report_comment(
        public.weekly_report_project(weekly_report_id), department_id
      )
    )
  )
  with check (
    public.can_manage_reporting_workflow(
      public.weekly_report_project(weekly_report_id)
    )
    or (
      entry_type = 'comment'
      and department_id is not null
      and public.can_edit_department_report_comment(
        public.weekly_report_project(weekly_report_id), department_id
      )
    )
  );
create policy weekly_entries_delete on public.weekly_entries
  for delete to authenticated
  using (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));

drop policy if exists weekly_plan_items_insert on public.weekly_plan_items;
drop policy if exists weekly_plan_items_update on public.weekly_plan_items;
drop policy if exists weekly_plan_items_delete on public.weekly_plan_items;
create policy weekly_plan_items_insert on public.weekly_plan_items
  for insert to authenticated
  with check (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));
create policy weekly_plan_items_update on public.weekly_plan_items
  for update to authenticated
  using (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)))
  with check (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));
create policy weekly_plan_items_delete on public.weekly_plan_items
  for delete to authenticated
  using (public.can_manage_reporting_workflow(
    public.weekly_report_project(weekly_report_id)));

/* --------------------------- Monthly workflow ---------------------------- */

drop policy if exists monthly_reports_insert on public.monthly_reports;
drop policy if exists monthly_reports_update on public.monthly_reports;
drop policy if exists monthly_reports_delete on public.monthly_reports;
create policy monthly_reports_insert on public.monthly_reports
  for insert to authenticated
  with check (public.can_manage_reporting_workflow(project_id));
create policy monthly_reports_update on public.monthly_reports
  for update to authenticated
  using (public.can_manage_reporting_workflow(project_id))
  with check (public.can_manage_reporting_workflow(project_id));
create policy monthly_reports_delete on public.monthly_reports
  for delete to authenticated
  using (public.can_manage_reporting_workflow(project_id));

drop policy if exists monthly_comments_insert on public.monthly_comments;
drop policy if exists monthly_comments_update on public.monthly_comments;
drop policy if exists monthly_comments_delete on public.monthly_comments;
create policy monthly_comments_insert on public.monthly_comments
  for insert to authenticated
  with check (
    public.can_manage_reporting_workflow(
      public.monthly_report_project(monthly_report_id)
    )
    or (
      source_kind = 'monthly_manual'
      and department_id is not null
      and public.can_edit_department_report_comment(
        public.monthly_report_project(monthly_report_id), department_id
      )
    )
  );
create policy monthly_comments_update on public.monthly_comments
  for update to authenticated
  using (
    public.can_manage_reporting_workflow(
      public.monthly_report_project(monthly_report_id)
    )
    or (
      source_kind = 'monthly_manual'
      and department_id is not null
      and public.can_edit_department_report_comment(
        public.monthly_report_project(monthly_report_id), department_id
      )
    )
  )
  with check (
    public.can_manage_reporting_workflow(
      public.monthly_report_project(monthly_report_id)
    )
    or (
      source_kind = 'monthly_manual'
      and department_id is not null
      and public.can_edit_department_report_comment(
        public.monthly_report_project(monthly_report_id), department_id
      )
    )
  );
create policy monthly_comments_delete on public.monthly_comments
  for delete to authenticated
  using (public.can_manage_reporting_workflow(
    public.monthly_report_project(monthly_report_id)));

drop policy if exists monthly_department_summaries_write
  on public.monthly_department_summaries;
drop policy if exists monthly_department_summaries_insert
  on public.monthly_department_summaries;
drop policy if exists monthly_department_summaries_update
  on public.monthly_department_summaries;
drop policy if exists monthly_department_summaries_delete
  on public.monthly_department_summaries;
create policy monthly_department_summaries_insert
  on public.monthly_department_summaries
  for insert to authenticated
  with check (public.can_manage_reporting_workflow(
    public.monthly_report_project(monthly_report_id)));
create policy monthly_department_summaries_update
  on public.monthly_department_summaries
  for update to authenticated
  using (public.can_manage_reporting_workflow(
    public.monthly_report_project(monthly_report_id)))
  with check (public.can_manage_reporting_workflow(
    public.monthly_report_project(monthly_report_id)));
create policy monthly_department_summaries_delete
  on public.monthly_department_summaries
  for delete to authenticated
  using (public.can_manage_reporting_workflow(
    public.monthly_report_project(monthly_report_id)));

drop policy if exists monthly_plan_items_write on public.monthly_plan_items;
drop policy if exists monthly_plan_items_insert on public.monthly_plan_items;
drop policy if exists monthly_plan_items_update on public.monthly_plan_items;
drop policy if exists monthly_plan_items_delete on public.monthly_plan_items;
create policy monthly_plan_items_insert on public.monthly_plan_items
  for insert to authenticated
  with check (public.can_manage_reporting_workflow(
    public.monthly_report_project(monthly_report_id)));
create policy monthly_plan_items_update on public.monthly_plan_items
  for update to authenticated
  using (public.can_manage_reporting_workflow(
    public.monthly_report_project(monthly_report_id)))
  with check (public.can_manage_reporting_workflow(
    public.monthly_report_project(monthly_report_id)));
create policy monthly_plan_items_delete on public.monthly_plan_items
  for delete to authenticated
  using (public.can_manage_reporting_workflow(
    public.monthly_report_project(monthly_report_id)));

/* ----------------------- Executive preparation boundary ----------------- */

drop policy if exists executive_reports_insert on public.executive_reports;
drop policy if exists executive_reports_update on public.executive_reports;
drop policy if exists executive_reports_delete on public.executive_reports;
create policy executive_reports_insert on public.executive_reports
  for insert to authenticated
  with check ((select public.executive_can_manage()));
create policy executive_reports_update on public.executive_reports
  for update to authenticated
  using ((select public.executive_can_manage()))
  with check ((select public.executive_can_manage()));
create policy executive_reports_delete on public.executive_reports
  for delete to authenticated
  using ((select public.executive_can_manage()));

drop policy if exists executive_notes_select on public.executive_notes;
drop policy if exists executive_notes_insert on public.executive_notes;
drop policy if exists executive_notes_update on public.executive_notes;
drop policy if exists executive_notes_delete on public.executive_notes;
create policy executive_notes_select on public.executive_notes
  for select to authenticated
  using (
    (select public.executive_can_manage())
    or (
      project_id is not null
      and public.weekly_can_access_project(project_id)
    )
  );
create policy executive_notes_insert on public.executive_notes
  for insert to authenticated
  with check (
    (project_id is null and (select public.executive_can_manage()))
    or (
      project_id is not null
      and public.can_manage_project_executive(project_id)
    )
  );
create policy executive_notes_update on public.executive_notes
  for update to authenticated
  using (
    (project_id is null and (select public.executive_can_manage()))
    or (
      project_id is not null
      and public.can_manage_project_executive(project_id)
    )
  )
  with check (
    (project_id is null and (select public.executive_can_manage()))
    or (
      project_id is not null
      and public.can_manage_project_executive(project_id)
    )
  );
create policy executive_notes_delete on public.executive_notes
  for delete to authenticated
  using (
    (project_id is null and (select public.executive_can_manage()))
    or (
      project_id is not null
      and public.can_manage_project_executive(project_id)
    )
  );

/* ------------------------------ Calendar --------------------------------- */

drop policy if exists project_events_insert on public.project_events;
drop policy if exists project_events_update on public.project_events;
drop policy if exists project_events_delete on public.project_events;
create policy project_events_insert on public.project_events
  for insert to authenticated
  with check ((select public.can_manage_calendar()));
create policy project_events_update on public.project_events
  for update to authenticated
  using ((select public.can_manage_calendar()))
  with check ((select public.can_manage_calendar()));
create policy project_events_delete on public.project_events
  for delete to authenticated
  using ((select public.can_manage_calendar()));

drop policy if exists project_event_attendees_insert
  on public.project_event_attendees;
drop policy if exists project_event_attendees_update
  on public.project_event_attendees;
drop policy if exists project_event_attendees_delete
  on public.project_event_attendees;
create policy project_event_attendees_insert
  on public.project_event_attendees
  for insert to authenticated
  with check ((select public.can_manage_calendar()));
create policy project_event_attendees_update
  on public.project_event_attendees
  for update to authenticated
  using ((select public.can_manage_calendar()))
  with check ((select public.can_manage_calendar()));
create policy project_event_attendees_delete
  on public.project_event_attendees
  for delete to authenticated
  using ((select public.can_manage_calendar()));

/* -------------------- Master register authorization only ----------------- */
-- The model, workflow, history, reconciliation and reporting semantics are
-- untouched. These are policy predicate replacements only.

drop policy if exists master_milestones_insert on public.master_milestones;
drop policy if exists master_milestones_update on public.master_milestones;
create policy master_milestones_insert on public.master_milestones
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));
create policy master_milestones_update on public.master_milestones
  for update to authenticated
  using (public.can_manage_project_operations(project_id))
  with check (public.can_manage_project_operations(project_id));

drop policy if exists milestone_updates_insert on public.milestone_updates;
drop policy if exists milestone_updates_update on public.milestone_updates;
create policy milestone_updates_insert on public.milestone_updates
  for insert to authenticated
  with check (
    case
      when source = 'reconciliation' then
        public.can_reconcile_milestone(
          public.milestone_project(milestone_id)
        )
      else
        public.can_manage_project_operations(
          public.milestone_project(milestone_id)
        )
    end
  );
create policy milestone_updates_update on public.milestone_updates
  for update to authenticated
  using (public.can_manage_project_operations(
    public.milestone_project(milestone_id)))
  with check (public.can_manage_project_operations(
    public.milestone_project(milestone_id)));

drop policy if exists master_deliverables_insert on public.master_deliverables;
drop policy if exists master_deliverables_update on public.master_deliverables;
create policy master_deliverables_insert on public.master_deliverables
  for insert to authenticated
  with check (public.can_manage_project_operations(project_id));
create policy master_deliverables_update on public.master_deliverables
  for update to authenticated
  using (public.can_manage_project_operations(project_id))
  with check (public.can_manage_project_operations(project_id));

drop policy if exists deliverable_updates_insert on public.deliverable_updates;
drop policy if exists deliverable_updates_update on public.deliverable_updates;
create policy deliverable_updates_insert on public.deliverable_updates
  for insert to authenticated
  with check (public.can_manage_project_operations(
    public.deliverable_project(deliverable_id)));
create policy deliverable_updates_update on public.deliverable_updates
  for update to authenticated
  using (public.can_manage_project_operations(
    public.deliverable_project(deliverable_id)))
  with check (public.can_manage_project_operations(
    public.deliverable_project(deliverable_id)));

/* ----------------------------- postconditions ---------------------------- */

do $post$
declare
  leaked_policies integer;
  calendar_policies integer;
  register_policies integer;
  blanket_writes integer;
  guard_count integer;
  history_integrity integer;
  anon_helpers integer;
begin
  -- No unrelated write policy may retain the old broad reporting predicate.
  select count(*) into leaked_policies
    from pg_policies
   where schemaname in ('public', 'storage')
     and cmd <> 'SELECT'
     and tablename not in (
       'weekly_reports', 'weekly_submissions', 'weekly_activities',
       'weekly_entries', 'weekly_plan_items', 'monthly_reports',
       'monthly_comments', 'monthly_department_summaries',
       'monthly_plan_items'
     )
     and (
       coalesce(qual, '') || coalesce(with_check, '')
       like '%weekly_can_manage_project%'
       or coalesce(qual, '') || coalesce(with_check, '')
       like '%is_project_consolidator%'
     );
  if leaked_policies > 0 then
    raise exception
      'Post-check failed: % unrelated write policy/policies still use a broad reporting predicate.',
      leaked_policies;
  end if;

  select count(*) into calendar_policies
    from pg_policies
   where schemaname = 'public'
     and tablename in ('project_events', 'project_event_attendees')
     and cmd <> 'SELECT'
     and coalesce(qual, '') || coalesce(with_check, '')
         like '%can_manage_calendar%';
  if calendar_policies <> 6 then
    raise exception
      'Post-check failed: expected 6 Calendar write policies on can_manage_calendar(), found %.',
      calendar_policies;
  end if;

  select count(*) into register_policies
    from pg_policies
   where schemaname = 'public'
     and tablename in (
       'master_milestones', 'milestone_updates',
       'master_deliverables', 'deliverable_updates'
     )
     and cmd <> 'SELECT'
     and coalesce(qual, '') || coalesce(with_check, '')
         like '%can_manage_project_operations%';
  if register_policies <> 8 then
    raise exception
      'Post-check failed: expected 8 Master register write policies on Project Operations, found %.',
      register_policies;
  end if;

  select count(*) into blanket_writes
    from pg_policies
   where schemaname = 'public'
     and cmd <> 'SELECT'
     and tablename in (
       'clients', 'project_types', 'project_phases', 'departments',
       'contacts', 'systems', 'disciplines', 'job_titles',
       'organization_charts', 'organization_positions',
       'position_assignment_history'
     )
     and (qual = 'true' or with_check = 'true');
  if blanket_writes > 0 then
    raise exception
      'Post-check failed: % bootstrap blanket write policy/policies remain in foundational structure.',
      blanket_writes;
  end if;

  select count(*) into guard_count
    from pg_trigger
   where tgname in (
       'trg_project_position_membership',
       'trg_fixed_project_responsibility_membership',
       'trg_project_contact_membership_removal'
     )
     and not tgisinternal;
  if guard_count <> 3 then
    raise exception
      'Post-check failed: expected all three Project Responsibility membership guards.';
  end if;

  select count(*) into history_integrity
    from pg_constraint
   where conrelid = 'public.position_assignment_history'::regclass
     and conname = 'position_assignment_history_position_chart_project_fk'
     and contype = 'f'
     and convalidated;
  if history_integrity <> 1 then
    raise exception
      'Post-check failed: assignment history lacks the canonical position/chart/project foreign key.';
  end if;

  select count(*) into history_integrity
    from pg_policies
   where schemaname = 'public'
     and tablename = 'position_assignment_history'
     and policyname = 'position_assignment_history_insert'
     and cmd = 'INSERT'
     and coalesce(with_check, '') like
       '%can_manage_position_assignment_history(position_id, chart_id, project_id)%';
  if history_integrity <> 1 then
    raise exception
      'Post-check failed: assignment-history authorization is not bound to canonical position/chart/project scope.';
  end if;

  select count(*) into anon_helpers
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'has_global_operational_authority',
       'is_project_control_planning',
       'is_report_coordinator',
       'can_manage_reporting_workflow',
       'can_manage_project_operations',
       'can_manage_project_responsibilities',
       'can_manage_position_assignment_history',
       'can_edit_department_report_comment',
       'can_manage_calendar'
     )
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if anon_helpers > 0 then
    raise exception
      'Post-check failed: % authorization helper(s) remain executable by anon.',
      anon_helpers;
  end if;

  raise notice
    'Authorization Foundation Wave 1 installed: narrow helpers, canonical assignment-history scope, enforced responsibility membership, and no Master-register data/model change.';
end;
$post$;
