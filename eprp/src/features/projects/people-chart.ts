import type { Contact, Project, ProjectMember, ProjectParty } from "@/types";
import {
  activeMembers,
  memberNeedsParty,
  memberNeedsProjectRole,
} from "./project-team";
import {
  FIXED_RESPONSIBILITIES,
  type FixedResponsibilityField,
} from "./responsibilities";
import { subcontractorDisplayName } from "./project-parties";

/**
 * People Organization Chart (Phase 2C.3F) — who reports to whom on a project.
 *
 * Derived ONLY from the project's ACTIVE Project Team (`project_members`) and
 * its project-level Reports To (`reports_to_member_id`), the canonical people
 * reporting hierarchy. Never from the PSM Departments / Systems hierarchy,
 * the Other Project Structure, `project_contacts` rows, the parties or the
 * Phase 2A position chart. One engine for PSM, Other and legacy projects.
 *
 * Presentation only and AUTHORITY-FREE: where a person sits on the chart is
 * never consulted for permission. Ended memberships are left out (they stay
 * as history on the Project Team). Reporting lines are never invented: a
 * member whose Reports To is missing, stale, self-referencing or part of a
 * loop is shown at the top level, flagged, and the chart still renders.
 */

export type PeopleChartParty = "eprom" | "client" | "subcontractor" | "needs_party";

export type PeopleChartIssue =
  /** No Reports To recorded (not flagged for the Project Manager / Sponsor). */
  | "no_reports_to"
  /** Reports To names someone who is not an active member of this project. */
  | "reports_to_unavailable"
  /** Reports To names the member themselves (corrupt legacy data). */
  | "reports_to_self"
  /** Part of a reporting loop (corrupt legacy data). */
  | "reporting_loop"
  | "needs_party"
  | "needs_project_role";

export interface PeopleChartNode {
  memberId: string;
  contactId: string;
  name: string;
  /** Descriptive role on this project; undefined on legacy rows. */
  projectRole?: string;
  /** The person's functional job title (People Directory). */
  jobTitle?: string;
  /** The person's company, when it adds to the party label. */
  company?: string;
  party: PeopleChartParty;
  /** "EPROM", the client's name, a subcontractor's name; undefined = needs party. */
  partyLabel?: string;
  /** The manager this card sits under; undefined at the top level. */
  reportsTo?: { memberId: string; name: string };
  /** Fixed responsibilities and project positions held — descriptive badges only. */
  responsibilities: string[];
  issues: PeopleChartIssue[];
  children: PeopleChartNode[];
  /** Everyone below this person, at any depth. */
  descendantCount: number;
}

export interface PeopleChartSummary {
  noReportsTo: number;
  unavailableReportsTo: number;
  selfReports: number;
  /** People in a reporting loop (all loops together). */
  inLoop: number;
  needsParty: number;
  needsProjectRole: number;
}

export interface PeopleChart {
  /** Top-level people, directly under the project. */
  roots: PeopleChartNode[];
  /** Active members on the chart. */
  memberCount: number;
  /** Reporting lines drawn (members shown under a manager). */
  reportingLines: number;
  /** Ended memberships left out of the chart. */
  endedCount: number;
  summary: PeopleChartSummary;
  /** Short data-quality messages; empty when the data is clean. */
  warnings: string[];
}

export interface PeopleChartOptions {
  contacts: readonly Pick<Contact, "id" | "name" | "position" | "organization">[];
  /** The Owner / Client party's display name. */
  clientName?: string;
  /** A project position's job title, for its descriptive badge. */
  jobTitleName?: (jobTitleId: string) => string | undefined;
}

type ChartProject = Pick<Project, "members" | "parties" | "positions" | FixedResponsibilityField>;

/** Sibling order: leadership roles first, then party, then name. */
const LEADERSHIP_RANK: readonly FixedResponsibilityField[] = [
  "projectSponsorId",
  "projectManagerId",
  "clientRepresentativeId",
  "projectControlManagerId",
  "reportingCoordinatorId",
];
const PARTY_RANK: Record<PeopleChartParty, number> = {
  eprom: 0,
  client: 1,
  subcontractor: 2,
  needs_party: 3,
};

const plural = (count: number, singular: string, many: string) =>
  `${count} ${count === 1 ? singular : many}`;

