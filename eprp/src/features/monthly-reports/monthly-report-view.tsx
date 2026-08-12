"use client";
/* Monthly data is loaded from the browser service after mount. */
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, FilePlus2, Pencil, Plus, Printer, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { format } from "date-fns";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { PRIORITY_META, REPORT_STATUS_META } from "@/lib/constants";
import { getMonthLabel } from "@/lib/reporting";
import { monthlyReportService } from "@/services/monthly-report-service";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import { siteConfig } from "@/config/site";
import { useMasterData } from "@/features/master-data";
import { useHierarchyTerms } from "@/features/weekly-reports/use-hierarchy-terms";
import type { Client, MonthlyComment, MonthlyPlanItem, MonthlyReport, Project, WeeklyReport } from "@/types";
import { MonthlyAnalytics } from "./monthly-analytics";
import { MONTHLY_UPDATE_TYPE_OPTIONS, MonthlyCommentForm } from "./monthly-comment-form";

const typeLabels = Object.fromEntries(MONTHLY_UPDATE_TYPE_OPTIONS) as Record<MonthlyComment["updateType"], string>;

function SectionTitle({ number, title, note }: { number: number; title: string; note?: string }) {
  return <div className="monthly-section-title-row"><h2><span>{number} · {title}</span></h2>{note && <p>{note}</p>}</div>;
}

function ReportSection({ number, title, note, children, className = "" }: { number: number; title: string; note?: string; children: React.ReactNode; className?: string }) {
  return <section className={`monthly-section ${className}`}><SectionTitle number={number} title={title} note={note} />{children}</section>;
}

function Header({ report, project }: { report: MonthlyReport; project: Project | null }) {
  const { records: clients } = useMasterData("client");
  const client = clients.find((record) => record.id === project?.clientId) as Client | undefined;
  const clientLogo = project?.branding.clientLogoRef ?? client?.logoRef;
  const qrValue = typeof window === "undefined" ? `/monthly-reports/${report.id}` : `${window.location.origin}/monthly-reports/${report.id}`;

  return <header className="monthly-report-header monthly-print-header">
    <div className="monthly-brand-row">
      <Image src={siteConfig.logo.full} alt="EPROM" width={220} height={76} unoptimized />
      <div className="monthly-header-right">
        {clientLogo ? <Image src={clientLogo} alt={`${client?.name ?? "Client"} logo`} width={150} height={54} unoptimized className="monthly-client-logo" /> : <span className="monthly-client-placeholder">{client?.shortName ?? client?.name ?? "Client"}</span>}
        {project?.branding.includeQrCode !== false && <div className="monthly-qr-panel"><QRCodeSVG value={qrValue} size={54} level="M" /><span>Scan to access<br />archive</span></div>}
      </div>
    </div>
    <div className="monthly-title-band"><div><p>Monthly Reports</p><h1>Monthly Project Progress Report</h1></div><div className="monthly-document-number"><span>Doc. No.</span><b>{report.reportNumber}</b></div></div>
  </header>;
}

function CommentList({ comments, contactName, compact = false }: { comments: MonthlyComment[]; contactName: (id: string | undefined, fallback?: string) => string; compact?: boolean }) {
  if (!comments.length) return <div className="monthly-empty-row">No items recorded for this section.</div>;
  return <div className={compact ? "monthly-comment-list compact" : "monthly-comment-list"}>{comments.map((comment) => <article className="monthly-comment-card" key={comment.id}>
    <div className="monthly-comment-meta"><b>{typeLabels[comment.updateType]}</b><StatusBadge tone={PRIORITY_META[comment.priority].tone}>{PRIORITY_META[comment.priority].label}</StatusBadge>{comment.sourceKind === "weekly" && <span>W{comment.weekNumber}</span>}{comment.sourceKind === "monthly_manual" && <span>Manual Monthly</span>}</div>
    <p className="monthly-comment-text">{comment.presentationText || comment.originalText}</p>
    <p className="monthly-comment-author">Added by: {contactName(comment.createdByContactId)} · Created: {new Date(comment.createdAt).toLocaleString()}{comment.updatedByContactId && <> · Last edited by: {contactName(comment.updatedByContactId)}</>}</p>
  </article>)}</div>;
}

