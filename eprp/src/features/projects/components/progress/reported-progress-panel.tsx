"use client";

import * as React from "react";
import Link from "next/link";
import { History, Loader2, PencilLine, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog, EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { projectWorkflowHref } from "@/config/project-workflow";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { setupGovernanceService } from "@/services/setup-governance-service";
import type { Project } from "@/types";
import {
  REPORTED_PROGRESS_KIND_LABEL,
  REPORTED_PROGRESS_LABEL,
  REPORTED_PROGRESS_SPI,
  canActOnEntry,
  isBackdatedDate,
  isReportedProgressWritable,
  latestReportedProgress,
  latestValidDataDate,
  reportedProgressChains,
  type ReportedProgressEntry,
  type SetupFinalisation,
} from "../../reported-progress";
import { useProjectAuthority } from "../../use-project-authority";
import { PlanningFact } from "../planning/planning-status";

/** Today in the project's time zone (yyyy-mm-dd) — the database refuses later Data Dates. */
export function projectToday(timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const pct = (value: number | null) => (value === null ? "—" : `${Number(value).toFixed(value % 1 === 0 ? 0 : 1)}%`);

/**
 * Phase 13.9B — Project Progress for a not-planning-governed project
 * (`02` §26.14, §26.24.5): the canonical Reported Progress stream. Always
 * "Reported — not planning governed", SPI "N/A"; never PV, EV, a curve or WBS
 * performance. Writes go to the database functions only.
 *
 * `frozen` shows the history of a project that has since moved to a
 * planning-governed mode: read-only context, "before planning governance".
 */
export function ReportedProgressPanel({
  project,
  onboardingMode,
  hasPublishedSnapshot,
  frozen = false,
}: {
  project: Project;
  onboardingMode: string | undefined;
  hasPublishedSnapshot: boolean;
  frozen?: boolean;
}) {
  const authority = useProjectAuthority(project);
  const [entries, setEntries] = React.useState<ReportedProgressEntry[] | undefined>();
  const [finalisation, setFinalisation] = React.useState<SetupFinalisation | null | undefined>();
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  const [updateOpen, setUpdateOpen] = React.useState(false);
  const [correcting, setCorrecting] = React.useState<ReportedProgressEntry | null>(null);
  const [withdrawing, setWithdrawing] = React.useState<ReportedProgressEntry | null>(null);
  const reload = () => setVersion((current) => current + 1);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      setupGovernanceService.listReportedProgress(project.id),
      setupGovernanceService.getControlState(project.id),
    ])
      .then(([rows, control]) => {
        if (cancelled) return;
        setEntries(rows);
        setFinalisation(control.finalisation);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Reported Progress could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, version]);

  if (error) {
    return <EmptyState icon={History} title="Reported Progress could not be loaded" description={error} />;
  }
  if (entries === undefined || finalisation === undefined) {
    return <LoadingState variant="page" label="Loading Reported Progress…" />;
  }

  const archived = authority.archived;
  const writable =
    !frozen &&
    isReportedProgressWritable({
      onboardingMode,
      finalised: Boolean(finalisation),
      hasPublishedSnapshot,
      archived,
    });
  const canWrite = writable && authority.resolved && authority.canManageOperations;
  const latest = latestReportedProgress(entries);
  const chains = reportedProgressChains(entries);
  if (frozen && entries.length === 0) return null;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="neutral">{REPORTED_PROGRESS_LABEL}</StatusBadge>
            {frozen && <StatusBadge tone="neutral">Before planning governance · read-only</StatusBadge>}
            {latest?.isBackdated && <StatusBadge tone="warning">Back-dated entry</StatusBadge>}
          </div>
          {canWrite && (
            <Button size="sm" onClick={() => setUpdateOpen(true)}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Update Reported Progress
            </Button>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap">
          <PlanningFact label="Reported actual" value={latest ? pct(latest.reportedActualPercent) : "—"} />
          <PlanningFact
            label="Reported planned"
            value={latest?.reportedPlannedPercent !== null && latest ? pct(latest.reportedPlannedPercent) : "Not given"}
          />
          <PlanningFact label="Data Date" value={latest ? formatDate(latest.dataDate) : "—"} />
          <PlanningFact label="SPI" value={REPORTED_PROGRESS_SPI} hint="Not applicable: the project has no formal plan" />
        </dl>

        {latest ? (
          <div className="mt-4 space-y-1 text-sm">
            <p className="text-pretty">{latest.narrative}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {REPORTED_PROGRESS_KIND_LABEL[latest.entryKind]} recorded by {latest.recordedByName ?? "Project Control"} ·{" "}
              {formatDateTime(latest.recordedAt)}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {frozen
              ? "No valid Reported Progress position remains."
              : finalisation
                ? "No progress has been reported yet."
                : "Reported Progress starts once Project Setup is finalised."}
          </p>
        )}

        <p className="mt-4 max-w-3xl text-xs text-muted-foreground text-pretty">
          This project is tracked without a formal schedule, so it has no planned value, earned value or SPI.
          Reported Progress is recorded by Project Control and kept as an append-only history; corrections and
          withdrawals never overwrite an earlier entry. Weekly and Monthly reports do not own this figure.
        </p>

        {!frozen && !finalisation && !archived && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-xs">
            <span className="text-muted-foreground">
              Finalise Project Setup (Planning Entry) before the first Reported Progress entry.
            </span>
            {authority.canManageOperations && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`${projectWorkflowHref(project.id, "info")}#planning-entry`}>Open Planning Entry</Link>
              </Button>
            )}
          </div>
        )}
      </section>

      {chains.length > 0 && (
        <section className="rounded-xl border bg-card p-4 shadow-soft sm:p-5">
          <h3 className="text-sm font-semibold">Reported Progress history</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            One line of history per Data Date. Only the current entry of a Data Date can be corrected or withdrawn; a
            withdrawal is final.
          </p>
          <ol className="mt-3 space-y-3">
            {chains.map((chain) => (
              <li key={chain.dataDate} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {formatDate(chain.dataDate)}
                    {chain.withdrawn ? (
                      <StatusBadge tone="neutral">Withdrawn — closed</StatusBadge>
                    ) : latest?.id === chain.head.id ? (
                      <StatusBadge tone="success">Latest</StatusBadge>
                    ) : null}
                    {chain.entries[0].isBackdated && <StatusBadge tone="warning">Back-dated</StatusBadge>}
                  </p>
                  {canWrite && canActOnEntry(chain.head, entries) && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setCorrecting(chain.head)}>
                        <PencilLine data-icon="inline-start" aria-hidden="true" /> Correct
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setWithdrawing(chain.head)}>
                        <Undo2 data-icon="inline-start" aria-hidden="true" /> Withdraw
                      </Button>
                    </div>
                  )}
                </div>
                <ol className="mt-2 space-y-2 border-l pl-3">
                  {chain.entries.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={entry.entryKind === "withdrawal" ? "danger" : entry.entryKind === "correction" ? "info" : "neutral"}>
                          {REPORTED_PROGRESS_KIND_LABEL[entry.entryKind]}
                        </StatusBadge>
                        {entry.entryKind !== "withdrawal" && (
                          <span className="tabular-nums">
                            Actual {pct(entry.reportedActualPercent)}
                            {entry.reportedPlannedPercent !== null && ` · Planned ${pct(entry.reportedPlannedPercent)}`}
                          </span>
                        )}
                      </p>
                      {entry.narrative && <p className="mt-0.5 text-pretty">{entry.narrative}</p>}
                      {entry.reason && (
                        <p className="mt-0.5 text-xs text-pretty">
                          <span className="text-muted-foreground">Reason: </span>
                          {entry.reason}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {entry.recordedByName ?? "Project Control"} · {formatDateTime(entry.recordedAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>
      )}

      {canWrite && (
        <>
          <ReportedProgressDialog
            mode="report"
            open={updateOpen}
            onOpenChange={setUpdateOpen}
            project={project}
            entries={entries}
            onSaved={reload}
          />
          <ReportedProgressDialog
            mode="correction"
            open={correcting !== null}
            onOpenChange={(open) => !open && setCorrecting(null)}
            project={project}
            entries={entries}
            target={correcting ?? undefined}
            onSaved={reload}
          />
          <WithdrawReportedProgressDialog
            target={withdrawing}
            onClose={() => setWithdrawing(null)}
            onWithdrawn={reload}
          />
        </>
      )}
    </div>
  );
}

function ReportedProgressDialog({
  mode,
  open,
  onOpenChange,
  project,
  entries,
  target,
  onSaved,
}: {
  mode: "report" | "correction";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  entries: readonly ReportedProgressEntry[];
  target?: ReportedProgressEntry;
  onSaved: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so every opening starts from the entry (or blank). */}
        {open && (
          <ReportedProgressBody
            key={target?.id ?? "new"}
            mode={mode}
            project={project}
            entries={entries}
            target={target}
            saving={saving}
            setSaving={setSaving}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReportedProgressBody({
  mode,
  project,
  entries,
  target,
  saving,
  setSaving,
  onClose,
  onSaved,
}: {
  mode: "report" | "correction";
  project: Project;
  entries: readonly ReportedProgressEntry[];
  target?: ReportedProgressEntry;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = projectToday(project.reporting?.timeZone);
  const [dataDate, setDataDate] = React.useState(target?.dataDate ?? today);
  const [actual, setActual] = React.useState(
    target && target.reportedActualPercent !== null ? String(target.reportedActualPercent) : ""
  );
  const [planned, setPlanned] = React.useState(
    target && target.reportedPlannedPercent !== null ? String(target.reportedPlannedPercent) : ""
  );
  const [narrative, setNarrative] = React.useState(target?.narrative ?? "");
  const [reason, setReason] = React.useState("");
  const ids = { date: React.useId(), actual: React.useId(), planned: React.useId(), narrative: React.useId(), reason: React.useId() };

  const correction = mode === "correction";
  const actualNumber = actual.trim() === "" ? NaN : Number(actual);
  const plannedNumber = planned.trim() === "" ? null : Number(planned);
  const actualValid = Number.isFinite(actualNumber) && actualNumber >= 0 && actualNumber <= 100;
  const plannedValid = plannedNumber === null || (Number.isFinite(plannedNumber) && plannedNumber >= 0 && plannedNumber <= 100);
  const future = !correction && dataDate > today;
  const backdated = !correction && isBackdatedDate(dataDate, entries);
  const reasonNeeded = correction || backdated;
  const sameDate = !correction && entries.some((entry) => entry.entryKind === "report" && entry.dataDate === dataDate);
  const closedDate = sameDate && reportedProgressChains(entries).some((chain) => chain.dataDate === dataDate && chain.withdrawn);
  const ready =
    Boolean(dataDate) && actualValid && plannedValid && narrative.trim() !== "" && !future && !sameDate &&
    (!reasonNeeded || reason.trim() !== "");

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      if (correction && target) {
        await setupGovernanceService.correctReportedProgress({
          entryId: target.id,
          reportedActualPercent: actualNumber,
          reportedPlannedPercent: plannedNumber,
          narrative: narrative.trim(),
          reason: reason.trim(),
        });
        toast.success("Correction recorded. The original entry stays in the history.");
      } else {
        await setupGovernanceService.recordReportedProgress({
          projectId: project.id,
          dataDate,
          reportedActualPercent: actualNumber,
          reportedPlannedPercent: plannedNumber,
          narrative: narrative.trim(),
          reason: backdated ? reason.trim() : undefined,
        });
        toast.success("Reported Progress recorded.");
      }
      onSaved();
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Reported Progress could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const latestDate = latestValidDataDate(entries);
  return (
    <>
        <DialogHeader>
          <DialogTitle>{correction ? "Correct Reported Progress" : "Update Reported Progress"}</DialogTitle>
          <DialogDescription>
            {correction
              ? `Records a correction for ${target ? formatDate(target.dataDate) : "this Data Date"}. The entry it replaces stays in the history.`
              : "Reported — not planning governed. SPI stays N/A. Each Data Date has one report; correct it later instead of reporting it twice."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel htmlFor={ids.date}>Data Date</FieldLabel>
            <Input id={ids.date} type="date" className="max-w-48" value={dataDate} max={today} disabled={correction}
              onChange={(event) => setDataDate(event.target.value)} />
            {future && <FieldDescription className="text-destructive">The Data Date cannot be later than today.</FieldDescription>}
            {sameDate && (
              <FieldDescription className="text-destructive">
                {closedDate
                  ? "This Data Date was withdrawn and is closed. It cannot be reported again."
                  : "This Data Date already has a report. Correct that entry instead."}
              </FieldDescription>
            )}
            {backdated && !sameDate && (
              <FieldDescription className="text-warning">
                Back-dated — earlier than the latest report of {latestDate ? formatDate(latestDate) : "—"}. A reason is required, and it will not become the latest.
              </FieldDescription>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={ids.actual}>Reported actual % <span className="text-destructive" aria-hidden="true">*</span></FieldLabel>
              <Input id={ids.actual} type="number" min={0} max={100} step="0.1" value={actual} onChange={(event) => setActual(event.target.value)} />
              {actual !== "" && !actualValid && <FieldDescription className="text-destructive">From 0 to 100.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.planned}>Reported planned % (optional)</FieldLabel>
              <Input id={ids.planned} type="number" min={0} max={100} step="0.1" value={planned} onChange={(event) => setPlanned(event.target.value)} />
              {!plannedValid && <FieldDescription className="text-destructive">From 0 to 100.</FieldDescription>}
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={ids.narrative}>Explanation <span className="text-destructive" aria-hidden="true">*</span></FieldLabel>
            <Textarea id={ids.narrative} rows={3} maxLength={4000} value={narrative} onChange={(event) => setNarrative(event.target.value)}
              placeholder="What the reported position is based on" />
          </Field>
          {reasonNeeded && (
            <Field>
              <FieldLabel htmlFor={ids.reason}>
                {correction ? "Reason for correction" : "Reason for back-dating"} <span className="text-destructive" aria-hidden="true">*</span>
              </FieldLabel>
              <Textarea id={ids.reason} rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!ready || saving}>
            {saving && <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {correction ? "Record correction" : "Record Reported Progress"}
          </Button>
        </DialogFooter>
    </>
  );
}

function WithdrawReportedProgressDialog({
  target,
  onClose,
  onWithdrawn,
}: {
  target: ReportedProgressEntry | null;
  onClose: () => void;
  onWithdrawn: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const reasonId = React.useId();

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (open) return;
        setReason("");
        onClose();
      }}
      title={`Withdraw the ${target ? formatDate(target.dataDate) : ""} entry?`}
      description="The Data Date stops being a valid Reported Progress position. A withdrawal is final: it cannot be corrected or withdrawn again, and this Data Date cannot be reported again. The history is kept."
      confirmLabel="Withdraw entry"
      destructive
      onConfirm={async () => {
        if (!target) return;
        if (!reason.trim()) {
          toast.error("A reason is required to withdraw an entry.");
          throw new Error("reason required");
        }
        try {
          await setupGovernanceService.withdrawReportedProgress({ entryId: target.id, reason: reason.trim() });
          toast.success("Entry withdrawn. It remains in the history.");
          onWithdrawn();
        } catch (cause) {
          toast.error(cause instanceof Error ? cause.message : "The entry could not be withdrawn.");
          throw cause;
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={reasonId}>Reason <span className="text-destructive" aria-hidden="true">*</span></FieldLabel>
        <Textarea id={reasonId} rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}
