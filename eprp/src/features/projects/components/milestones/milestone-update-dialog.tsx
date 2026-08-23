"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MILESTONE_CLIENT_APPROVAL_META,
  MILESTONE_PAYMENT_STATUS_META,
  MILESTONE_STATUS_META,
} from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { milestoneService } from "@/services/milestone-service";
import type {
  MilestoneClientApprovalStatus,
  MilestonePaymentStatus,
  MilestoneStatus,
} from "@/types";
import { isRegression, type MilestoneState } from "../../milestone-state";
import type { MilestoneScopeOptions } from "./scope-options";

const STATUSES: MilestoneStatus[] = [
  "not_started",
  "in_progress",
  "completed",
  "delayed",
];

const PAYMENT_STATUSES: MilestonePaymentStatus[] = [
  "planned",
  "due",
  "invoiced",
  "received",
  "partially_recovered",
  "fully_recovered",
];

const CLIENT_APPROVALS: MilestoneClientApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
];

const NONE = "none";

/**
 * Report a change of state against an existing milestone.
 *
 * The milestone itself is fixed here — its code and name are shown, never
 * edited. A contributor reports what is TRUE of a milestone; only Project
 * Control decides what a milestone IS, and only an approved update changes the
 * register's figures.
 *
 * Submitting always produces a pending row. That is deliberate and visible in
 * the wording: nothing on this screen can make a number official.
 */
