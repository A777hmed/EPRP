"use client";

import * as React from "react";
import Link from "next/link";

import { PageHeader, StatusBadge } from "@/components/shared";
import { REPORT_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { getClientById, getContactById } from "@/features/master-data";
import type { Project, WeeklyReport } from "@/types";

/**
 * One labelled fact in the header strip.
 *
 * A definition list rather than a grid of cards: these are eight short facts
 * about one document, and boxing each of them would give a caption the visual
 * weight of a metric.
 */
function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export interface WeeklyWorkspaceHeaderProps {
  report: WeeklyReport;
  project: Project | null;
  /** Page-level buttons, owned by the view so it keeps its dialogs. */
  actions?: React.ReactNode;
  /** "Viewing as …" line. Display only — never the authority. */
  viewerName?: string;
  viewerRoleLabel?: string;
}

/**
 * The Weekly Progress Report header.
 *
 * Identifies the document the way a printed report does — what it is, which
 * project and client it belongs to, which week it covers, where it is in the
 * lifecycle, and who last touched it — before any of its content appears.
 *
 * Every value is read from the report and its project. Nothing here is stored
 * a second time.
 */
export function WeeklyWorkspaceHeader({
  report,
  project,
  actions,
  viewerName,
  viewerRoleLabel,
}: WeeklyWorkspaceHeaderProps) {
  const client = getClientById(project?.clientId);
  const preparedBy = getContactById(report.preparedByContactId);
  const status = REPORT_STATUS_META[report.status];

  return (
    <PageHeader
      eyebrow="Weekly Reports"
      title="Weekly Progress Report"
      description={report.reportNumber}
      actions={actions}
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-3 lg:grid-cols-4">
        <Fact label="Project">
          {project ? (
            <Link
              href={`/projects/${project.id}`}
              className="hover:underline"
              title={project.name}
            >
              {project.name}
            </Link>
          ) : (
            "—"
          )}
        </Fact>
        <Fact label="Project Code">
          <span className="font-mono text-xs">{project?.code ?? "—"}</span>
        </Fact>
        <Fact label="Client">{client?.name ?? "—"}</Fact>
        <Fact label="Week Number">
          <span className="tabular-nums">Week {report.weekNumber}</span>
        </Fact>
        <Fact label="Reporting Period">
          <span className="tabular-nums">
            {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
          </span>
        </Fact>
        <Fact label="Status">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </Fact>
        <Fact label="Prepared By">{preparedBy?.name ?? "—"}</Fact>
        <Fact label="Last Updated">
          <span className="tabular-nums">{formatDate(report.updatedAt)}</span>
        </Fact>
      </dl>

      {viewerName && (
        <p className="text-xs text-muted-foreground">
          Viewing as {viewerName}
          {viewerRoleLabel ? ` · ${viewerRoleLabel}` : ""}
        </p>
      )}
    </PageHeader>
  );
}
