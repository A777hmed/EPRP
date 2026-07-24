/**
 * Starting structures for a project organization chart.
 *
 * Templates are plain nested data — no ids, no chart reference, no
 * coordinates. Positions are generated from these nodes at load time, which
 * is what keeps parentage and codes intact without the template needing to
 * know anything about the chart it lands in.
 */

export type ChartTemplateId =
  | "epc"
  | "epcm"
  | "construction"
  | "turnaround"
  | "blank";

/** One seat in a template. Children become reports of this node. */
export interface ChartTemplateNode {
  /** Position code, carried through to the created position verbatim. */
  code: string;
  title: string;
  role?: string;
  children?: ChartTemplateNode[];
}

export interface ChartTemplate {
  id: ChartTemplateId;
  name: string;
  /** One line for the card. */
  description: string;
  /** Longer explanation for the preview panel. */
  details: string;
  /** Typical use, shown as chips in the preview. */
  suitedTo: string[];
  nodes: ChartTemplateNode[];
}

const EPC_NODES: ChartTemplateNode[] = [
  {
    code: "PD-01",
    title: "Project Director",
    role: "Overall accountability",
    children: [
      {
        code: "EM-01",
        title: "Engineering Manager",
        role: "Design delivery",
        children: [
          { code: "ENG-PRO", title: "Process Lead" },
          { code: "ENG-MEC", title: "Mechanical Lead" },
          { code: "ENG-EI", title: "Electrical & Instrumentation Lead" },
          { code: "ENG-CIV", title: "Civil & Structural Lead" },
        ],
      },
      {
        code: "PRC-01",
        title: "Procurement Manager",
        role: "Sourcing and vendors",
        children: [
          { code: "PRC-BUY", title: "Lead Buyer" },
          { code: "PRC-EXP", title: "Expediting & Logistics" },
        ],
      },
      {
        code: "CON-01",
        title: "Construction Manager",
        role: "Site delivery",
        children: [
          { code: "CON-SUP", title: "Site Superintendent" },
          { code: "CON-FE", title: "Field Engineer" },
        ],
      },
      {
        code: "PC-01",
        title: "Project Controls Manager",
        role: "Cost and schedule",
        children: [
          { code: "PC-PLN", title: "Planning Engineer" },
          { code: "PC-CST", title: "Cost Engineer" },
        ],
      },
      { code: "QA-01", title: "QA/QC Manager", role: "Quality assurance" },
      { code: "HSE-01", title: "HSE Manager", role: "Health, safety, environment" },
    ],
  },
];

const EPCM_NODES: ChartTemplateNode[] = [
  {
    code: "PD-01",
    title: "Project Director",
    role: "Overall accountability",
    children: [
      {
        code: "EM-01",
        title: "Engineering Manager",
        role: "Design management",
        children: [
          { code: "ENG-PRO", title: "Process Lead" },
          { code: "ENG-MEC", title: "Mechanical Lead" },
          { code: "ENG-EI", title: "Electrical & Instrumentation Lead" },
        ],
      },
      {
        code: "PRC-01",
        title: "Procurement Services Manager",
        role: "Client-side procurement",
        children: [{ code: "PRC-CTR", title: "Contracts Administrator" }],
      },
      {
        code: "CM-01",
        title: "Construction Management Lead",
        role: "Contractor oversight",
        children: [
          { code: "CM-SUP", title: "Field Supervision Lead" },
          { code: "CM-INT", title: "Interface Coordinator" },
        ],
      },
      {
        code: "PC-01",
        title: "Project Controls Manager",
        role: "Cost and schedule",
        children: [
          { code: "PC-PLN", title: "Planning Engineer" },
          { code: "PC-CST", title: "Cost Engineer" },
        ],
      },
      { code: "CTR-01", title: "Contracts Manager", role: "Commercial" },
      { code: "HSE-01", title: "HSE Manager", role: "Health, safety, environment" },
    ],
  },
];