export function MilestoneUpdateDialog({
  state,
  options,
  departmentIds,
  submittedByContactId,
  onClose,
  onSubmitted,
}: {
  state: MilestoneState;
  options: MilestoneScopeOptions;
  /**
   * Departments the submitter may report against. Undefined means Project
   * Control, who may report against any of them.
   */
  departmentIds?: string[];
  submittedByContactId?: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { milestone } = state;

  const [status, setStatus] = React.useState<MilestoneStatus>(state.status);
  const [progress, setProgress] = React.useState(
    state.progressPercent === undefined ? "" : String(state.progressPercent)
  );
  const [forecastDate, setForecastDate] = React.useState(
    state.forecastDate ?? ""
  );
  const [actualDate, setActualDate] = React.useState(state.actualDate ?? "");
  // 13.2d — the cut-off this observation describes.
  const [asOfDate, setAsOfDate] = React.useState("");
  const [narrative, setNarrative] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState(
    milestone.departmentId ?? ""
  );
  const [disciplineId, setDisciplineId] = React.useState(
    milestone.disciplineId ?? ""
  );
  const [saving, setSaving] = React.useState(false);

  /* 13.2c — commercial actuals, reported only for a commercial milestone. */
  const [paymentStatus, setPaymentStatus] = React.useState<string>(
    state.paymentStatus ?? ""
  );
  const [invoiceReference, setInvoiceReference] = React.useState("");
  const [invoicedDate, setInvoicedDate] = React.useState("");
  const [receivedDate, setReceivedDate] = React.useState("");
  const [recoveredAmount, setRecoveredAmount] = React.useState(
    state.recoveredAmount === undefined ? "" : String(state.recoveredAmount)
  );

  /* 13.2c — what the CLIENT decided. Never our own approval of this report. */
  const [clientApprovalStatus, setClientApprovalStatus] = React.useState<string>(
    state.clientApprovalStatus ?? ""
  );
  const [clientApprovalDate, setClientApprovalDate] = React.useState("");

  const commercial = state.commercial;
  const clientDecided =
    clientApprovalStatus === "approved" || clientApprovalStatus === "rejected";

  const recovered = recoveredAmount.trim() === "" ? undefined : Number(recoveredAmount);
  const recoveredValid =
    recovered === undefined || (Number.isFinite(recovered) && recovered >= 0);

  const availableDepartments = departmentIds
    ? options.departments.filter((department) =>
        departmentIds.includes(department.id)
      )
    : options.departments;

  /*
   * A scoped contributor may only report inside a department they are assigned
   * to. Saying so before they fill the form is kinder than letting the database
   * refuse the write afterwards — and the database still refuses it either way.
   */
  const outOfScope =
    departmentIds !== undefined &&
    (!departmentId || !departmentIds.includes(departmentId));

  const proposed = progress.trim() === "" ? undefined : Number(progress);
  const progressValid =
    proposed === undefined ||
    (Number.isFinite(proposed) && proposed >= 0 && proposed <= 100);
  const regression = isRegression(proposed, state);

  const submit = async () => {
    setSaving(true);
    try {
      await milestoneService.submitUpdate({
        milestoneId: milestone.id,
        // Reported from the register itself rather than through a report.
        source: "planning",
        departmentId: departmentId || undefined,
        disciplineId: disciplineId || undefined,
        status,
        progressPercent: proposed,
        forecastDate: forecastDate || undefined,
        actualDate: actualDate || undefined,
        asOfDate: asOfDate || undefined,
        narrative: narrative || undefined,
        // Flagged at submission, so the row is stored already marked and the
        // approver cannot accept it without giving a reason.
        isRegression: regression,
        submittedByContactId,

        // Commercial actuals only reach the database for a commercial
        // milestone. Sending them on a technical one would be refused by the
        // register's own rules, and would be meaningless if it were not.
        paymentStatus: commercial
          ? ((paymentStatus || undefined) as
              | MilestonePaymentStatus
              | undefined)
          : undefined,
        invoiceReference: commercial ? invoiceReference || undefined : undefined,
        invoicedDate: commercial ? invoicedDate || undefined : undefined,
        receivedDate: commercial ? receivedDate || undefined : undefined,
        recoveredAmount: commercial ? recovered : undefined,

        clientApprovalStatus: (clientApprovalStatus || undefined) as
          | MilestoneClientApprovalStatus
          | undefined,
        // A date only means something once a decision was made; the database
        // enforces the same rule.
        clientApprovalDate: clientDecided
          ? clientApprovalDate || undefined
          : undefined,
      });
      toast.success("Update submitted for approval.");
      onSubmitted();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not submit the update."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Update {milestone.code} — {milestone.name}
          </DialogTitle>
          <DialogDescription>
            Reports what is true of this milestone now. It becomes the current
            figure once Project Control approves it.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Currently approved: </span>
          {state.current ? (
            <>
              {MILESTONE_STATUS_META[state.status].label}
              {state.progressPercent !== undefined &&
                ` · ${state.progressPercent}%`}
              {state.forecastDate && ` · forecast ${formatDate(state.forecastDate)}`}
            </>
          ) : (
            <span className="text-muted-foreground">
              nothing reported yet — this would be the first approved figure.
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="update-status">Status</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as MilestoneStatus)}
            >
              <SelectTrigger id="update-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {MILESTONE_STATUS_META[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="update-progress">Progress %</Label>
            <Input
              id="update-progress"
              inputMode="numeric"
              value={progress}
              onChange={(event) => setProgress(event.target.value)}
              placeholder="Leave blank if not measured"
              aria-invalid={!progressValid}
            />
          </div>

          {/*
            The cut-off this figure describes — not today's date. It is what
            lets two sources be compared: same cut-off + different figures is a
            conflict for Project Control, different cut-offs are both history.
            Left blank, the figure is exempt from that comparison entirely.
          */}
          <div className="grid gap-1.5">
            <Label htmlFor="update-as-of">As-of date</Label>
            <Input
              id="update-as-of"
              type="date"
              value={asOfDate}
              onChange={(event) => setAsOfDate(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The reporting cut-off this figure is true as of.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="update-forecast">Forecast date</Label>
            <Input
              id="update-forecast"
              type="date"
              value={forecastDate}
              onChange={(event) => setForecastDate(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="update-actual">Actual completion date</Label>
            <Input
              id="update-actual"
              type="date"
              value={actualDate}
              onChange={(event) => setActualDate(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="update-department">Reporting department</Label>
            <Select
              value={departmentId || NONE}
              onValueChange={(value) =>
                setDepartmentId(value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="update-department">
                <SelectValue placeholder="Project-wide" />
              </SelectTrigger>
              <SelectContent>
                {departmentIds === undefined && (
                  <SelectItem value={NONE}>Project-wide</SelectItem>
                )}
                {availableDepartments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="update-discipline">Scope item</Label>
            <Select
              value={disciplineId || NONE}
              onValueChange={(value) =>
                setDisciplineId(value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="update-discipline">
                <SelectValue placeholder="Department level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Department level</SelectItem>
                {options.disciplines
                  .filter(
                    (item) =>
                      !departmentId ||
                      !item.departmentId ||
                      item.departmentId === departmentId
                  )
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {commercial && (
            <div className="sm:col-span-2 grid gap-4 rounded-md border border-warning/25 bg-warning/5 p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="text-sm font-medium">Payment position</p>
                <p className="text-xs text-muted-foreground">
                  What actually happened with the money. Reported here and
                  approved like any other figure — and never counted as physical
                  progress.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="update-payment-status">Payment status</Label>
                <Select
                  value={paymentStatus || NONE}
                  onValueChange={(value) =>
                    setPaymentStatus(value === NONE ? "" : value)
                  }
                >
                  <SelectTrigger id="update-payment-status">
                    <SelectValue placeholder="Not reported" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not reported</SelectItem>
                    {PAYMENT_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {MILESTONE_PAYMENT_STATUS_META[value].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="update-invoice-ref">Invoice / reference no.</Label>
                <Input
                  id="update-invoice-ref"
                  value={invoiceReference}
                  onChange={(event) => setInvoiceReference(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="update-invoiced">Invoiced date</Label>
                <Input
                  id="update-invoiced"
                  type="date"
                  value={invoicedDate}
                  onChange={(event) => setInvoicedDate(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="update-received">Received date</Label>
                <Input
                  id="update-received"
                  type="date"
                  value={receivedDate}
                  onChange={(event) => setReceivedDate(event.target.value)}
                />
              </div>

              {milestone.isAdvancePayment && (
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="update-recovered">Recovered amount</Label>
                  <Input
                    id="update-recovered"
                    inputMode="decimal"
                    value={recoveredAmount}
                    onChange={(event) => setRecoveredAmount(event.target.value)}
                    aria-invalid={!recoveredValid}
                  />
                  <p className="text-xs text-muted-foreground">
                    Recovery % and the outstanding advance are worked out from
                    the agreed amount — report the money, not the percentage.
                  </p>
                </div>
              )}
            </div>
          )}

          {milestone.clientApprovalRequired && (
            <div className="sm:col-span-2 grid gap-4 rounded-md border p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="text-sm font-medium">Client approval</p>
                <p className="text-xs text-muted-foreground">
                  What the CLIENT decided. This is reported data — it is not the
                  same thing as Project Control accepting this report, which
                  happens in the approval queue.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="update-client-approval">Client decision</Label>
                <Select
                  value={clientApprovalStatus || NONE}
                  onValueChange={(value) =>
                    setClientApprovalStatus(value === NONE ? "" : value)
                  }
                >
                  <SelectTrigger id="update-client-approval">
                    <SelectValue placeholder="Not reported" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not reported</SelectItem>
                    {CLIENT_APPROVALS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {MILESTONE_CLIENT_APPROVAL_META[value].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="update-client-approval-date">
                  Client decision date
                </Label>
                <Input
                  id="update-client-approval-date"
                  type="date"
                  value={clientApprovalDate}
                  onChange={(event) => setClientApprovalDate(event.target.value)}
                  // Nothing has been decided, so nothing can be dated. The
                  // database refuses the same combination.
                  disabled={!clientDecided}
                />
              </div>
            </div>
          )}

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="update-narrative">Narrative</Label>
            <Textarea
              id="update-narrative"
              rows={3}
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
              placeholder="What changed, and why."
            />
          </div>
        </div>

        {regression && (
          <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              This reports less progress than the approved {state.progressPercent}
              %. That is allowed, but it will be flagged, and the approver must
              record a reason before accepting it.
            </span>
          </p>
        )}

        {outOfScope && (
          <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Choose a department you are assigned to on this project. Updates can
            only be reported inside your own scope.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !progressValid || !recoveredValid || outOfScope}
          >
            {saving ? "Submitting…" : "Submit for Approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
