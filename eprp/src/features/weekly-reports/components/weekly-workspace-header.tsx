"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

import { StatusBadge } from "@/components/shared";
import {
  ReportViewerStrip,
  ReportWorkspaceHeader,
} from "@/features/projects/components/sections/project-reporting-shell";
import { siteConfig } from "@/config/site";
import { useMasterData } from "@/features/master-data";
import { REPORT_STATUS_META } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/formatters";
import type { Client, Project, WeeklyReport } from "@/types";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

function Logo({ src, alt }: { src?: string; alt: string }) {
  if (!src) return null;
  return (
    <Image
      src={src}
      alt={alt}
      width={180}
      height={64}
      unoptimized
      className="h-12 w-auto max-w-44 object-contain"
    />
  );
}

export interface WeeklyWorkspaceHeaderProps {
  report: WeeklyReport;
  project: Project | null;
  actions?: React.ReactNode;
  viewerName?: string;
  viewerRoleLabel?: string;
  mode?: "detail" | "workspace" | "preview";
  effectiveScope?: string;
  canEdit?: boolean;
  editBlockedReason?: string;
  qrHref?: string;
}

/**
 * The full controlled-document identity: EPROM and client branding, the QR to
 * the report archive, the navy title band, the document number, and the eight
 * report facts.
 *
 * THIS MARKUP IS UNCHANGED and stays that way. It is what Weekly detail,
 * preview and print render, and the print sprint walks it — so the split below
 * takes the SCREEN WORKSPACE off it rather than editing it.
 */
function WeeklyDocumentHeader({
  report,
  project,
  actions,
  mode = "detail",
  qrHref,
}: WeeklyWorkspaceHeaderProps) {
  const { records: clients } = useMasterData("client");
  const { records: contacts } = useMasterData("contact");
  const client = clients.find(
    (record) => record.id === project?.clientId
  ) as Client | undefined;
  const preparedBy = contacts.find(
    (record) => record.id === report.preparedByContactId
  );
  const status = REPORT_STATUS_META[report.status];
  const origin = React.useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => ""
  );
  const qrTarget = qrHref ?? `/weekly-reports/${report.id}`;
  const qrValue = origin ? new URL(qrTarget, origin).toString() : qrTarget;

  const clientLogo = project?.branding.clientLogoRef ?? client?.logoRef;
  const clientLabel = client?.shortName ?? client?.name ?? "Client";
  const title = "Weekly Project Progress Report";

  return (
    <header className="overflow-hidden rounded-xl border bg-card shadow-sm print:rounded-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-5 px-5 py-4 print:px-0 print:pt-0">
        <Logo src={siteConfig.logo.full} alt="EPROM" />

        <div className="ml-auto flex items-center gap-4">
          {clientLogo ? (
            <Logo src={clientLogo} alt={`${clientLabel} logo`} />
          ) : (
            <div
              aria-label={`${clientLabel} logo not provided`}
              className="flex h-12 min-w-24 items-center justify-center rounded-md border bg-muted px-3 text-xs font-semibold text-muted-foreground"
            >
              {clientLabel}
            </div>
          )}

          {project?.branding.includeQrCode !== false && qrValue && (
            <div className="flex items-center gap-2 rounded-lg border bg-background p-2">
              <QRCodeSVG value={qrValue} size={58} level="M" aria-label="Weekly report QR code" />
              <p className="hidden max-w-28 text-[0.6875rem] leading-tight font-medium sm:block print:block">
                Scan to access report/archive
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0b3f7c] px-5 py-3 text-white print:px-3">
        <div>
          <p className="text-[0.6875rem] font-semibold tracking-[0.16em] uppercase text-white/70">
            {mode === "workspace" ? "Weekly Workspace" : "Weekly Reports"}
          </p>
          <h1 className="text-lg font-semibold tracking-wide uppercase sm:text-xl">
            {title}
          </h1>
        </div>
        <div className="text-right">
          <p className="text-[0.6875rem] text-white/70">Report ID / Document No.</p>
          <p className="font-mono text-xs font-semibold">{report.reportNumber}</p>
        </div>
      </div>

      <div className="space-y-4 p-5 print:px-0 print:pb-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <Fact label="Project">
            {project ? (
              <Link href={`/projects/${project.id}`} className="hover:underline" title={project.name}>
                {project.name}
              </Link>
            ) : "—"}
          </Fact>
          <Fact label="Project Code">
            <span className="font-mono text-xs">{project?.code ?? "—"}</span>
          </Fact>
          <Fact label="Client">{client?.name ?? "—"}</Fact>
          <Fact label="Week Number">Week {report.weekNumber}</Fact>
          <Fact label="Reporting Period">
            {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
          </Fact>
          <Fact label="Report Status">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </Fact>
          <Fact label="Prepared By">{preparedBy?.name ?? "Not recorded"}</Fact>
          <Fact label="Last Updated">{formatDateTime(report.updatedAt)}</Fact>
        </dl>

        {actions && <div className="flex flex-wrap justify-end gap-2 print:hidden">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * Weekly report identity, in the presentation the surface actually needs.
 *
 * `workspace` is where the work happens, so it gets the compact operational
 * header shared with Monthly — the same `ReportWorkspaceHeader` and
 * `ReportViewerStrip` the Monthly workspaces use, so the two tiers read as one
 * product. `detail` and `preview` keep the full controlled-document header
 * above, unchanged: those are the report as a reader and a printer want it.
 *
 * The props are the same in both directions, so no call site changed.
 */
export function WeeklyWorkspaceHeader(props: WeeklyWorkspaceHeaderProps) {
  const {
    report,
    actions,
    viewerName,
    viewerRoleLabel,
    mode = "detail",
    effectiveScope,
    canEdit,
    editBlockedReason,
  } = props;

  if (mode !== "workspace") return <WeeklyDocumentHeader {...props} />;

  const status = REPORT_STATUS_META[report.status];

  return (
    <div className="space-y-4">
      {/* Project, week, period and lifecycle status are stated once, by
          `ReportContextHeader` above. This is the document. */}
      <ReportWorkspaceHeader
        eyebrow="Weekly Workspace"
        title="Weekly Project Progress Report"
        reportNumber={report.reportNumber}
        actions={actions}
      />

      <ReportViewerStrip
        title="Access & Scope"
        facts={[
          { label: "Current User", value: viewerName ?? "Current user" },
          { label: "Role", value: viewerRoleLabel ?? "Resolved project role" },
          { label: "Lifecycle Status", value: status.label },
          { label: "Effective Scope", value: effectiveScope ?? "Project scope" },
        ]}
        access={{
          canEdit: Boolean(canEdit),
          message: canEdit
            ? "Editing is available for your resolved Weekly scope."
            : (editBlockedReason ??
              "This workspace is read-only for the current user."),
        }}
      />
    </div>
  );
}