const CONSTRUCTION_NODES: ChartTemplateNode[] = [
  {
    code: "CM-01",
    title: "Construction Manager",
    role: "Site accountability",
    children: [
      {
        code: "SUP-01",
        title: "Site Superintendent",
        role: "Day-to-day execution",
        children: [
          { code: "SUP-CIV", title: "Civil Supervisor" },
          { code: "SUP-MEC", title: "Mechanical Supervisor" },
          { code: "SUP-EI", title: "E&I Supervisor" },
        ],
      },
      {
        code: "FE-01",
        title: "Field Engineering Lead",
        children: [{ code: "FE-SUR", title: "Surveyor" }],
      },
      { code: "MAT-01", title: "Materials & Warehouse Lead" },
      { code: "QC-01", title: "QA/QC Lead" },
      { code: "HSE-01", title: "HSE Lead" },
    ],
  },
];

const TURNAROUND_NODES: ChartTemplateNode[] = [
  {
    code: "TA-01",
    title: "Turnaround Manager",
    role: "Event accountability",
    children: [
      {
        code: "TA-PLN",
        title: "Planning & Scheduling Lead",
        children: [{ code: "TA-SCH", title: "Scheduler" }],
      },
      {
        code: "TA-EXE",
        title: "Execution Lead",
        children: [
          { code: "TA-STA", title: "Static Equipment Supervisor" },
          { code: "TA-ROT", title: "Rotating Equipment Supervisor" },
          { code: "TA-PIP", title: "Piping Supervisor" },
        ],
      },
      { code: "TA-SCA", title: "Scaffolding & Access Lead" },
      { code: "TA-INS", title: "Inspection Lead" },
      { code: "TA-HSE", title: "HSE Lead" },
    ],
  },
];

export const chartTemplates: ChartTemplate[] = [
  {
    id: "epc",
    name: "EPC",
    description: "Engineering, Procurement and Construction under one contractor.",
    details:
      "A single-contractor delivery structure: engineering, procurement and construction all report to the Project Director, with controls, quality and HSE alongside them.",
    suitedTo: ["Lump-sum turnkey", "Single contractor", "Full scope delivery"],
    nodes: EPC_NODES,
  },
  {
    id: "epcm",
    name: "EPCM",
    description: "Management contractor overseeing others' execution.",
    details:
      "A management-led structure where construction is delivered by others. Construction management, contracts and procurement services sit under the Project Director rather than direct execution teams.",
    suitedTo: ["Reimbursable", "Client-side team", "Multiple contractors"],
    nodes: EPCM_NODES,
  },
  {
    id: "construction",
    name: "Construction",
    description: "Site-focused delivery organisation.",
    details:
      "A field organisation headed by the Construction Manager, with discipline supervision, field engineering, materials, quality and HSE. Use when engineering and procurement sit elsewhere.",
    suitedTo: ["Site execution", "Sub-contract packages", "Brownfield works"],
    nodes: CONSTRUCTION_NODES,
  },
  {
    id: "turnaround",
    name: "Turnaround",
    description: "Short-duration shutdown and maintenance event.",
    details:
      "A turnaround structure built around planning and execution streams, with scaffolding, inspection and HSE as dedicated leads. Suits high-intensity, fixed-window events.",
    suitedTo: ["Shutdowns", "Fixed window", "High headcount"],
    nodes: TURNAROUND_NODES,
  },
  {
    id: "blank",
    name: "Blank",
    description: "Start with an empty chart and build it yourself.",
    details:
      "Creates no positions. Choose this when the structure does not resemble a standard template, or when importing the organisation from elsewhere.",
    suitedTo: ["Custom structures", "Import later"],
    nodes: [],
  },
];

export function getChartTemplate(id: ChartTemplateId): ChartTemplate {
  const template = chartTemplates.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown chart template: ${id}`);
  return template;
}

/** Total seats a template will create, counted through the whole tree. */
export function countTemplateNodes(nodes: ChartTemplateNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + countTemplateNodes(node.children ?? []),
    0
  );
}

/** Deepest level in a template, where a single root counts as 1. */
export function templateDepth(nodes: ChartTemplateNode[]): number {
  if (nodes.length === 0) return 0;
  return (
    1 + Math.max(...nodes.map((node) => templateDepth(node.children ?? [])))
  );
}

/** Flatten to `{ node, depth }` rows for the preview list. */
export function flattenTemplate(
  nodes: ChartTemplateNode[],
  depth = 0
): { node: ChartTemplateNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenTemplate(node.children ?? [], depth + 1),
  ]);
}
