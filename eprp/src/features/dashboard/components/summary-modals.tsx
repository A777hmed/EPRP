"use client";

/**
 * Top Dashboard summary-card quick detail — Top-Level 5A1 correction, §A.
 *
 * Five compact CENTER modals (`DetailModal` at `size="compact"`), one per KPI
 * strip card. Deliberately NOT the wide right-side Project Workspace: these
 * answer "what is behind this one portfolio number", read in a few seconds —
 * a management quick-look, not an exploration surface. Nothing here fetches
 * or recomputes anything; every figure comes from the SAME `PortfolioTotals`/
 * `ProjectPosition[]` the KPI strip itself renders, so a modal can never
 * disagree with the card that opened it.
 */

import * as React from "react";

import { DetailModal, DrawerEmptyNote, DrawerSection, StatusBadge } from "@/components/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HEALTH_META,
  overdueReports,
  positionStatusLabel,
  type PortfolioTotals,
  type ProjectPosition,
} from "../dashboard-data";
import { healthStatusBadgeTone, pct, signedPct } from "./dashboard-format";
import type {
  DashboardMonthlyReportSummary,
  DashboardWeeklyReportSummary,
} from "@/services/dashboard-read-model";
import type { Contact } from "@/types";

export type SummaryModalKind = "portfolio" | "coverage" | "onTrack" | "variance" | "overdue";

const TITLE: Record<SummaryModalKind, string> = {
  portfolio: "Portfolio Progress",
  coverage: "Reporting Coverage",
  onTrack: "Projects On Track",
  variance: "Schedule Variance",
  overdue: "Overdue Reports",
};

const SUBTITLE: Record<SummaryModalKind, string> = {
  portfolio: "Unweighted mean across reported projects",
  coverage: "Projects with a valid reporting basis",
  onTrack: "Membership by Dashboard Schedule Health",
  variance: "Actual less planned, ranked by exception",
  overdue: "Past period end and not yet approved",
};

function basisCell(position: ProjectPosition): string {
  return positionStatusLabel(position);
}

function dataDateCell(position: ProjectPosition): string {
  return position.dataDate ?? position.reportedOn ?? "—";
}

/* --------------------------------- A1 --------------------------------- */

