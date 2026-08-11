"use client";

import * as React from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { eligibleOwners } from "../project-scope";
import { weeklyReportService, type WeeklyPlanItemInput } from "@/services/weekly-report-service";
import type { Project, WeeklyPlanItem, WeeklyPlanStatus } from "@/types";
import type { WeeklyNameLookup } from "./weekly-department-section";

const NONE = "__none__";
const STATUS: Record<WeeklyPlanStatus, { label: string; tone: StatusTone; color: string }> = {
  not_started: { label: "Not Started", tone: "neutral", color: "bg-slate-300" },
  in_progress: { label: "In Progress", tone: "info", color: "bg-primary" },
  completed: { label: "Completed", tone: "success", color: "bg-success" },
  delayed: { label: "Delayed", tone: "danger", color: "bg-destructive" },
};

interface Draft extends WeeklyPlanItemInput { key: string }
const toDraft = (item: WeeklyPlanItem): Draft => ({ ...item, key: item.id });
const newDraft = (kind: WeeklyPlanItem["kind"], key: string, endDate: string): Draft => ({ key, kind, title: "", startDate: kind === "next_week" ? endDate : undefined, endDate, status: "not_started" });

function Timeline({ item, periodStart, periodEnd }: { item: Draft; periodStart: string; periodEnd: string }) {
  const start = new Date(`${periodStart}T00:00:00`).getTime();
  const end = new Date(`${periodEnd}T00:00:00`).getTime();
  const span = Math.max(end - start, 86400000);
  const itemStart = new Date(`${item.startDate ?? item.endDate}T00:00:00`).getTime();
  const itemEnd = new Date(`${item.endDate}T00:00:00`).getTime();
  const left = Math.max(0, Math.min(100, ((itemStart - start) / span) * 100));
  const width = Math.max(4, Math.min(100 - left, ((itemEnd - itemStart) / span) * 100 + 4));
  return <div className="relative h-2 overflow-hidden rounded-full bg-muted"><span className={`absolute h-full rounded-full ${STATUS[item.status].color}`} style={{ left: `${left}%`, width: `${width}%` }} /></div>;
}

