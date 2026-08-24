-- EPRP Phase 5C — seed data.
-- Mirrors the Phase 5A/5B mock master data, plus representative projects.
-- FKs are resolved by unique code/email so no hard-coded UUIDs are needed.

-- Fixed responsibility columns and their project_contacts memberships are
-- seeded atomically. The deferred integrity check validates the completed
-- canonical state at COMMIT; no responsibility or business value is changed.
begin;
set constraints trg_fixed_project_responsibility_membership deferred;

-- Clients ------------------------------------------------------------------
insert into public.clients (name, code, short_name, contact_name, contact_email, contact_phone, country, city) values
  ('Suez Oil Processing Company', 'SOPC', 'SOPC', 'Dina Samir', 'd.samir@sopc.com.eg', '+20 100 555 0142', 'Egypt', 'Suez'),
  ('Alexandria National Refining & Petrochemicals', 'ANRPC', 'ANRPC', 'Wael Hassan', 'w.hassan@anrpc.com.eg', null, 'Egypt', 'Alexandria'),
  ('Egyptian Natural Gas Company', 'GASCO', 'GASCO', 'Sherif Kamal', 's.kamal@gasco.com.eg', null, 'Egypt', 'Amreya'),
  ('Middle East Oil Refinery', 'MIDOR', 'MIDOR', 'Rania Fouad', 'r.fouad@midor.com.eg', null, 'Egypt', 'Alexandria'),
  ('Egyptian Ethylene & Derivatives Company', 'ETHYDCO', 'ETHYDCO', null, null, null, 'Egypt', 'Alexandria');

-- Project types ------------------------------------------------------------
insert into public.project_types (name, code) values
  ('Asset Integrity', 'AI'), ('Inspection Program', 'INSP'), ('Turnaround', 'TA'),
  ('Rehabilitation', 'REHAB'), ('EPC', 'EPC'), ('Digital Transformation', 'DIGI'),
  ('Consultancy', 'CONS'), ('Maintenance Services', 'MAINT');

-- Project phases -----------------------------------------------------------
insert into public.project_phases (name, code, display_order) values
  ('Planning', 'PLN', 1), ('Engineering', 'ENG', 2), ('Procurement', 'PRC', 3),
  ('Mobilization', 'MOB', 4), ('Construction', 'CON', 5), ('Commissioning', 'COM', 6),
  ('Start-up', 'SU', 7), ('Operation', 'OPS', 8), ('Close-out', 'CLO', 9);

-- Departments (leads assigned after contacts exist) ------------------------
insert into public.departments (name, code, description) values
  ('Mechanical', 'MECH', 'Static and rotating equipment, piping.'),
  ('Civil', 'CIV', 'Civil and structural works.'),
  ('Electrical', 'ELEC', 'Power distribution and electrical systems.'),
  ('Instrumentation & Control', 'INST', 'Instrumentation, control, and safeguarding.'),
  ('HSE', 'HSE', 'Health, safety, and environment.'),
  ('Quality Control', 'QC', 'Inspection and quality assurance.'),
  ('Planning & Cost Control', 'PLAN', 'Scheduling, cost control, and reporting.'),
  ('Procurement', 'PROC', 'Procurement and vendor management.');

-- Contacts -----------------------------------------------------------------
insert into public.contacts (name, position, role, organization, email, department_id) values
  ('Ahmed Morsy', 'PMO Administrator', 'Administrator', 'EPROM', 'a.morsy@eprom.com.eg', (select id from public.departments where code='PLAN')),
  ('Mohamed Helmy', 'Senior Project Manager', 'Project Manager', 'EPROM', 'm.helmy@eprom.com.eg', (select id from public.departments where code='MECH')),
  ('Omar El Shazly', 'Project Manager', 'Project Manager', 'EPROM', 'o.shazly@eprom.com.eg', (select id from public.departments where code='MECH')),
  ('Sara Nabil', 'Project Manager', 'Project Manager', 'EPROM', 's.nabil@eprom.com.eg', (select id from public.departments where code='ELEC')),
  ('Khaled Fahmy', 'Project Control Manager', 'Project Control Manager', 'EPROM', 'k.fahmy@eprom.com.eg', (select id from public.departments where code='PLAN')),
  ('Nour Adel', 'Reporting Coordinator', 'Reporting Coordinator', 'EPROM', 'n.adel@eprom.com.eg', (select id from public.departments where code='PLAN')),
  ('Hany Tarek', 'Operations Director', 'Project Sponsor', 'EPROM', 'h.tarek@eprom.com.eg', null),
  ('Dina Samir', 'Asset Integrity Lead', 'Client Representative', 'SOPC', 'd.samir@sopc.com.eg', null);

