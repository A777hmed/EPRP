import Link from "next/link";

import { SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
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

/* ========================================================================== */
/*  Operational workspace primitives                                          */
/*                                                                            */
/*  Phase 2 of the unified Reporting visual system, and PRESENTATION ONLY.     */
/*                                                                            */
/*  Weekly and Monthly each grew their own screen chrome: Weekly renders the   */
/*  full controlled-document identity (logos, QR, navy band, document number)  */
/*  above the workspace, while Monthly renders a hand-rolled header, tab strip */
/*  and panel card out of hardcoded hex in `globals.css`. The result reads as  */
/*  two products, and the Monthly half had no dark-theme definition at all —   */
/*  `.monthly-ws-panel` is `background: white` with no `.dark` override, so    */
/*  its panels stayed white on the dark ground.                               */
/*                                                                            */
/*  These five primitives are the shared vocabulary both tiers now use for the */
/*  SCREEN workspace. They own no state, fetch nothing, and decide nothing:    */
/*  every value is a prop from the screen that already had it. The full        */
/*  controlled-document presentation — EPROM and client branding, QR, document */
/*  number, signatories, footer — stays in Preview/Print, which is where a     */
/*  reader wants it and where it does not compete with the work.              */
/* ========================================================================== */

export interface ReportWorkspaceHeaderProps {
  /** Kicker above the title, e.g. "Monthly Workspace". */
  eyebrow: string;
  /** Caller-composed, e.g. "PSAIM — September 2026". Never a raw id. */
  title: string;
  /** Document number. Monospace, beside the badges; omitted when absent. */
  reportNumber?: string;
  /** Status chips the screen has already resolved. */
  badges?: React.ReactNode;
  /** Screen actions. Hidden in print — they are furniture, not document. */
  actions?: React.ReactNode;
}

/**
 * The operational header of a report workspace.
 *
 * Deliberately compact: `ReportContextHeader` directly above it already carries
 * project, period, status and last-updated, so this states what the screen is
 * and what can be done on it, and repeats none of that.
 */
export function ReportWorkspaceHeader({
  eyebrow,
  title,
  reportNumber,
  badges,
  actions,
}: ReportWorkspaceHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-[0.625rem] font-bold tracking-[0.11em] text-muted-foreground uppercase">
          {eyebrow}
        </p>
        <h1
          className="mt-1 truncate text-xl font-bold text-primary"
          title={title}
        >
          {title}
        </h1>
        {(reportNumber || badges) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {reportNumber && (
              <span className="font-mono font-semibold">{reportNumber}</span>
            )}
            {badges}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>
      )}
    </div>
  );
}

export interface ReportPanelNavItem {
  key: string;
  label: string;
}

export interface ReportPanelNavProps {
  items: ReportPanelNavItem[];
  value: string;
  onValueChange: (key: string) => void;
  /** Names the group for assistive technology. */
  label: string;
  /** One line about the active panel, rendered under the strip. */
  hint?: string;
}

/**
 * A report's own sub-sections.
 *
 * State-driven rather than link-driven, because that is what the Monthly
 * workspace already does and changing it would be a navigation change, which
 * this pass does not make. Rendered as real buttons so keyboard access and
 * focus states come from the platform rather than being re-invented.
 */
export function ReportPanelNav({
  items,
  value,
  onValueChange,
  label,
  hint,
}: ReportPanelNavProps) {
  return (
    <div className="print:hidden">
      <nav
        aria-label={label}
        className="flex flex-wrap gap-1 rounded-lg border bg-card p-1"
      >
        {items.map((item) => {
          const isActive = item.key === value;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={isActive ? "true" : undefined}
              onClick={() => onValueChange(item.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      {hint && <p className="mt-2 px-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export interface ReportSectionProps {
  title: string;
  /** The one-line "what this section is for" note. */
  hint?: string;
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}

/**
 * One numbered-report section, on the platform card.
 *
 * Wraps the shared `SectionCard` so a reporting section is the same object as
 * every other section in the product, and tints only the title to the EPROM
 * navy that the printed report's section bands use. Nothing about the section's
 * CONTENT is touched — existing tables, grids and editors keep their own
 * markup and classes.
 */
export function ReportSection({
  title,
  hint,
  action,
  className,
  contentClassName,
  children,
}: ReportSectionProps) {
  return (
    <SectionCard
      title={title}
      description={hint}
      action={action}
      className={cn("[&_[data-slot=card-title]]:text-primary", className)}
      contentClassName={contentClassName}
    >
      {children}
    </SectionCard>
  );
}

export interface ReportViewerFact {
  label: string;
  value: React.ReactNode;
}

export interface ReportViewerStripProps {
  /** e.g. "Weekly Workspace" or "Monthly Department Input". */
  title: string;
  facts: ReportViewerFact[];
  /** Whether this viewer may write here, and the sentence explaining it. */
  access: { canEdit: boolean; message: string };
}

/**
 * "Who am I here, and may I write?" — resolved by the server, stated once.
 *
 * Weekly and Monthly both answered this question in their own markup with the
 * same four facts. One component so the answer reads identically in both.
 */
export function ReportViewerStrip({
  title,
  facts,
  access,
}: ReportViewerStripProps) {
  return (
    <div className="border-primary/20 bg-primary/5 rounded-lg border p-3 print:hidden">
      <p className="text-primary mb-2 text-[0.6875rem] font-bold tracking-[0.14em] uppercase">
        {title}
      </p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{fact.label}</dt>
            <dd className="truncate text-sm font-medium">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <p
        className={cn(
          "mt-2 text-xs",
          access.canEdit ? "text-success" : "text-warning"
        )}
      >
        {access.message}
      </p>
    </div>
  );
}

export interface ReportPeriodSwitcherItem {
  id: string;
  label: string;
  href: string;
  active: boolean;
}

export interface ReportPeriodSwitcherProps {
  /** The tier being switched within, e.g. "Monthly". */
  label: string;
  items: ReportPeriodSwitcherItem[];
  /** Trailing action, e.g. "new report". */
  action?: React.ReactNode;
}

/**
 * Move between reporting periods of the same project and tier.
 *
 * Screen furniture, so it is hidden in print. Kept as a first-class primitive
 * because it is the one genuinely useful thing the old Monthly in-page app bar
 * carried that nothing else on the page offered.
 */
export function ReportPeriodSwitcher({
  label,
  items,
  action,
}: ReportPeriodSwitcherProps) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 print:hidden">
      <span className="text-[0.625rem] font-bold tracking-[0.11em] text-muted-foreground uppercase">
        {label}
      </span>
      <nav aria-label={`${label} reporting periods`} className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            prefetch={false}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
              item.active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