export function WeeklyProjectControlPlan({ reportId, project, names, periodStart, periodEnd, items, editable, onChange }: {
  reportId: string;
  project: Project | null;
  names: WeeklyNameLookup;
  periodStart: string;
  periodEnd: string;
  items: WeeklyPlanItem[];
  editable: boolean;
  onChange: (items: WeeklyPlanItem[]) => void;
}) {
  const [drafts, setDrafts] = React.useState<Draft[]>(() => items.map(toDraft));
  const [saving, setSaving] = React.useState<string | null>(null);
  const counter = React.useRef(0);
  const patch = (key: string, change: Partial<Draft>) => setDrafts((rows) => rows.map((row) => row.key === key ? { ...row, ...change, ...(change.departmentId ? { ownerContactId: undefined } : {}) } : row));
  const add = (kind: WeeklyPlanItem["kind"]) => { counter.current += 1; setDrafts((rows) => [...rows, newDraft(kind, `new-${counter.current}`, periodEnd)]); };
  const save = async (row: Draft) => {
    if (!row.title.trim() || !row.endDate) return toast.error("Enter a plan item and target date.");
    setSaving(row.key);
    try {
      const saved = await weeklyReportService.savePlanItem(reportId, row);
      const next = items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved];
      setDrafts((current) => current.map((draft) => draft.key === row.key ? toDraft(saved) : draft));
      onChange(next);
      toast.success("Project Control plan saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save plan item"); }
    finally { setSaving(null); }
  };
  const remove = async (row: Draft) => {
    if (!row.id) return setDrafts((rows) => rows.filter((item) => item.key !== row.key));
    setSaving(row.key);
    try { await weeklyReportService.deletePlanItem(reportId, row.id); setDrafts((current) => current.filter((item) => item.key !== row.key)); onChange(items.filter((item) => item.id !== row.id)); toast.success("Plan item removed"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not remove plan item"); }
    finally { setSaving(null); }
  };

  const renderGroup = (kind: WeeklyPlanItem["kind"], title: string) => {
    const rows = drafts.filter((row) => row.kind === kind);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 border-b pb-2"><h4 className="text-sm font-semibold">{title}</h4>{editable && <Button type="button" size="sm" variant="outline" onClick={() => add(kind)}><Plus data-icon="inline-start" />Add {kind === "milestone" ? "milestone" : "task"}</Button>}</div>
        {rows.length === 0 ? <p className="text-xs text-muted-foreground">No items recorded.</p> : rows.map((row) => {
          const owners = eligibleOwners(project, { departmentId: row.departmentId });
          return editable ? (
            <div key={row.key} className="grid gap-2 rounded-lg border bg-background p-3 lg:grid-cols-[minmax(12rem,2fr)_9rem_9rem_11rem_11rem_auto]">
              <Input aria-label={kind === "milestone" ? "Milestone / Deliverable" : "Next week task"} placeholder={kind === "milestone" ? "Milestone / Deliverable" : "Task"} value={row.title} onChange={(e) => patch(row.key, { title: e.target.value })} />
              {kind === "next_week" && <Input aria-label="From" type="date" value={row.startDate ?? ""} onChange={(e) => patch(row.key, { startDate: e.target.value })} />}
              <Input aria-label={kind === "milestone" ? "Target Date" : "To"} type="date" value={row.endDate} onChange={(e) => patch(row.key, { endDate: e.target.value })} />
              <Select value={row.departmentId ?? NONE} onValueChange={(value) => patch(row.key, { departmentId: value === NONE ? undefined : value })}><SelectTrigger aria-label="Owner department"><SelectValue placeholder="Department" /></SelectTrigger><SelectContent><SelectItem value={NONE}>Project Control</SelectItem>{(project?.departments ?? []).map((d) => <SelectItem key={d.departmentId} value={d.departmentId}>{names.department(d.departmentId)?.name ?? d.departmentId}</SelectItem>)}</SelectContent></Select>
              <Select value={row.ownerContactId ?? NONE} onValueChange={(value) => patch(row.key, { ownerContactId: value === NONE ? undefined : value })}><SelectTrigger aria-label="Plan owner"><SelectValue placeholder="Owner" /></SelectTrigger><SelectContent><SelectItem value={NONE}>No owner</SelectItem>{owners.map((owner) => <SelectItem key={owner.contactId} value={owner.contactId}>{names.person(owner.contactId)?.name ?? "Assigned person"}</SelectItem>)}</SelectContent></Select>
              <div className="flex gap-1"><Button type="button" size="icon-sm" aria-label="Save plan item" onClick={() => save(row)} disabled={saving === row.key}>{saving === row.key ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}</Button><Button type="button" size="icon-sm" variant="ghost" aria-label="Remove plan item" onClick={() => remove(row)} disabled={saving === row.key}><Trash2 aria-hidden="true" /></Button></div>
              <Select value={row.status} onValueChange={(value) => patch(row.key, { status: value as WeeklyPlanStatus })}><SelectTrigger className="lg:col-start-4" aria-label="Plan status"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(STATUS) as WeeklyPlanStatus[]).map((status) => <SelectItem key={status} value={status}>{STATUS[status].label}</SelectItem>)}</SelectContent></Select>
              <div className="self-center lg:col-span-3"><Timeline item={row} periodStart={periodStart} periodEnd={periodEnd} /></div>
            </div>
          ) : (
            <div key={row.key} className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(12rem,2fr)_9rem_10rem]">
              <div><p className="text-sm font-medium">{row.title}</p><p className="text-xs text-muted-foreground">{names.department(row.departmentId)?.name ?? "Project Control"} · {names.person(row.ownerContactId)?.name ?? "No owner"} · {row.startDate ? `${row.startDate} – ` : ""}{row.endDate}</p></div>
              <StatusBadge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</StatusBadge><Timeline item={row} periodStart={periodStart} periodEnd={periodEnd} />
            </div>
          );
        })}
      </div>
    );
  };

  return <SectionCard title="Project Control — Look-Ahead & Next Week Plan" description="Project-level baseline. Departments can view it; only Project Control and Admin may change it." contentClassName="space-y-5">{renderGroup("milestone", "A. Look-Ahead Milestones")}{renderGroup("next_week", "B. Next Week Project Tasks")}</SectionCard>;
}