-- Department leads ---------------------------------------------------------
update public.departments set lead_contact_id = (select id from public.contacts where email='m.helmy@eprom.com.eg') where code='MECH';
update public.departments set lead_contact_id = (select id from public.contacts where email='s.nabil@eprom.com.eg') where code='ELEC';
update public.departments set lead_contact_id = (select id from public.contacts where email='k.fahmy@eprom.com.eg') where code='PLAN';

-- Systems ------------------------------------------------------------------
insert into public.systems (name, code, department_id, description) values
  ('Crude Distillation Unit', 'CDU', (select id from public.departments where code='MECH'), 'Atmospheric and vacuum distillation.'),
  ('Tank Farm', 'TF', (select id from public.departments where code='MECH'), 'Crude and product storage tanks.'),
  ('Safeguarding Systems', 'SGS', (select id from public.departments where code='INST'), 'ESD and fire & gas systems.'),
  ('Main Substation', 'SS', (select id from public.departments where code='ELEC'), 'HV/MV power distribution.'),
  ('Cooling Water Network', 'CW', (select id from public.departments where code='MECH'), 'Cooling towers and circulation.'),
  ('Flare & Relief', 'FLR', (select id from public.departments where code='MECH'), 'Flare knockout and recovery.'),
  -- These two are referenced by the project↔department assignments below. They
  -- were previously named there without ever existing as master records, which
  -- left two projects pointing at systems the platform did not know about.
  ('Hydrotreater Unit', 'HTU', (select id from public.departments where code='MECH'), 'Distillate hydrotreating.'),
  ('Tank 31-T-05', 'T-05', (select id from public.departments where code='CIV'), 'Storage tank under rehabilitation.');

-- Disciplines --------------------------------------------------------------
insert into public.disciplines (name, code, department_id, description) values
  ('Piping', 'PIP', (select id from public.departments where code='MECH'), 'Piping design and installation.'),
  ('Static Equipment', 'STAT', (select id from public.departments where code='MECH'), 'Vessels, exchangers, tanks.'),
  ('Structural', 'STR', (select id from public.departments where code='CIV'), 'Steel and concrete structures.'),
  ('Power', 'PWR', (select id from public.departments where code='ELEC'), 'Power generation and distribution.'),
  ('Process Control', 'PCS', (select id from public.departments where code='INST'), 'DCS, PLC, and control loops.'),
  ('Welding & NDT', 'WELD', (select id from public.departments where code='QC'), 'Welding and non-destructive testing.');

-- Projects (representative subset) -----------------------------------------
insert into public.projects (
  code, name, short_name, description, project_type_id, client_id,
  contract_number, purchase_order_number,
  contract_start_date, planned_start_date, actual_start_date, planned_finish_date, forecast_finish_date,
  project_manager_id, project_control_manager_id, client_representative_id, reporting_coordinator_id, project_sponsor_id,
  status, overall_status, planned_progress, actual_progress, current_phase_id, priority,
  site, country, city, client_contact_name, client_contact_email, client_contact_phone,
  report_header_title, report_reference_prefix, report_footer_text
) values
  (
    'PSAIM-001', 'Plant Systems Asset Integrity Management', 'PSAIM – SOPC',
    'Asset integrity management program across the SOPC refinery.',
    (select id from public.project_types where code='AI'),
    (select id from public.clients where code='SOPC'),
    'SOPC-CN-2025-114', 'PO-88231',
    '2026-01-01', '2026-01-15', '2026-01-20', '2026-12-15', '2026-12-28',
    (select id from public.contacts where email='m.helmy@eprom.com.eg'),
    (select id from public.contacts where email='k.fahmy@eprom.com.eg'),
    (select id from public.contacts where email='d.samir@sopc.com.eg'),
    (select id from public.contacts where email='n.adel@eprom.com.eg'),
    (select id from public.contacts where email='h.tarek@eprom.com.eg'),
    'active', 'on_track', 68, 65, (select id from public.project_phases where code='CON'), 'high',
    'SOPC Refinery', 'Egypt', 'Suez', 'Dina Samir', 'd.samir@sopc.com.eg', '+20 100 555 0142',
    'PSAIM Progress Report', 'EPR-PSAIM', 'One Team. One Goal. Operational Excellence.'
  ),
  (
    'PRJ-002', 'Risk-Based Inspection Program', 'RBI Program',
    'RBI methodology for pressure equipment across ANRPC process units.',
    (select id from public.project_types where code='INSP'),
    (select id from public.clients where code='ANRPC'),
    'ANRPC-CN-2025-201', null,
    null, '2026-02-01', '2026-02-01', '2026-11-30', '2026-11-30',
    (select id from public.contacts where email='o.shazly@eprom.com.eg'),
    (select id from public.contacts where email='k.fahmy@eprom.com.eg'),
    null,
    (select id from public.contacts where email='n.adel@eprom.com.eg'),
    null,
    'active', 'on_track', 60, 58, (select id from public.project_phases where code='ENG'), 'medium',
    'ANRPC Complex', 'Egypt', 'Alexandria', 'Wael Hassan', 'w.hassan@anrpc.com.eg', null,
    null, 'EPR-RBI', null
  ),
  (
    'PRJ-005', 'Storage Tank Rehabilitation', 'Storage Tank Project',
    'Rehabilitation of five crude storage tanks.',
    (select id from public.project_types where code='REHAB'),
    (select id from public.clients where code='SOPC'),
    null, null,
    null, '2026-02-10', '2026-03-05', '2026-08-31', '2026-10-20',
    (select id from public.contacts where email='o.shazly@eprom.com.eg'),
    null, null, null, null,
    'delayed', 'behind', 48, 36, (select id from public.project_phases where code='CON'), 'high',
    'SOPC Tank Farm', 'Egypt', 'Suez', 'Dina Samir', 'd.samir@sopc.com.eg', null,
    null, null, null
  );