function ManagedCommentList({
  reportId,
  comments,
  contactName,
  project,
  departments,
  disciplines,
  contacts,
  compact = false,
  editable = false,
  onSaved,
}: {
  reportId: string;
  comments: MonthlyComment[];
  contactName: (id: string | undefined, fallback?: string) => string;
  project: Project | null;
  departments: { id: string; name: string }[];
  disciplines: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
  compact?: boolean;
  editable?: boolean;
  onSaved?: () => Promise<void>;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  if (!comments.length) return <div className="monthly-empty-row">No items recorded for this section.</div>;

  const toggleIncluded = async (comment: MonthlyComment) => {
    if (!onSaved) return;
    try {
      await monthlyReportService.saveComment(reportId, { ...commentToInput(comment), includeInFinal: !comment.includeInFinal });
      await onSaved();
      toast.success(comment.includeInFinal ? "Monthly item excluded." : "Monthly item restored.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Monthly item.");
    }
  };

  const remove = async (comment: MonthlyComment) => {
    if (!onSaved) return;
    try {
      await monthlyReportService.deleteComment(reportId, comment.id);
      await onSaved();
      toast.success("Monthly item removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove Monthly item.");
    }
  };

  return <div className={compact ? "monthly-comment-list compact" : "monthly-comment-list"}>{comments.map((comment) => <article className={`monthly-comment-card ${comment.includeInFinal ? "" : "excluded"}`} key={comment.id}>
    {editingId === comment.id && onSaved ? (
      <MonthlyCommentForm reportId={reportId} project={project} departments={departments} disciplines={disciplines} contacts={contacts} comment={comment} onSaved={onSaved} onCancel={() => setEditingId(null)} />
    ) : (
      <>
        <div className="monthly-comment-meta"><b>{typeLabels[comment.updateType]}</b><StatusBadge tone={PRIORITY_META[comment.priority].tone}>{PRIORITY_META[comment.priority].label}</StatusBadge><StatusBadge tone={comment.includeInFinal ? "success" : "neutral"}>{comment.includeInFinal ? "Included" : "Excluded"}</StatusBadge>{comment.sourceKind === "weekly" && <span>Weekly W{comment.weekNumber}</span>}{comment.sourceKind === "monthly_manual" && <span>Manual Monthly</span>}</div>
        <p className="monthly-comment-text">{comment.presentationText || comment.originalText}</p>
        {comment.sourceKind === "weekly" && comment.presentationText && comment.presentationText !== comment.originalText && <p className="monthly-comment-source">Original Weekly: {comment.originalText}</p>}
        <p className="monthly-comment-author">Added by: {contactName(comment.createdByContactId)} - Created: {new Date(comment.createdAt).toLocaleString()}{comment.updatedByContactId && <> - Last edited by: {contactName(comment.updatedByContactId)}</>}</p>
        {editable && onSaved && <div className="monthly-row-actions print:hidden"><Button type="button" variant="outline" size="sm" onClick={() => setEditingId(comment.id)}><Pencil />Edit</Button><Button type="button" variant="outline" size="sm" onClick={() => toggleIncluded(comment)}>{comment.includeInFinal ? <Trash2 /> : <RotateCcw />}{comment.includeInFinal ? "Exclude" : "Restore"}</Button>{comment.sourceKind === "monthly_manual" && <Button type="button" variant="destructive" size="sm" onClick={() => remove(comment)}><Trash2 />Delete</Button>}</div>}
      </>
    )}
  </article>)}</div>;
}

function commentToInput(comment: MonthlyComment) {
  return {
    id: comment.id,
    updateType: comment.updateType,
    originalText: comment.presentationText || comment.originalText,
    presentationText: comment.presentationText,
    departmentId: comment.departmentId,
    systemId: comment.systemId,
    disciplineId: comment.disciplineId,
    priority: comment.priority,
    status: comment.status,
    responsibleContactId: comment.responsibleContactId,
    targetDate: comment.targetDate,
    includeInFinal: comment.includeInFinal,
    escalateToManagement: comment.escalateToManagement,
    isMajorAchievement: comment.isMajorAchievement,
  };
}

function ReportInformation({ report, project, contacts, editable, onSaved }: { report: MonthlyReport; project: Project | null; contacts: { id: string; name: string }[]; editable?: boolean; onSaved?: () => Promise<void> }) {
  const { records: clients } = useMasterData("client");
  const client = clients.find((record) => record.id === project?.clientId) as Client | undefined;
  const preparedBy = contacts.find((record) => record.id === report.preparedByContactId);
  return <ReportSection number={1} title="Report Information" note="Data compiled from Monthly workspace.">
    <div className="monthly-info-grid">
      <InfoField label="Project" value={project?.name ?? "—"} />
      <InfoField label="Report No." value={report.reportNumber} />
      <InfoField label="Client" value={client?.shortName ?? client?.name ?? "—"} />
      <InfoField label="Reporting Month" value={getMonthLabel(report.reportingMonth)} />
      <InfoField label="Prepared By" value={preparedBy?.name ?? "Not recorded"} muted={!preparedBy} />
      <InfoField label="Month-end Status" value={REPORT_STATUS_META[report.status]?.label ?? report.status} status={REPORT_STATUS_META[report.status]?.tone} />
    </div>
    {editable && onSaved && <MonthlyReportInformationEditor report={report} project={project} contacts={contacts} onSaved={onSaved} />}
  </ReportSection>;
}

function MonthlyReportInformationEditor({ report, project, contacts, onSaved }: { report: MonthlyReport; project: Project | null; contacts: { id: string; name: string }[]; onSaved: () => Promise<void> }) {
  const [preparedByContactId, setPreparedByContactId] = React.useState(report.preparedByContactId ?? project?.reportingCoordinatorId ?? "");
  const [reportNumber, setReportNumber] = React.useState(report.reportNumber);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { setPreparedByContactId(report.preparedByContactId ?? project?.reportingCoordinatorId ?? ""); setReportNumber(report.reportNumber); }, [project?.reportingCoordinatorId, report.preparedByContactId, report.reportNumber]);
  const save = async () => { setSaving(true); try { await monthlyReportService.update(report.id, { preparedByContactId, reportNumber }); await onSaved(); toast.success("Monthly report information saved."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save report information."); } finally { setSaving(false); } };
  return <div className="monthly-workspace-editor"><div><b>Authorized editable data</b><span>Project, client and reporting month remain derived from the selected report.</span></div><div className="monthly-workspace-editor-grid"><label>Report No.<input value={reportNumber} onChange={(event) => setReportNumber(event.target.value)} /></label><label>Prepared By<select value={preparedByContactId} onChange={(event) => setPreparedByContactId(event.target.value)}><option value="">Not recorded</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label><Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Report Information"}</Button></div></div>;
}

function InfoField({ label, value, muted = false, status }: { label: string; value: string; muted?: boolean; status?: "success" | "warning" | "danger" | "info" | "neutral" }) {
  return <div className="monthly-info-field"><span>{label}</span>{status ? <StatusBadge tone={status}>{value}</StatusBadge> : <b className={muted ? "muted" : ""}>{value}</b>}</div>;
}

function HsePanel({ weekly }: { weekly?: WeeklyReport }) {
  const items = [["LTI", "—"], ["REC.", "—"], ["F.AID", "—"], ["N.MISS", "—"]];
  return <div className="monthly-hse-panel"><div className="monthly-mini-heading"><span>HSE Status (Cumulative)</span><small>{weekly?.hseStatus ? `Latest: ${weekly.hseStatus.replaceAll("_", " ")}` : "From latest Weekly in month"}</small></div><div className="monthly-hse-grid">{items.map(([label, value]) => <div className="monthly-hse-value" key={label}><b>{value}</b><span>{label}</span></div>)}</div></div>;
}

function MonthlyKpiEditor({ report, onSaved }: { report: MonthlyReport; onSaved: () => Promise<void> }) {
  const [planned, setPlanned] = React.useState(String(report.plannedProgress));
  const [actual, setActual] = React.useState(String(report.actualProgress));
  const [hseStatus, setHseStatus] = React.useState(report.hseStatus ?? "");
  const [qualityStatus, setQualityStatus] = React.useState(report.qualityStatus ?? "");
  const [overallStatus, setOverallStatus] = React.useState(report.overallProgressStatus ?? "");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { setPlanned(String(report.plannedProgress)); setActual(String(report.actualProgress)); setHseStatus(report.hseStatus ?? ""); setQualityStatus(report.qualityStatus ?? ""); setOverallStatus(report.overallProgressStatus ?? ""); }, [report]);
  const save = async () => { const plannedValue = Number(planned); const actualValue = Number(actual); if (!Number.isFinite(plannedValue) || !Number.isFinite(actualValue) || plannedValue < 0 || actualValue < 0 || plannedValue > 100 || actualValue > 100) { toast.error("Planned and Actual progress must be between 0 and 100."); return; } setSaving(true); try { await monthlyReportService.update(report.id, { plannedProgress: plannedValue, actualProgress: actualValue, hseStatus: hseStatus as MonthlyReport["hseStatus"], qualityStatus: qualityStatus as MonthlyReport["qualityStatus"], overallProgressStatus: overallStatus as MonthlyReport["overallProgressStatus"] }); await onSaved(); toast.success("Monthly KPI data saved."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save Monthly KPI data."); } finally { setSaving(false); } };
  return <div className="monthly-workspace-editor"><div><b>Authorized editable data</b><span>Progress and report-level health values are editable here; Weekly breakdown values remain auto-compiled.</span></div><div className="monthly-workspace-editor-grid monthly-kpi-editor-grid"><label>Planned %<input type="number" min="0" max="100" step="0.1" value={planned} onChange={(event) => setPlanned(event.target.value)} /></label><label>Actual %<input type="number" min="0" max="100" step="0.1" value={actual} onChange={(event) => setActual(event.target.value)} /></label><label>HSE Status<select value={hseStatus} onChange={(event) => setHseStatus(event.target.value)}><option value="">Not reported</option>{["excellent", "good", "fair", "at_risk", "critical"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Quality Status<select value={qualityStatus} onChange={(event) => setQualityStatus(event.target.value)}><option value="">Not reported</option>{["excellent", "good", "fair", "at_risk", "critical"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Overall Status<select value={overallStatus} onChange={(event) => setOverallStatus(event.target.value)}><option value="">Auto / not reported</option>{[["ahead", "Ahead"], ["on_track", "On Track"], ["at_risk", "At Risk"], ["behind", "Behind"], ["critical", "Critical"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save KPI Data"}</Button></div></div>;
}

function WeeklyBreakdown({ weeklies }: { weeklies: WeeklyReport[] }) {
  return <ReportSection number={3} title="Weekly Breakdown" note="Cumulative Weekly inputs for this reporting month.">
    {weeklies.length ? <div className="monthly-table-wrap"><table className="monthly-table"><thead><tr><th>Week</th><th>Period</th><th>Planned</th><th>Actual</th><th>SV</th><th>Status</th><th>Drive</th></tr></thead><tbody>{weeklies.map((weekly) => <tr key={weekly.id}><td><b>W{weekly.weekNumber}</b></td><td>{format(new Date(weekly.periodStart), "dd MMM")} – {format(new Date(weekly.periodEnd), "dd MMM")}</td><td className="planned-value">{weekly.plannedProgress.toFixed(1)}%</td><td className="actual-value">{weekly.actualProgress.toFixed(1)}%</td><td className="variance-value">{(weekly.actualProgress - weekly.plannedProgress).toFixed(1)}%</td><td><StatusBadge tone={weekly.actualProgress - weekly.plannedProgress < -3 ? "warning" : "success"}>{weekly.actualProgress - weekly.plannedProgress < -3 ? "Delayed" : "On Schedule"}</StatusBadge></td><td className="drive-cell">{weekly.attachmentIds.length ? "✓" : "—"}</td></tr>)}</tbody></table></div> : <div className="monthly-empty-row">No Weekly Reports fall within this month.</div>}
  </ReportSection>;
}

function ScopeStatus({ comments, departments, systems, disciplines, terms }: { comments: MonthlyComment[]; departments: { id: string; name: string }[]; systems: { id: string; name: string }[]; disciplines: { id: string; name: string }[]; terms: ReturnType<typeof useHierarchyTerms> }) {
  const nameOf = (id: string | undefined, rows: { id: string; name: string }[], fallback = "—") => rows.find((row) => row.id === id)?.name ?? fallback;
  const rows = Array.from(new Map(comments.filter((comment) => comment.departmentId).map((comment) => [`${comment.departmentId}:${comment.systemId ?? ""}:${comment.disciplineId ?? ""}`, comment])).values());
  return <ReportSection number={4} title={`${terms.plural} Status`} note="From latest Weekly — auto-compiled.">
    {rows.length ? <div className="monthly-table-wrap"><table className="monthly-table scope"><thead><tr><th>{terms.singular}</th><th>Status</th><th>Latest Update</th></tr></thead><tbody>{rows.map((comment) => <tr key={comment.id}><td><b>{nameOf(comment.disciplineId, disciplines, "Department update")}</b><small>{nameOf(comment.departmentId, departments)}{comment.systemId ? ` · ${nameOf(comment.systemId, systems)}` : ""}</small></td><td><StatusBadge tone={comment.status === "open" ? "info" : "success"}>{comment.status.replaceAll("_", " ")}</StatusBadge></td><td>{comment.presentationText || comment.originalText}</td></tr>)}</tbody></table></div> : <div className="monthly-empty-row">No reported scope items yet.</div>}
  </ReportSection>;
}

function ClientActions({ comments }: { comments: MonthlyComment[] }) {
  const actions = comments.filter((comment) => comment.updateType === "action");
  return <ReportSection number={5} title="Client Action Items" note="Auto-compiled from client-pending Weekly comments.">
    {actions.length ? <div className="monthly-table-wrap"><table className="monthly-table"><thead><tr><th>Week</th><th>Type</th><th>Action Required From Client</th><th>Status</th></tr></thead><tbody>{actions.map((comment) => <tr key={comment.id}><td><b>{comment.weekNumber ? `W${comment.weekNumber}` : "—"}</b></td><td><span className="monthly-pill">{typeLabels[comment.updateType]}</span></td><td>{comment.presentationText || comment.originalText}</td><td><StatusBadge tone="warning">{comment.status.replaceAll("_", " ")}</StatusBadge></td></tr>)}</tbody></table></div> : <div className="monthly-empty-row">No client action items are recorded.</div>}
  </ReportSection>;
}

function Highlights({ comments }: { comments: MonthlyComment[] }) {
  const items = comments.filter((comment) => comment.updateType !== "action" && comment.updateType !== "next_month_plan");
  return <ReportSection number={6} title="Key Highlights & Issues" note="★ Flagged in Weeklies · imported without changing the Weekly source.">
    {items.length ? <div className="monthly-highlight-list">{items.map((comment) => <div className="monthly-highlight-row" key={comment.id}><b>{comment.weekNumber ? `W${comment.weekNumber}` : "—"}</b><span className="monthly-pill">{typeLabels[comment.updateType]}</span><span>{comment.presentationText || comment.originalText}</span><span className="monthly-remove-mark">×</span></div>)}</div> : <div className="monthly-empty-row">No Weekly highlights or issues have been selected.</div>}
  </ReportSection>;
}

function ManagedClientActions(props: { comments: MonthlyComment[]; reportId: string; project: Project | null; departments: { id: string; name: string }[]; disciplines: { id: string; name: string }[]; contacts: { id: string; name: string }[]; contactName: (id: string | undefined, fallback?: string) => string; onSaved: () => Promise<void> }) {
  const actions = props.comments.filter((comment) => comment.updateType === "action");
  return <ReportSection number={5} title="Client Action Items / Pending Approvals" note="Weekly-sourced items can be excluded or rewritten for Monthly without changing Weekly.">
    <div className="monthly-section-command print:hidden"><MonthlyCommentForm reportId={props.reportId} project={props.project} departments={props.departments} disciplines={props.disciplines} contacts={props.contacts} defaultType="action" buttonLabel="Add Action Item" onSaved={props.onSaved} /></div>
    <ManagedCommentList reportId={props.reportId} comments={actions} contactName={props.contactName} project={props.project} departments={props.departments} disciplines={props.disciplines} contacts={props.contacts} editable onSaved={props.onSaved} />
  </ReportSection>;
}

function ManagedHighlights(props: { comments: MonthlyComment[]; reportId: string; project: Project | null; departments: { id: string; name: string }[]; disciplines: { id: string; name: string }[]; contacts: { id: string; name: string }[]; contactName: (id: string | undefined, fallback?: string) => string; onSaved: () => Promise<void> }) {
  const items = props.comments.filter((comment) => comment.updateType !== "action" && comment.updateType !== "next_month_plan");
  return <ReportSection number={6} title="Key Highlights & Issues" note="Imported Weekly selections and manual Monthly items.">
    <div className="monthly-section-command print:hidden"><MonthlyCommentForm reportId={props.reportId} project={props.project} departments={props.departments} disciplines={props.disciplines} contacts={props.contacts} defaultType="achievement" buttonLabel="Add Highlight / Issue" onSaved={props.onSaved} /></div>
    <ManagedCommentList reportId={props.reportId} comments={items} contactName={props.contactName} project={props.project} departments={props.departments} disciplines={props.disciplines} contacts={props.contacts} editable onSaved={props.onSaved} />
  </ReportSection>;
}

function MonthlyPlanEditor({ reportId, plans, contacts, onSaved }: { reportId: string; plans: MonthlyPlanItem[]; contacts: { id: string; name: string }[]; onSaved: () => Promise<void> }) {
  const [title, setTitle] = React.useState("");
  const [targetDate, setTargetDate] = React.useState("");
  const [ownerContactId, setOwnerContactId] = React.useState("");
  const [status, setStatus] = React.useState<MonthlyPlanItem["status"]>("not_started");
  const [saving, setSaving] = React.useState(false);
  const save = async () => { if (!title.trim()) { toast.error("Milestone title is required."); return; } setSaving(true); try { await monthlyReportService.savePlanItem(reportId, { title, targetDate: targetDate || undefined, ownerContactId: ownerContactId || undefined, status, sortOrder: plans.length }); await onSaved(); setTitle(""); setTargetDate(""); setOwnerContactId(""); setStatus("not_started"); toast.success("Monthly milestone saved."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save Monthly milestone."); } finally { setSaving(false); } };
  const remove = async (id: string) => { try { await monthlyReportService.deletePlanItem(reportId, id); await onSaved(); toast.success("Monthly milestone removed."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not remove Monthly milestone."); } };
  return <div className="monthly-workspace-editor monthly-plan-editor"><div><b>Authorized editable data</b><span>Monthly milestones are editable in Workspace and remain visible in the Outlook section.</span></div>{plans.length > 0 && <div className="monthly-plan-edit-list">{plans.map((plan) => <div key={plan.id}><span>{plan.title}</span><small>{plan.targetDate ? format(new Date(plan.targetDate), "dd MMM yyyy") : "No target date"}</small><button type="button" onClick={() => remove(plan.id)} aria-label={`Remove ${plan.title}`}>Remove</button></div>)}</div>}<div className="monthly-workspace-editor-grid monthly-plan-editor-grid"><label>Milestone / Plan Item<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a Monthly milestone" /></label><label>Target Date<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label><label>Owner<select value={ownerContactId} onChange={(event) => setOwnerContactId(event.target.value)}><option value="">Not specified</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as MonthlyPlanItem["status"])}>{["not_started", "in_progress", "completed", "delayed", "pending"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Add Milestone"}</Button></div></div>;
}

function ManagedMonthlyPlanEditor({ reportId, plans, contacts, onSaved }: { reportId: string; plans: MonthlyPlanItem[]; contacts: { id: string; name: string }[]; onSaved: () => Promise<void> }) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [targetDate, setTargetDate] = React.useState("");
  const [ownerContactId, setOwnerContactId] = React.useState("");
  const [status, setStatus] = React.useState<MonthlyPlanItem["status"]>("not_started");
  const [remarks, setRemarks] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const reset = () => { setEditingId(null); setTitle(""); setStartDate(""); setTargetDate(""); setOwnerContactId(""); setStatus("not_started"); setRemarks(""); };
  const edit = (plan: MonthlyPlanItem) => { setEditingId(plan.id); setTitle(plan.title); setStartDate(plan.startDate ?? ""); setTargetDate(plan.targetDate ?? ""); setOwnerContactId(plan.ownerContactId ?? ""); setStatus(plan.status); setRemarks(plan.remarks ?? ""); };
  const save = async () => {
    if (!title.trim()) { toast.error("Milestone title is required."); return; }
    setSaving(true);
    try {
      await monthlyReportService.savePlanItem(reportId, { id: editingId ?? undefined, title, startDate: startDate || undefined, targetDate: targetDate || undefined, ownerContactId: ownerContactId || undefined, status, remarks: remarks.trim() || undefined, sortOrder: editingId ? plans.find((plan) => plan.id === editingId)?.sortOrder ?? plans.length : plans.length });
      await onSaved();
      reset();
      toast.success(editingId ? "Monthly milestone updated." : "Monthly milestone saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Monthly milestone.");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: string) => { try { await monthlyReportService.deletePlanItem(reportId, id); await onSaved(); toast.success("Monthly milestone removed."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not remove Monthly milestone."); } };
  return <div className="monthly-workspace-editor monthly-plan-editor"><div><b>Authorized editable data</b><span>Monthly milestones and focus remarks remain visible in the Outlook section.</span></div>{plans.length > 0 && <div className="monthly-plan-edit-list">{plans.map((plan) => <div key={plan.id}><span>{plan.title}</span><small>{plan.targetDate ? format(new Date(plan.targetDate), "dd MMM yyyy") : "No target date"}</small><button type="button" onClick={() => edit(plan)} aria-label={`Edit ${plan.title}`}>Edit</button><button type="button" onClick={() => remove(plan.id)} aria-label={`Remove ${plan.title}`}>Remove</button></div>)}</div>}<div className="monthly-workspace-editor-grid monthly-plan-editor-grid"><label>Milestone / Plan Item<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a Monthly milestone" /></label><label>Start Date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Target Date<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label><label>Owner<select value={ownerContactId} onChange={(event) => setOwnerContactId(event.target.value)}><option value="">Not specified</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as MonthlyPlanItem["status"])}>{["not_started", "in_progress", "completed", "delayed", "pending"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Focus / Remarks<input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional focus, target, or dependency" /></label><Button type="button" onClick={save} disabled={saving}>{saving ? "Saving..." : editingId ? "Update Milestone" : "Add Milestone"}</Button>{editingId && <Button type="button" variant="outline" onClick={reset}>Cancel Edit</Button>}</div></div>;
}

function NextMonthOutlook({ plans, comments, contacts, reportingMonth, editable, reportId, onSaved, project, departments, disciplines }: { plans: MonthlyPlanItem[]; comments: MonthlyComment[]; contacts: { id: string; name: string }[]; reportingMonth: string; editable?: boolean; reportId?: string; onSaved?: () => Promise<void>; project: Project | null; departments: { id: string; name: string }[]; disciplines: { id: string; name: string }[] }) {
  const nextMonthComments = comments.filter((comment) => comment.updateType === "next_month_plan");
  const nameOf = (id?: string) => contacts.find((contact) => contact.id === id)?.name ?? "Project Control";
  const nextMonthDate = new Date(`${reportingMonth.slice(0, 7)}-01T00:00:00`);
  nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
  return <ReportSection number={7} title={`Next Month Outlook — ${format(nextMonthDate, "MMMM yyyy")}`} note="Milestones from Monthly plans · editable in Workspace.">
    <div className="monthly-outlook-grid"><div className="monthly-outlook-panel"><div className="monthly-mini-heading"><span>Planned Milestones</span></div>{plans.length ? <div className="monthly-milestones">{plans.map((plan) => <div className="monthly-milestone" key={plan.id}><b>{plan.targetDate ? format(new Date(plan.targetDate), "dd MMM") : "—"}</b><span>{plan.title}</span><small>{nameOf(plan.ownerContactId)}</small></div>)}</div> : <div className="monthly-empty-row">No milestones have been recorded.</div>}</div><div className="monthly-outlook-panel"><div className="monthly-mini-heading"><span>Focus & Targets</span><span>Planned % Target <b className="monthly-target-value">—</b></span></div>{nextMonthComments.length ? <div className="monthly-focus-copy">{nextMonthComments.map((comment) => <p key={comment.id}>{comment.presentationText || comment.originalText}</p>)}</div> : <div className="monthly-focus-empty">Key priorities, risks to watch, and resource plans for next month…</div>}</div></div>
    {editable && reportId && onSaved && <><div className="monthly-section-command print:hidden"><MonthlyCommentForm reportId={reportId} project={project} departments={departments} disciplines={disciplines} contacts={contacts} defaultType="next_month_plan" buttonLabel="Add Focus / Target" onSaved={onSaved} /></div><ManagedMonthlyPlanEditor reportId={reportId} plans={plans} contacts={contacts} onSaved={onSaved} /></>}
  </ReportSection>;
}

function ApprovalArea({ report, contacts, editable, onSaved }: { report: MonthlyReport; contacts: { id: string; name: string }[]; editable?: boolean; onSaved?: () => Promise<void> }) {
  const nameOf = (id?: string) => contacts.find((contact) => contact.id === id)?.name ?? "Name";
  const [summary, setSummary] = React.useState(report.executiveSummary ?? "");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setSummary(report.executiveSummary ?? ""), [report.executiveSummary]);
  const saveSummary = async () => { setSaving(true); try { await monthlyReportService.update(report.id, { executiveSummary: summary }); await onSaved?.(); toast.success("Executive Summary saved."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save Executive Summary."); } finally { setSaving(false); } };
  return <><ReportSection number={8} title="Executive Summary" note="Management narrative for the reporting month.">{editable ? <div className="monthly-executive-editor"><textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Summarize the month for management." /><Button type="button" onClick={saveSummary} disabled={saving}>{saving ? "Saving…" : "Save Executive Summary"}</Button></div> : <div className="monthly-executive-summary">{report.executiveSummary || "No executive summary recorded for this month."}</div>}</ReportSection><div className="monthly-approval-strip"><b>APPROVAL</b><span>Draft saved</span><i>›</i><span>Approved</span><i>›</i><span>Published</span></div><div className="monthly-signoff-grid">{[["Prepared By", report.preparedByContactId], ["Reviewed By", report.reviewedByContactId], ["Approved By", report.approvedByContactId]].map(([label, id]) => <div className="monthly-signoff" key={label as string}><b>{label}</b><span>{nameOf(id as string | undefined)}</span><small>Signature __________________</small></div>)}</div></>;
}

const _monthlyWorkspaceRepairRefs = [ManagedClientActions, ManagedHighlights, MonthlyPlanEditor];
void _monthlyWorkspaceRepairRefs;

function MonthlyTopBar({ report, project, reports }: { report: MonthlyReport; project: Project | null; reports: MonthlyReport[] }) {
  return <div className="monthly-app-chrome print:hidden"><div className="monthly-app-bar"><Image src={siteConfig.logo.full} alt="EPROM" width={110} height={38} unoptimized /><strong>Monthly Progress Report</strong><span className="monthly-app-divider" /><span className="monthly-project-selector">{project?.name ?? project?.shortName ?? project?.code ?? "Project"} <span>⌄</span></span><span className="monthly-autosave">● Auto-saved</span><Link href="/weekly-reports" className="monthly-chrome-button">← Weekly Report</Link><Link href={`/monthly-reports/${report.id}/preview`} className="monthly-chrome-button"><Printer /> Print / Export PDF</Link></div><div className="monthly-month-tabs"><span>MONTHLY TABS</span>{reports.slice(0, 3).map((item) => <Link key={item.id} className={item.id === report.id ? "active" : ""} href={`/monthly-reports/${item.id}`}>{getMonthLabel(item.reportingMonth)} <i>●</i></Link>)}<Link href="/monthly-reports/new" aria-label="Create Monthly Report"><Plus /></Link></div></div>;
}

export function MonthlyReportsView() {
  const [reports, setReports] = React.useState<MonthlyReport[] | undefined>();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [search, setSearch] = React.useState("");
  const [projectFilter, setProjectFilter] = React.useState("");
  const [monthFilter, setMonthFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const { records: contacts } = useMasterData("contact");
  React.useEffect(() => { Promise.all([monthlyReportService.list(), projectService.getProjects()]).then(([nextReports, nextProjects]) => { setReports(nextReports); setProjects(nextProjects); }).catch((error) => toast.error(error.message)); }, []);
  if (!reports) return <LoadingState label="Loading Monthly Reports…" />;
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? "Not recorded";
  const contactName = (id?: string) => contacts.find((contact) => contact.id === id)?.name ?? "Not recorded";
  const filtered = reports.filter((report) => (!search || `${report.reportNumber} ${projectName(report.projectId)} ${contactName(report.preparedByContactId)}`.toLowerCase().includes(search.toLowerCase())) && (!projectFilter || report.projectId === projectFilter) && (!monthFilter || report.reportingMonth.slice(0, 7) === monthFilter) && (!statusFilter || report.status === statusFilter));
  const counts = { total: reports.length, draft: reports.filter((report) => report.status === "draft").length, review: reports.filter((report) => report.status === "under_review").length, approved: reports.filter((report) => ["approved", "published", "finalized"].includes(report.status)).length };
  return <div className="monthly-list-view"><div className="monthly-list-header"><div><p className="monthly-eyebrow">Reporting register</p><h1>Monthly Reports</h1><span>Manage and review project Monthly Progress Reports.</span></div><Button asChild><Link href="/monthly-reports/new"><FilePlus2 />New Monthly Report</Link></Button></div><div className="monthly-counter-row">{[["Total Reports", counts.total], ["Draft", counts.draft], ["Under Review", counts.review], ["Approved / Published", counts.approved]].map(([label, value]) => <div className="monthly-counter" key={label as string}><span>{label}</span><b>{value}</b></div>)}</div><div className="monthly-list-toolbar"><input aria-label="Search Monthly Reports" placeholder="Search report no., project, prepared by" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Filter project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><input aria-label="Filter month" type="month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} /><select aria-label="Filter status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{Object.entries(REPORT_STATUS_META).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select></div><div className="monthly-list-card monthly-register"><div className="monthly-register-head"><span>Report No.</span><span>Project</span><span>Reporting Month</span><span>Prepared By</span><span>Last Updated</span><span>Status</span><span>Actions</span></div>{filtered.length ? filtered.map((report) => <div className="monthly-register-row" key={report.id}><b>{report.reportNumber}</b><span>{projectName(report.projectId)}</span><span>{getMonthLabel(report.reportingMonth)}</span><span>{contactName(report.preparedByContactId)}</span><span>{new Date(report.updatedAt).toLocaleDateString()}</span><StatusBadge tone={REPORT_STATUS_META[report.status]?.tone ?? "neutral"}>{REPORT_STATUS_META[report.status]?.label ?? report.status}</StatusBadge><span className="monthly-register-actions"><Link href={`/monthly-reports/${report.id}`}>Open</Link><Link href={`/monthly-reports/${report.id}/workspace`}>Workspace</Link><Link href={`/monthly-reports/${report.id}/preview`}>Preview</Link></span></div>) : <EmptyState title="No Monthly Reports match these filters" description="Clear a filter or create a new report." icon={FilePlus2} />}</div></div>;
}

export function MonthlyNewView() {
  const router = useRouter();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [month, setMonth] = React.useState(format(new Date(), "yyyy-MM"));
  React.useEffect(() => { projectService.getProjects().then(setProjects); }, []);
  const create = async () => { if (!projectId || !month) { toast.error("Select a project and reporting month."); return; } try { const report = await monthlyReportService.create(projectId, `${month}-01`); await monthlyReportService.compileFromWeeklies(report.id); router.push(`/monthly-reports/${report.id}/workspace`); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create Monthly Report."); } };
  return <div className="monthly-new-view"><div className="monthly-new-header"><p className="monthly-eyebrow">Reporting</p><h1>Create Monthly Report</h1><span>Create a project Monthly Progress Report and automatically import eligible Weekly updates.</span></div><div className="monthly-list-card monthly-create-card"><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Select project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><label>Reporting Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><p>Eligible Weekly updates selected for Monthly reporting will be synchronized automatically.</p><Button onClick={create} disabled={!projectId || !month}><FilePlus2 />Create Monthly Report</Button></div></div>;
}

export function MonthlyReportView({ reportId, mode = "detail" }: { reportId: string; mode?: "detail" | "workspace" | "preview" }) {
  const { records: departments } = useMasterData("department");
  const { records: systems } = useMasterData("system");
  const { records: disciplines } = useMasterData("discipline");
  const { records: contacts } = useMasterData("contact");
  const [report, setReport] = React.useState<MonthlyReport | null>();
  const [project, setProject] = React.useState<Project | null>(null);
  const [comments, setComments] = React.useState<MonthlyComment[]>([]);
  const [weeklies, setWeeklies] = React.useState<WeeklyReport[]>([]);
  const [plans, setPlans] = React.useState<MonthlyPlanItem[]>([]);
  const [projectReports, setProjectReports] = React.useState<MonthlyReport[]>([]);
  const [lastSync, setLastSync] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const load = React.useCallback(async () => { const nextReport = await monthlyReportService.getById(reportId); setReport(nextReport); if (nextReport) { const [nextProject, nextComments, nextPlans, allReports, allWeeklies] = await Promise.all([projectService.getProjectById(nextReport.projectId), monthlyReportService.listComments(nextReport.id), monthlyReportService.listPlanItems(nextReport.id), monthlyReportService.list(nextReport.projectId), weeklyReportService.list()]); setProject(nextProject); setComments(nextComments); setPlans(nextPlans); setProjectReports(allReports); setWeeklies(allWeeklies.filter((weekly) => weekly.projectId === nextReport.projectId && weekly.periodStart.slice(0, 7) === nextReport.reportingMonth.slice(0, 7))); } }, [reportId]);
  React.useEffect(() => { void load(); }, [load]);
  const terms = useHierarchyTerms(project);
  if (report === undefined) return <LoadingState label="Loading Monthly Report…" />;
  if (!report) return <EmptyState title="Monthly Report not found" description="This report is unavailable." icon={FilePlus2} />;
  const clientActions = comments.filter((comment) => comment.updateType === "action");
  const contactName = (id: string | undefined, fallback = "Not recorded") => contacts.find((contact) => contact.id === id)?.name ?? fallback;
  const importedCount = comments.filter((comment) => comment.sourceKind === "weekly").length;
  const compile = async () => { setSyncing(true); try { await monthlyReportService.compileFromWeeklies(report.id); await load(); setLastSync(new Date().toLocaleString()); toast.success("Monthly items updated from Weekly Reports."); } catch (error) { toast.error(error instanceof Error ? error.message : "Compilation failed."); } finally { setSyncing(false); } };
  const previousReports = projectReports.filter((item) => item.id !== report.id).sort((a, b) => b.reportingMonth.localeCompare(a.reportingMonth));
  const latestWeekly = weeklies[weeklies.length - 1];
  const kpis = [["Planned %", `${report.plannedProgress.toFixed(1)}%`, "planned"], ["Actual %", `${report.actualProgress.toFixed(1)}%`, "actual"], ["Variance (SV)", `${report.scheduleVariance > 0 ? "+" : ""}${report.scheduleVariance.toFixed(1)}%`, "variance"], ["Progress This Month", weeklies.length > 1 ? `+${(report.actualProgress - weeklies[0].actualProgress).toFixed(1)} pts` : "—", "progress"], ["Man-hours to Date", latestWeekly?.manHoursToDate?.toLocaleString() ?? "—", "hours"]] as const;

  const sheet = <div className="monthly-report-sheet monthly-print-document"><Header report={report} project={project} /><div className="monthly-report-body"><ReportInformation report={report} project={project} contacts={contacts} editable={mode === "workspace"} onSaved={load} /><ReportSection number={2} title="Month-end KPI Summary" note="Latest cumulative position from Weekly Reports."><div className="monthly-kpi-row">{kpis.map(([label, value, tone]) => <div className={`monthly-kpi ${tone}`} key={label}><span>{label}</span><b>{value}</b></div>)}</div><div className="monthly-trend-hse"><MonthlyAnalytics weeklies={weeklies} comments={comments} departments={departments} scopeLabel={terms.plural} /><HsePanel weekly={latestWeekly} /></div>{mode === "workspace" && <MonthlyKpiEditor report={report} onSaved={load} />}</ReportSection><WeeklyBreakdown weeklies={weeklies} /><ScopeStatus comments={comments} departments={departments} systems={systems} disciplines={disciplines} terms={terms} />{mode === "workspace" && <section className="monthly-section monthly-workspace-comments"><div className="monthly-workspace-heading"><div><b>Monthly Input &amp; Updates</b><span>Add project- or scope-level Monthly updates that were not captured in Weekly reports.</span></div><MonthlyCommentForm reportId={report.id} project={project} departments={departments} disciplines={disciplines} contacts={contacts} onSaved={load} /></div><CommentList comments={comments} contactName={contactName} compact /></section>}<ClientActions comments={clientActions} /><Highlights comments={comments} /><NextMonthOutlook plans={plans} comments={comments} contacts={contacts} reportingMonth={report.reportingMonth} editable={mode === "workspace"} reportId={report.id} onSaved={load} project={project} departments={departments} disciplines={disciplines} /><ApprovalArea report={report} contacts={contacts} editable={mode === "workspace"} onSaved={load} /><footer className="monthly-report-footer"><b>One Team. One Goal. Operational Excellence.</b><span>www.eprom.com.eg</span><span>Page 1 of 1</span></footer></div></div>;

  return <div className={mode === "preview" ? "monthly-preview-stage" : "monthly-screen-stage"}>{mode !== "preview" && <MonthlyTopBar report={report} project={project} reports={[report, ...previousReports]} />}{mode === "preview" && <div className="monthly-preview-tools print:hidden"><Link href={`/monthly-reports/${report.id}`}>← Back to report</Link><Button onClick={() => window.print()}><Printer />Print / Export PDF</Button></div>}{mode !== "preview" && <div className="monthly-sync-strip print:hidden"><div><b>Update from Weekly Reports</b><span>Imports Monthly-selected items from eligible Weekly Reports without creating duplicates.</span><small>{lastSync ? `Last sync: ${lastSync} · ${importedCount} imported items` : `${importedCount} imported items · not synced in this browser session`}</small></div><Button variant="outline" onClick={compile} disabled={syncing}><RefreshCw className={syncing ? "animate-spin" : ""} />{syncing ? "Updating…" : "Update from Weekly Reports"}</Button><div className="monthly-report-actions"><Button asChild><Link href={`/monthly-reports/${report.id}/workspace`}><Plus />Workspace</Link></Button><Button asChild variant="outline"><Link href={`/monthly-reports/${report.id}/preview`}><Eye />Preview</Link></Button></div></div>}{sheet}</div>;
}