function PortfolioProgressContent({
  totals,
  positions,
  portfolioBasisNote,
}: {
  totals: PortfolioTotals;
  positions: ProjectPosition[];
  portfolioBasisNote: string;
}) {
  const reported = positions.filter((p) => p.planned !== undefined && p.actual !== undefined);
  const excluded = positions.filter((p) => p.planned === undefined || p.actual === undefined);

  return (
    <div className="flex flex-col gap-4 p-1">
      <div>
        <p className="text-4xl font-semibold tracking-tight text-foreground">{pct(totals.actual)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Planned {pct(totals.planned)}</p>
      </div>
      <DrawerEmptyNote>{portfolioBasisNote}</DrawerEmptyNote>
      {reported.length === 0 ? (
        <DrawerEmptyNote>No project has reported both Planned and Actual progress.</DrawerEmptyNote>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Planned</TableHead>
                <TableHead>Actual</TableHead>
                <TableHead>Variance</TableHead>
                <TableHead>Basis</TableHead>
                <TableHead>Data Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reported.map((position) => (
                <TableRow key={position.project.id}>
                  <TableCell className="font-medium">{position.project.name}</TableCell>
                  <TableCell>{pct(position.planned)}</TableCell>
                  <TableCell>{pct(position.actual)}</TableCell>
                  <TableCell>{signedPct(position.variance)}</TableCell>
                  <TableCell className="text-muted-foreground">{basisCell(position)}</TableCell>
                  <TableCell className="text-muted-foreground">{dataDateCell(position)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {excluded.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Excluded from the mean — no comparable Planned/Actual data:{" "}
          {excluded.map((p) => p.project.name).join(", ")}.
        </p>
      )}
    </div>
  );
}

/* --------------------------------- A2 --------------------------------- */

function ReportingCoverageContent({ totals, positions }: { totals: PortfolioTotals; positions: ProjectPosition[] }) {
  const coverage = totals.totalProjects ? Math.round((totals.reportedProjects / totals.totalProjects) * 100) : undefined;
  const withBasis = positions.filter((p) => p.basis !== "none");
  const withoutBasis = positions.filter((p) => p.basis === "none");

  return (
    <div className="flex flex-col gap-4 p-1">
      <div>
        <p className="text-4xl font-semibold tracking-tight text-foreground">{coverage === undefined ? "—" : `${coverage}%`}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {totals.reportedProjects} of {totals.totalProjects} projects reporting
        </p>
      </div>

      {withBasis.length > 0 && (
        <DrawerSection title="Has a reporting basis">
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead>Data Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withBasis.map((position) => (
                  <TableRow key={position.project.id}>
                    <TableCell className="font-medium">{position.project.name}</TableCell>
                    <TableCell className="text-muted-foreground">{basisCell(position)}</TableCell>
                    <TableCell className="text-muted-foreground">{dataDateCell(position)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DrawerSection>
      )}

      <DrawerSection title="No reporting basis">
        {withoutBasis.length === 0 ? (
          <DrawerEmptyNote>Every visible project has a reporting basis.</DrawerEmptyNote>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {withoutBasis.map((position) => (
              <li key={position.project.id} className="rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground">
                {position.project.name}
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>
    </div>
  );
}

/* --------------------------------- A3 --------------------------------- */

const HEALTH_ORDER: ProjectPosition["health"][] = ["on_track", "at_risk", "behind", "critical", "not_reported"];

function ProjectsOnTrackContent({ positions }: { positions: ProjectPosition[] }) {
  const onTrack = positions.filter((p) => p.health === "on_track").length;

  return (
    <div className="flex flex-col gap-4 p-1">
      <div>
        <p className="text-4xl font-semibold tracking-tight text-foreground">{onTrack}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">of {positions.length} in view</p>
      </div>
      {HEALTH_ORDER.map((health) => {
        const rows = positions.filter((p) => p.health === health);
        if (rows.length === 0) return null;
        const meta = HEALTH_META[health];
        return (
          <DrawerSection key={health} title={meta.label} hint={`${rows.length} ${rows.length === 1 ? "project" : "projects"}`}>
            <ul className="flex flex-col gap-1.5">
              {rows.map((position) => (
                <li
                  key={position.project.id}
                  className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {position.project.name} <span className="text-muted-foreground">· {position.project.code}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span>{signedPct(position.variance)}</span>
                    <span>{basisCell(position)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </DrawerSection>
        );
      })}
    </div>
  );
}

/* --------------------------------- A4 --------------------------------- */

function ScheduleVarianceContent({ positions }: { positions: ProjectPosition[] }) {
  const ranked = [...positions]
    .filter((p) => p.variance !== undefined)
    .sort((a, b) => (a.variance as number) - (b.variance as number));
  const noVariance = positions.filter((p) => p.variance === undefined);
  const headline = ranked[0];

  return (
    <div className="flex flex-col gap-4 p-1">
      <div>
        <p className={`text-4xl font-semibold tracking-tight text-foreground`}>
          {headline ? signedPct(headline.variance) : "—"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {headline ? `Worst exception — ${headline.project.name}` : "No project has reported a variance"}
        </p>
      </div>
      {ranked.length === 0 ? (
        <DrawerEmptyNote>No project has reported both Planned and Actual progress.</DrawerEmptyNote>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Planned</TableHead>
                <TableHead>Actual</TableHead>
                <TableHead>Variance</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Basis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((position) => (
                <TableRow key={position.project.id}>
                  <TableCell className="font-medium">{position.project.name}</TableCell>
                  <TableCell>{pct(position.planned)}</TableCell>
                  <TableCell>{pct(position.actual)}</TableCell>
                  <TableCell>{signedPct(position.variance)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={healthStatusBadgeTone(position.health)}>{HEALTH_META[position.health].label}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{basisCell(position)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {noVariance.length > 0 && (
        <p className="text-xs text-muted-foreground">
          No comparable variance: {noVariance.map((p) => p.project.name).join(", ")}.
        </p>
      )}
    </div>
  );
}

/* --------------------------------- A5 --------------------------------- */

function OverdueReportsContent({
  positions,
  overdueWeeklies,
  overdueMonthlies,
  contacts,
}: {
  positions: ProjectPosition[];
  overdueWeeklies: DashboardWeeklyReportSummary[];
  overdueMonthlies: DashboardMonthlyReportSummary[];
  contacts: Contact[];
}) {
  const rows = overdueReports(positions, overdueWeeklies, overdueMonthlies);
  const projectName = (projectId: string) => positions.find((p) => p.project.id === projectId)?.project.name ?? "—";
  const contactName = (contactId?: string) => (contactId ? contacts.find((c) => c.id === contactId)?.name : undefined);

  return (
    <div className="flex flex-col gap-4 p-1">
      <div>
        <p className="text-4xl font-semibold tracking-tight text-foreground">{rows.length}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Past period end, not approved</p>
      </div>
      {rows.length === 0 ? (
        <DrawerEmptyNote>Reporting is current — no overdue Weekly or Monthly report.</DrawerEmptyNote>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Report</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Overdue</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => {
                const owner = contactName(row.preparedByContactId);
                return (
                  <TableRow key={`${row.projectId}-${row.reportType}-${index}`}>
                    <TableCell className="font-medium">{projectName(row.projectId)}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">{row.reportType}</TableCell>
                    <TableCell className="text-muted-foreground">{row.period}</TableCell>
                    <TableCell className="text-muted-foreground">{row.status}</TableCell>
                    <TableCell>
                      <span className="text-destructive">
                        {row.daysOverdue} {row.daysOverdue === 1 ? "day" : "days"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{owner ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Dispatcher ------------------------------ */

export function SummaryDetailModal({
  selection,
  onOpenChange,
  totals,
  positions,
  overdueWeeklies,
  overdueMonthlies,
  contacts,
  portfolioBasisNote,
}: {
  selection: SummaryModalKind | null;
  onOpenChange: (open: boolean) => void;
  totals: PortfolioTotals;
  positions: ProjectPosition[];
  overdueWeeklies: DashboardWeeklyReportSummary[];
  overdueMonthlies: DashboardMonthlyReportSummary[];
  contacts: Contact[];
  portfolioBasisNote: string;
}) {
  /* Content stays mounted through the close animation — cleared the instant
     `selection` goes to `null` would blank the modal's title/body while it
     is still visibly closing. Same pattern as the Project Workspace. */
  const [rendered, setRendered] = React.useState(selection);
  if (selection !== null && selection !== rendered) {
    setRendered(selection);
  }
  const open = selection !== null;
  if (!rendered) return null;

  return (
    <DetailModal open={open} onOpenChange={onOpenChange} size="compact" title={TITLE[rendered]} description={SUBTITLE[rendered]}>
      {rendered === "portfolio" && (
        <PortfolioProgressContent totals={totals} positions={positions} portfolioBasisNote={portfolioBasisNote} />
      )}
      {rendered === "coverage" && <ReportingCoverageContent totals={totals} positions={positions} />}
      {rendered === "onTrack" && <ProjectsOnTrackContent positions={positions} />}
      {rendered === "variance" && <ScheduleVarianceContent positions={positions} />}
      {rendered === "overdue" && (
        <OverdueReportsContent
          positions={positions}
          overdueWeeklies={overdueWeeklies}
          overdueMonthlies={overdueMonthlies}
          contacts={contacts}
        />
      )}
    </DetailModal>
  );
}