function partyOf(
  member: ProjectMember,
  partyById: Map<string, ProjectParty>,
  clientName: string | undefined
): { party: PeopleChartParty; label?: string; order: number } {
  const party = member.partyId ? partyById.get(member.partyId) : undefined;
  if (!party) return { party: "needs_party", order: 0 };
  if (party.kind === "eprom") return { party: "eprom", label: "EPROM", order: 0 };
  if (party.kind === "owner") {
    return { party: "client", label: clientName?.trim() || "Owner / Client", order: 0 };
  }
  return {
    party: "subcontractor",
    label: subcontractorDisplayName(party) || "Subcontractor",
    order: party.sortOrder,
  };
}

export function buildPeopleChart(project: ChartProject, options: PeopleChartOptions): PeopleChart {
  const members = project.members ?? [];
  const active = activeMembers(members);
  const byId = new Map(active.map((member) => [member.id, member]));
  const contactById = new Map(options.contacts.map((contact) => [contact.id, contact]));
  const partyById = new Map(
    (project.parties ?? []).flatMap((party) => (party.id ? [[party.id, party] as const] : []))
  );
  const heads = new Set([project.projectManagerId, project.projectSponsorId].filter(Boolean));
  const nameOf = (member: ProjectMember) =>
    contactById.get(member.contactId)?.name?.trim() || "Unknown person";

  const issues = new Map<string, PeopleChartIssue[]>(active.map((member) => [member.id, []]));
  const flag = (memberId: string, issue: PeopleChartIssue) => issues.get(memberId)!.push(issue);

  /* ---------------------------- sibling order ---------------------------- */
  const parties = new Map(active.map((member) => [member.id, partyOf(member, partyById, options.clientName)]));
  const rankOf = (member: ProjectMember) => {
    const held = LEADERSHIP_RANK.findIndex((field) => project[field] === member.contactId);
    return held === -1 ? LEADERSHIP_RANK.length : held;
  };
  const compare = (a: ProjectMember, b: ProjectMember) => {
    const pa = parties.get(a.id)!;
    const pb = parties.get(b.id)!;
    return (
      rankOf(a) - rankOf(b) ||
      PARTY_RANK[pa.party] - PARTY_RANK[pb.party] ||
      pa.order - pb.order ||
      nameOf(a).localeCompare(nameOf(b)) ||
      a.id.localeCompare(b.id)
    );
  };

  /* ------------------- reporting lines, validated -------------------- */
  const parentOf = new Map<string, string>();
  for (const member of active) {
    const managerId = member.reportsToMemberId;
    if (!managerId) {
      if (!heads.has(member.contactId)) flag(member.id, "no_reports_to");
    } else if (managerId === member.id) {
      flag(member.id, "reports_to_self");
    } else if (!byId.has(managerId)) {
      flag(member.id, "reports_to_unavailable");
    } else {
      parentOf.set(member.id, managerId);
    }
  }

  /*
   * Loops. Each member has at most one manager, so every connected group
   * holds at most one loop. Walk up from each member, marking the path; a
   * walk that meets its own path has found a loop. Each member is entered
   * once, so the walk always ends. A loop is broken for display at the
   * member who sorts first; everyone in it is flagged.
   */
  const state = new Map<string, "walking" | "done">();
  for (const start of active) {
    const path: string[] = [];
    let current: string | undefined = start.id;
    while (current && !state.has(current)) {
      state.set(current, "walking");
      path.push(current);
      current = parentOf.get(current);
    }
    if (current && state.get(current) === "walking") {
      const loop = path.slice(path.indexOf(current)).map((id) => byId.get(id)!);
      for (const member of loop) flag(member.id, "reporting_loop");
      parentOf.delete([...loop].sort(compare)[0].id);
    }
    for (const id of path) state.set(id, "done");
  }

  /* ------------------------------- nodes -------------------------------- */
  const nodes = new Map<string, PeopleChartNode>();
  for (const member of active) {
    const contact = contactById.get(member.contactId);
    const { party, label } = parties.get(member.id)!;
    const company = contact?.organization?.trim() || undefined;
    if (memberNeedsParty(member) || party === "needs_party") flag(member.id, "needs_party");
    if (memberNeedsProjectRole(member)) flag(member.id, "needs_project_role");
    const managerId = parentOf.get(member.id);
    nodes.set(member.id, {
      memberId: member.id,
      contactId: member.contactId,
      name: nameOf(member),
      projectRole: member.projectRole?.trim() || undefined,
      jobTitle: contact?.position?.trim() || undefined,
      company: company && company.toLowerCase() !== label?.toLowerCase() ? company : undefined,
      party,
      partyLabel: label,
      reportsTo: managerId ? { memberId: managerId, name: nameOf(byId.get(managerId)!) } : undefined,
      responsibilities: [
        ...FIXED_RESPONSIBILITIES.filter((meta) => project[meta.field] === member.contactId).map(
          (meta) => meta.label
        ),
        ...(project.positions ?? [])
          .filter((position) => position.contactId === member.contactId)
          .flatMap((position) => options.jobTitleName?.(position.jobTitleId) ?? []),
      ],
      issues: [...new Set(issues.get(member.id))],
      children: [],
      descendantCount: 0,
    });
  }

  const ordered = [...active].sort(compare);
  const roots: PeopleChartNode[] = [];
  for (const member of ordered) {
    const node = nodes.get(member.id)!;
    const managerId = parentOf.get(member.id);
    if (managerId) nodes.get(managerId)!.children.push(node);
    else roots.push(node);
  }
  // Acyclic now, so the recursion is bounded by the team's size.
  const count = (node: PeopleChartNode): number =>
    (node.descendantCount = node.children.reduce((sum, child) => sum + 1 + count(child), 0));
  roots.forEach(count);

  /* ---------------------------- data quality ---------------------------- */
  const tally = (issue: PeopleChartIssue) =>
    [...nodes.values()].filter((node) => node.issues.includes(issue)).length;
  const summary: PeopleChartSummary = {
    noReportsTo: tally("no_reports_to"),
    unavailableReportsTo: tally("reports_to_unavailable"),
    selfReports: tally("reports_to_self"),
    inLoop: tally("reporting_loop"),
    needsParty: tally("needs_party"),
    needsProjectRole: tally("needs_project_role"),
  };
  const warnings = [
    summary.noReportsTo > 0 ? `${plural(summary.noReportsTo, "person has", "people have")} no Reports To` : "",
    summary.unavailableReportsTo > 0
      ? `${plural(summary.unavailableReportsTo, "person reports", "people report")} to someone no longer on the team`
      : "",
    summary.selfReports > 0
      ? `${plural(summary.selfReports, "person is", "people are")} recorded as reporting to themselves`
      : "",
    summary.inLoop > 0 ? `${plural(summary.inLoop, "person is", "people are")} in a reporting loop` : "",
    summary.needsParty > 0 ? `${plural(summary.needsParty, "person needs", "people need")} a party` : "",
    summary.needsProjectRole > 0
      ? `${plural(summary.needsProjectRole, "person needs", "people need")} a project role`
      : "",
  ].filter(Boolean);

  return {
    roots,
    memberCount: active.length,
    reportingLines: parentOf.size,
    endedCount: members.length - active.length,
    summary,
    warnings,
  };
}

/** Every person in the chart who has direct reports (for Expand / Collapse all). */
export function peopleChartManagers(chart: Pick<PeopleChart, "roots">): string[] {
  const managers: string[] = [];
  const visit = (node: PeopleChartNode) => {
    if (node.children.length > 0) managers.push(node.memberId);
    node.children.forEach(visit);
  };
  chart.roots.forEach(visit);
  return managers;
}

/**
 * How a person's direct reports are laid out on the chart, keeping a wide
 * team compact:
 * - `hang`: reports with nobody under them, in two columns either side of
 *   the line descending from the manager;
 * - `row`: reports with teams of their own, side by side below.
 * Three or more leaf reports hang; so do two or more next to sub-teams.
 * Anything smaller stays a plain row. Order within each part is kept.
 */
export function peopleChartLayout(children: readonly PeopleChartNode[]): {
  hang: PeopleChartNode[];
  row: PeopleChartNode[];
} {
  const leaves = children.filter((child) => child.children.length === 0);
  const teams = children.filter((child) => child.children.length > 0);
  const hangs = teams.length === 0 ? leaves.length >= 3 : leaves.length >= 2;
  return hangs ? { hang: leaves, row: teams } : { hang: [], row: [...children] };
}
