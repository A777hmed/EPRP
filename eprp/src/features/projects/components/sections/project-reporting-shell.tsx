import Link from "next/link";

import { StatusBadge, type StatusTone } from "@/components/shared";
import { cn } from "@/lib/utils";

/**
 * Phase 1 of the unified Reporting visual system: a shared, purely
 * presentational identity strip + report-type switcher for the five
 * project-scoped report screens (Weekly/Monthly detail + workspace,
 * Project Executive). Wraps existing content — it does not replace,
 * reorder, or fetch anything; every value is a prop supplied by the
 * screen that already has it.
 *
 * The `/projects/[projectId]/reporting` list page intentionally does NOT
 * use `ReportTypeTabs`: it already has its own working Weekly/Monthly/
 * Executive tab switcher (`ProjectReportingWorkspace`, `useReportingTab`),
 * which is state-driven (`history.replaceState` + a custom event), not
 * `<Link>`-driven. Swapping in link-based tabs there would not reliably
 * re-sync that switcher (it listens for `popstate`, which a same-page
 * `<Link>` navigation does not fire) — a real behavior risk for zero
 * benefit, since that page already has type-switching. It still gets
 * `ReportContextHeader` for visual consistency with the other five.
 */

export type ReportTypeTab = "weekly" | "monthly" | "executive";

export interface ReportContextHeaderProps {
  /** e.g. "PSAIM-001". Omit rather than guess if unavailable. */
  projectCode?: string;
  /** Project short name or name — never the raw id. */
  projectName: string;
  /** Caller-formatted, e.g. "Week 14 · Aug 18–24" or "August 2026". */
  period?: string;
  status?: { label: string; tone: StatusTone };
  /** Caller-resolved display name, not a contact id. */
  preparedBy?: string;
  /** Caller-formatted date/time string. */
  updatedAt?: string;
}

/**
 * Compact identity strip — project code/name, reporting period, status,
 * and (where the caller already has it) prepared-by/updated-at. Never
 * repeats the full project identity the sidebar already shows; only
 * fields relevant to THIS report render, and a missing value is simply
 * omitted rather than shown as a placeholder.
 */
export function ReportContextHeader({
  projectCode,
  projectName,
  period,
  status,
  preparedBy,
  updatedAt,
}: ReportContextHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg border bg-card px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {projectCode && (
          <span className="shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">
            {projectCode}
          </span>
        )}
        <span className="truncate font-semibold">{projectName}</span>
        {period && (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <span className="truncate text-muted-foreground">{period}</span>
          </>
        )}
      </div>
      {(status || preparedBy || updatedAt) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
          {preparedBy && <span>Prepared by {preparedBy}</span>}
          {updatedAt && <span>Updated {updatedAt}</span>}
        </div>
      )}
    </div>
  );
}

const REPORT_TYPE_TABS: { id: ReportTypeTab; label: string }[] = [
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "executive", label: "Executive" },
];

export interface ReportTypeTabsProps {
  projectId: string;
  active: ReportTypeTab;
}

/**
 * Weekly / Monthly / Executive — always project-scoped, always returning
 * to the project's own Reporting workspace tab, never a global report
 * route. This is new navigation for the four screens that don't already
 * have a way to switch report type without going back first.
 */
export function ReportTypeTabs({ projectId, active }: ReportTypeTabsProps) {
  return (
    <nav aria-label="Report type" className="flex gap-1 border-b">
      {REPORT_TYPE_TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`/projects/${projectId}/reporting?tab=${tab.id}`}
            aria-current={isActive ? "page" : undefined}
            prefetch={false}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export interface ProjectReportingShellProps {
  header: React.ReactNode;
  /** Omit on the Reporting workspace page — see file-level note above. */
  tabs?: React.ReactNode;
  children: React.ReactNode;
}

/** Thin layout wrapper — header, then tabs, then the untouched existing report content. */
export function ProjectReportingShell({
  header,
  tabs,
  children,
}: ProjectReportingShellProps) {
  return (
    <div className="space-y-4">
      {header}
      {tabs}
      {children}
    </div>
  );
}