-- Project ↔ department assignments -----------------------------------------
--
-- `project_departments.systems` is a jsonb snapshot of the systems a department
-- brought into a project, and its `id` MUST be the real `public.systems.id`
-- uuid. Anything that files a record against a project system — a Master
-- Milestone's `system_id`, for one — writes that value into a `uuid` column
-- with a foreign key onto `systems`.
--
-- This seed used to hardcode placeholders ('sys-1', 'sys-2', …). They looked
-- harmless because the jsonb column accepts any string, and they broke the
-- moment anything tried to USE one: "invalid input syntax for type uuid".
--
-- Built from the master rows rather than restated, so the snapshot cannot
-- drift from the record it is a snapshot of.
insert into public.project_departments (project_id, department_id, lead_name, reporting_required, systems) values
  (
    (select id from public.projects where code='PSAIM-001'),
    (select id from public.departments where code='MECH'),
    'Ibrahim Lotfy', true,
    (select jsonb_agg(jsonb_build_object('id', s.id::text, 'name', s.name, 'code', s.code) order by s.code)
       from public.systems s where s.code in ('CDU','TF'))
  ),
  (
    (select id from public.projects where code='PSAIM-001'),
    (select id from public.departments where code='INST'),
    'Mona Ezz', true,
    (select jsonb_agg(jsonb_build_object('id', s.id::text, 'name', s.name, 'code', s.code) order by s.code)
       from public.systems s where s.code in ('SGS'))
  ),
  (
    (select id from public.projects where code='PSAIM-001'),
    (select id from public.departments where code='QC'),
    null, false, '[]'::jsonb
  ),
  (
    (select id from public.projects where code='PRJ-002'),
    (select id from public.departments where code='MECH'),
    'Tamer Said', true,
    (select jsonb_agg(jsonb_build_object('id', s.id::text, 'name', s.name, 'code', s.code) order by s.code)
       from public.systems s where s.code in ('HTU'))
  ),
  (
    (select id from public.projects where code='PRJ-005'),
    (select id from public.departments where code='CIV'),
    'Hassan Omar', true,
    (select jsonb_agg(jsonb_build_object('id', s.id::text, 'name', s.name, 'code', s.code) order by s.code)
       from public.systems s where s.code in ('T-05'))
  );

-- Project ↔ contact (responsibility roles mirrored into the join table) -----
insert into public.project_contacts (project_id, contact_id, role)
select p.id, p.project_manager_id, 'project_manager'
from public.projects p where p.project_manager_id is not null
union all
select p.id, p.project_control_manager_id, 'project_control_manager'
from public.projects p where p.project_control_manager_id is not null
union all
select p.id, p.reporting_coordinator_id, 'reporting_coordinator'
from public.projects p where p.reporting_coordinator_id is not null
union all
select p.id, p.client_representative_id, 'client_representative'
from public.projects p where p.client_representative_id is not null
union all
select p.id, p.project_sponsor_id, 'project_sponsor'
from public.projects p where p.project_sponsor_id is not null;

commit;
