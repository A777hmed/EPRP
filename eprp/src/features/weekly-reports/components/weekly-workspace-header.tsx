"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

import { StatusBadge } from "@/components/shared";
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

/** Shared document identity for Weekly detail, workspace, preview, and print. */
export function WeeklyWorkspaceHeader({
  report,
  project,
  actions,
  viewerName,
  viewerRoleLabel,
  mode = "detail",
  effectiveScope,
  canEdit,
  editBlockedReason,
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

        {mode === "workspace" && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="mb-2 text-xs font-bold tracking-[0.14em] text-primary uppercase">
              Weekly Workspace
            </p>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Current User">{viewerName ?? "Current user"}</Fact>
              <Fact label="Role">{viewerRoleLabel ?? "Resolved project role"}</Fact>
              <Fact label="Lifecycle Status">{status.label}</Fact>
              <Fact label="Effective Scope">{effectiveScope ?? "Project scope"}</Fact>
            </dl>
            <p className={`mt-2 text-xs ${canEdit ? "text-success" : "text-warning"}`}>
              {canEdit ? "Editing is available for your resolved Weekly scope." : editBlockedReason ?? "This workspace is read-only for the current user."}
            </p>
          </div>
        )}

        {actions && <div className="flex flex-wrap justify-end gap-2 print:hidden">{actions}</div>}
      </div>
    </header>
  );
}
