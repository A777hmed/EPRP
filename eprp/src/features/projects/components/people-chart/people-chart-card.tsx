import * as React from "react";
import {
  Building2,
  CircleDashed,
  HardHat,
  Handshake,
  Network,
} from "lucide-react";

import { StatusBadge } from "@/components/shared";
import { PROJECT_LIFECYCLE_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";
import { classificationSummary } from "@/features/projects/classification";
import type {
  PeopleChartIssue,
  PeopleChartNode,
  PeopleChartParty,
} from "@/features/projects/people-chart";
import { ResponsibilityBadge } from "../responsibility-cards";

/**
 * Party accents — the same icons and theme tokens as the Project
 * Responsibility party sections, so the two read as one product. Colour is an
 * accent only (edge, avatar tint, chip text); class names are written out in
 * full for Tailwind's static scan.
 */
export const PEOPLE_PARTY_META: Record<
  PeopleChartParty,
  {
    legend: string;
    icon: React.ComponentType<{ className?: string }>;
    text: string;
    stripe: string;
    tint: string;
  }
> = {
  eprom: {
    legend: "EPROM",
    icon: Building2,
    text: "text-primary",
    stripe: "bg-primary",
    tint: "bg-primary/10 text-primary",
  },
  client: {
    legend: "Client",
    icon: Handshake,
    text: "text-chart-3",
    stripe: "bg-chart-3",
    tint: "bg-chart-3/12 text-chart-3",
  },
  subcontractor: {
    legend: "Subcontractor",
    icon: HardHat,
    text: "text-chart-2",
    stripe: "bg-chart-2",
    tint: "bg-chart-2/12 text-chart-2",
  },
  needs_party: {
    legend: "Needs party",
    icon: CircleDashed,
    text: "text-muted-foreground",
    stripe: "bg-muted-foreground/40",
    tint: "bg-muted text-muted-foreground",
  },
};

/** Card badges for data-quality issues; "Needs party" is the party chip itself. */
const ISSUE_LABEL: Record<Exclude<PeopleChartIssue, "needs_party" | "needs_project_role">, string> = {
  no_reports_to: "No Reports To",
  reports_to_unavailable: "Reports To not on team",
  reports_to_self: "Reports to self",
  reporting_loop: "Reporting loop",
};

/** At most this many responsibility badges; the rest are summarised as "+N". */
const MAX_RESPONSIBILITY_BADGES = 2;

/** "Mohamed Helmy (Demo)" → "MH". */
export function personInitials(name: string): string {
  const words = name.replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * One person on the chart: project role (small label), name (primary), job
 * title · company (metadata), then party and the few badges that matter.
 * The same card face as a Project Responsibility card — a quiet surface with a
 * party-coloured edge. Descriptive only: nothing here implies authority.
 */
export function PeopleChartCard({
  node,
  layout,
}: {
  node: PeopleChartNode;
  layout: "chart" | "outline";
}) {
  const party = PEOPLE_PARTY_META[node.party];
  const PartyIcon = party.icon;
  const metadata = [node.jobTitle, node.company].filter(Boolean).join(" · ");
  const shown = node.responsibilities.slice(0, MAX_RESPONSIBILITY_BADGES);
  const hidden = node.responsibilities.slice(MAX_RESPONSIBILITY_BADGES);
  const issues = node.issues.filter(
    (issue): issue is keyof typeof ISSUE_LABEL => issue in ISSUE_LABEL
  );

  return (
    <article
      data-people-card={node.memberId}
      data-party={node.party}
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-left shadow-xs",
        layout === "chart" ? "w-60" : "w-full max-w-xl"
      )}
    >
      {/* Party edge — the card's only strong colour. */}
      <span className={cn("absolute inset-y-0 left-0 w-0.75", party.stripe)} aria-hidden="true" />

      <div className="flex items-start gap-2.5 py-2.5 pr-2.5 pl-3.5">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold tracking-wide",
            party.tint
          )}
          aria-hidden="true"
        >
          {personInitials(node.name)}
        </span>

        <div className="min-w-0 flex-1">
          {node.projectRole ? (
            <p className="truncate text-xs font-medium text-muted-foreground" title={node.projectRole}>
              {node.projectRole}
            </p>
          ) : (
            <ResponsibilityBadge tone="warning">Needs project role</ResponsibilityBadge>
          )}
          <p className="mt-0.5 truncate text-sm leading-5 font-semibold text-foreground" title={node.name}>
            {node.name}
          </p>
          {metadata && (
            <p className="truncate text-xs text-muted-foreground" title={metadata}>
              {metadata}
            </p>
          )}
          {node.reportsTo && <span className="sr-only">Reports to {node.reportsTo.name}.</span>}

          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
            {node.partyLabel ? (
              <span
                className={cn("inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] font-medium", party.text)}
                title={`Party: ${node.partyLabel}`}
              >
                <PartyIcon className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{node.partyLabel}</span>
              </span>
            ) : (
              <ResponsibilityBadge tone="warning">Needs party</ResponsibilityBadge>
            )}
            {shown.map((label) => (
              <ResponsibilityBadge key={label} tone="muted">
                {label}
              </ResponsibilityBadge>
            ))}
            {hidden.length > 0 && (
              <span title={hidden.join(", ")}>
                <ResponsibilityBadge tone="muted">+{hidden.length}</ResponsibilityBadge>
              </span>
            )}
            {issues.map((issue) => (
              <ResponsibilityBadge key={issue} tone={issue === "no_reports_to" ? "muted" : "warning"}>
                {ISSUE_LABEL[issue]}
              </ResponsibilityBadge>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * The project itself, at the top of the chart: identity, type, lifecycle and
 * the size of its active team.
 */
export function PeopleChartRootCard({
  project,
  memberCount,
  reportingLines,
  layout,
}: {
  project: Pick<Project, "code" | "name" | "shortName" | "structureFamily" | "status">;
  memberCount: number;
  reportingLines: number;
  layout: "chart" | "outline";
}) {
  const status = PROJECT_LIFECYCLE_META[project.status];
  const name = project.shortName ?? project.name;
  return (
    <article
      data-people-chart-root
      className={cn(
        "relative flex min-w-0 items-start gap-3 rounded-lg border border-primary/25 bg-card px-3.5 py-3 shadow-xs",
        layout === "chart" ? "w-80" : "w-full max-w-xl"
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
        <Network className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-xs font-medium text-muted-foreground">{project.code}</p>
          {project.status === "archived" && status && (
            <StatusBadge tone={status.tone} hideDot className="px-1.5 py-0 text-[10px]">
              {status.label}
            </StatusBadge>
          )}
        </div>
        <p className="truncate text-sm leading-5 font-semibold" title={name}>
          {name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {classificationSummary(project.structureFamily, undefined)} ·{" "}
          {memberCount === 1 ? "1 person" : `${memberCount} people`} ·{" "}
          {reportingLines === 1 ? "1 reporting line" : `${reportingLines} reporting lines`}
        </p>
      </div>
    </article>
  );
}
