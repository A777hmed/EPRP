import type {
  Client,
  Contact,
  Department,
  Discipline,
  JobTitle,
  ProjectPhase,
  ProjectType,
  System,
} from "@/types";

/**
 * Mock master data (Phase 5A). Managed kinds (clients, project types,
 * project phases) seed the master-data services — UI reads them through
 * the services, never from these arrays directly.
 */

export const mockClients: Client[] = [
  {
    id: "cl-sopc",
    name: "Suez Oil Processing Company",
    code: "SOPC",
    shortName: "SOPC",
    contactName: "Dina Samir",
    contactEmail: "d.samir@sopc.com.eg",
    contactPhone: "+20 100 555 0142",
    country: "Egypt",
    city: "Suez",
    active: true,
  },
  {
    id: "cl-anrpc",
    name: "Alexandria National Refining & Petrochemicals",
    code: "ANRPC",
    shortName: "ANRPC",
    contactName: "Wael Hassan",
    contactEmail: "w.hassan@anrpc.com.eg",
    country: "Egypt",
    city: "Alexandria",
    active: true,
  },
  {
    id: "cl-gasco",
    name: "Egyptian Natural Gas Company",
    code: "GASCO",
    shortName: "GASCO",
    contactName: "Sherif Kamal",
    contactEmail: "s.kamal@gasco.com.eg",
    country: "Egypt",
    city: "Amreya",
    active: true,
  },
  {
    id: "cl-midor",
    name: "Middle East Oil Refinery",
    code: "MIDOR",
    shortName: "MIDOR",
    contactName: "Rania Fouad",
    contactEmail: "r.fouad@midor.com.eg",
    country: "Egypt",
    city: "Alexandria",
    active: true,
  },
  {
    id: "cl-ethydco",
    name: "Egyptian Ethylene & Derivatives Company",
    code: "ETHYDCO",
    shortName: "ETHYDCO",
    country: "Egypt",
    city: "Alexandria",
    active: true,
  },
];

export const mockProjectTypes: ProjectType[] = [
  { id: "pt-asset-integrity", name: "Asset Integrity", code: "AI", active: true },
  { id: "pt-inspection", name: "Inspection Program", code: "INSP", active: true },
  { id: "pt-turnaround", name: "Turnaround", code: "TA", active: true },
  { id: "pt-rehabilitation", name: "Rehabilitation", code: "REHAB", active: true },
  { id: "pt-epc", name: "EPC", code: "EPC", active: true },
  { id: "pt-digital", name: "Digital Transformation", code: "DIGI", active: true },
  { id: "pt-consultancy", name: "Consultancy", code: "CONS", active: true },
  { id: "pt-maintenance", name: "Maintenance Services", code: "MAINT", active: true },
];

export const mockProjectPhases: ProjectPhase[] = [
  { id: "ph-planning", name: "Planning", code: "PLN", displayOrder: 1, active: true },
  { id: "ph-engineering", name: "Engineering", code: "ENG", displayOrder: 2, active: true },
  { id: "ph-procurement", name: "Procurement", code: "PRC", displayOrder: 3, active: true },
  { id: "ph-mobilization", name: "Mobilization", code: "MOB", displayOrder: 4, active: true },
  { id: "ph-construction", name: "Construction", code: "CON", displayOrder: 5, active: true },
  { id: "ph-commissioning", name: "Commissioning", code: "COM", displayOrder: 6, active: true },
  { id: "ph-startup", name: "Start-up", code: "SU", displayOrder: 7, active: true },
  { id: "ph-operation", name: "Operation", code: "OPS", displayOrder: 8, active: true },
  { id: "ph-closeout", name: "Close-out", code: "CLO", displayOrder: 9, active: true },
];

export const mockContacts: Contact[] = [
  { id: "ct-amorsy", name: "Ahmed Morsy", position: "PMO Administrator", role: "Administrator", email: "a.morsy@eprom.com.eg", organization: "EPROM", departmentId: "dp-plan", active: true },
  { id: "ct-helmy", name: "Mohamed Helmy", position: "Senior Project Manager", role: "Project Manager", email: "m.helmy@eprom.com.eg", organization: "EPROM", departmentId: "dp-mech", active: true },
  { id: "ct-shazly", name: "Omar El Shazly", position: "Project Manager", role: "Project Manager", email: "o.shazly@eprom.com.eg", organization: "EPROM", departmentId: "dp-mech", active: true },
  { id: "ct-nabil", name: "Sara Nabil", position: "Project Manager", role: "Project Manager", email: "s.nabil@eprom.com.eg", organization: "EPROM", departmentId: "dp-elec", active: true },
  { id: "ct-fahmy", name: "Khaled Fahmy", position: "Project Control Manager", role: "Project Control Manager", email: "k.fahmy@eprom.com.eg", organization: "EPROM", departmentId: "dp-plan", active: true },
  { id: "ct-adel", name: "Nour Adel", position: "Reporting Coordinator", role: "Reporting Coordinator", email: "n.adel@eprom.com.eg", organization: "EPROM", departmentId: "dp-plan", active: true },
  { id: "ct-tarek", name: "Hany Tarek", position: "Operations Director", role: "Project Sponsor", email: "h.tarek@eprom.com.eg", organization: "EPROM", active: true },
  { id: "ct-samir", name: "Dina Samir", position: "Asset Integrity Lead", role: "Client Representative", email: "d.samir@sopc.com.eg", organization: "SOPC", active: true },
];

export const mockDepartments: Department[] = [
  { id: "dp-mech", name: "Mechanical", code: "MECH", description: "Static and rotating equipment, piping.", leadContactId: "ct-helmy", active: true },
  { id: "dp-civil", name: "Civil", code: "CIV", description: "Structural, foundations, and civil works.", active: true },
  { id: "dp-elec", name: "Electrical", code: "ELEC", description: "Power distribution and electrical systems.", leadContactId: "ct-nabil", active: true },
  { id: "dp-inst", name: "Instrumentation & Control", code: "INST", description: "Instrumentation, control, and safeguarding.", active: true },
  { id: "dp-hse", name: "HSE", code: "HSE", description: "Health, safety, and environment.", active: true },
  { id: "dp-qc", name: "Quality Control", code: "QC", description: "Inspection and quality assurance.", active: true },
  { id: "dp-plan", name: "Planning & Cost Control", code: "PLAN", description: "Scheduling, cost control, and reporting.", leadContactId: "ct-fahmy", active: true },
  { id: "dp-proc", name: "Procurement", code: "PROC", description: "Sourcing and vendor management.", active: true },
];

export const mockSystems: System[] = [
  { id: "sy-cdu", name: "Crude Distillation Unit", code: "CDU", departmentId: "dp-mech", description: "Atmospheric and vacuum distillation.", active: true },
  { id: "sy-tank-farm", name: "Tank Farm", code: "TF", departmentId: "dp-mech", description: "Crude and product storage tanks.", active: true },
  { id: "sy-safeguarding", name: "Safeguarding Systems", code: "SGS", departmentId: "dp-inst", description: "ESD and fire & gas systems.", active: true },
  { id: "sy-substation", name: "Main Substation", code: "SS", departmentId: "dp-elec", description: "HV/MV power distribution.", active: true },
  { id: "sy-cooling", name: "Cooling Water Network", code: "CW", departmentId: "dp-mech", description: "Cooling towers and circulation.", active: true },
  { id: "sy-flare", name: "Flare & Relief", code: "FLR", departmentId: "dp-mech", description: "Flare knockout and recovery.", active: true },
];

export const mockDisciplines: Discipline[] = [
  { id: "di-piping", name: "Piping", code: "PIP", departmentId: "dp-mech", description: "Piping design and installation.", active: true },
  { id: "di-static", name: "Static Equipment", code: "STAT", departmentId: "dp-mech", description: "Vessels, exchangers, tanks.", active: true },
  { id: "di-structural", name: "Structural", code: "STR", departmentId: "dp-civil", description: "Steel and concrete structures.", active: true },
  { id: "di-power", name: "Power", code: "PWR", departmentId: "dp-elec", description: "Power generation and distribution.", active: true },
  { id: "di-control", name: "Process Control", code: "PCS", departmentId: "dp-inst", description: "DCS, PLC, and control loops.", active: true },
  { id: "di-welding", name: "Welding & NDT", code: "WELD", departmentId: "dp-qc", description: "Welding and non-destructive testing.", active: true },
];

/**
 * Job titles (Collaboration Phase C1) start empty on purpose.
 *
 * Titles are organisation-specific and must not be hardcoded — the System
 * Administrator creates them. Seeding examples here would put sample data in
 * front of the first real user. The offline store therefore begins with the
 * empty state, which is the correct state for a fresh install.
 */
export const mockJobTitles: JobTitle[] = [];
