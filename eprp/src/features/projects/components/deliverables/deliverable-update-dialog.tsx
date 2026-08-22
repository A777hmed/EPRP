"use client";

import * as React from "react";
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
import { StatusBadge } from "@/components/shared";
import { CLIENT_REVIEW_META } from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { deliverableService } from "@/services/deliverable-service";
import type { ClientReviewStatus } from "@/types";
import type { DeliverableState } from "../../deliverable-state";
import type { MilestoneScopeOptions } from "../milestones/scope-options";

const REVIEW_STATUSES: ClientReviewStatus[] = [
  "not_submitted",
  "submitted",
  "under_review",
  "approved",
  "approved_with_comments",
  "rejected",
  "resubmit",
];

const NONE = "none";

/**
 * Report where a deliverable now stands with the client.
 *
 * THE ONE THING THIS DIALOG MUST GET RIGHT (D6): everything on this form is a
 * report about the CLIENT. Choosing "Client Approved" records that the client
 * approved — it does not approve anything here, and the submission still lands
 * pending Project Control's acceptance of the report. The footer says so
 * explicitly, because a form that lets someone pick "Approved" and then walks
 * away is the exact confusion the two-column design exists to prevent.
 */
export function DeliverableUpdateDialog({
  state,
  options,
  departmentIds,
  submittedByContactId,
  onClose,
  onSubmitted,
}: {
  state: DeliverableState;
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
  const { deliverable } = state;

  const [clientReviewStatus, setClientReviewStatus] =
    React.useState<ClientReviewStatus>(state.clientReviewStatus);
  const [clientReviewDate, setClientReviewDate] = React.useState(
    state.clientReviewDate ?? ""
  );
  const [clientReference, setClientReference] = React.useState(
    state.clientReference ?? ""
  );
  const [forecastDate, setForecastDate] = React.useState(
    state.forecastDate ?? ""
  );
  const [actualSubmissionDate, setActualSubmissionDate] = React.useState(
    state.actualSubmissionDate ?? ""
  );
  const [revision, setRevision] = React.useState(state.revision ?? "");
  const [narrative, setNarrative] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState(
    deliverable.departmentId ?? ""
  );
  const [disciplineId, setDisciplineId] = React.useState(
    deliverable.disciplineId ?? ""
  );
  const [saving, setSaving] = React.useState(false);

  const availableDepartments = departmentIds
    ? options.departments.filter((department) =>
        departmentIds.includes(department.id)
      )
    : options.departments;

  const outOfScope =
    departmentIds !== undefined &&
    (!departmentId || !departmentIds.includes(departmentId));

  /*
   * Nothing has reached the client, so nothing can be dated as reviewed. The
   * database refuses this combination outright; catching it here means the
   * fields simply stop accepting input rather than the save failing later.
   */
  const notSubmitted = clientReviewStatus === "not_submitted";
  const reviewDetailsBlocked =
    notSubmitted && (clientReviewDate !== "" || clientReference !== "");

  const submit = async () => {
    setSaving(true);
    try {
      await deliverableService.submitUpdate({
        deliverableId: deliverable.id,
        // Reported from the register itself rather than through a report.
        source: "planning",
        departmentId: departmentId || undefined,
        disciplineId: disciplineId || undefined,
        clientReviewStatus,
        clientReviewDate: notSubmitted ? undefined : clientReviewDate || undefined,
        clientReference: notSubmitted ? undefined : clientReference || undefined,
        forecastDate: forecastDate || undefined,
        actualSubmissionDate: actualSubmissionDate || undefined,
        revision: revision || undefined,
        narrative: narrative || undefined,
        submittedByContactId,
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Update {deliverable.code} — {deliverable.title}
          </DialogTitle>
          <DialogDescription>
            Reports where this deliverable stands with the client. It becomes the
            current position once Project Control approves the report.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Currently approved: </span>
          {state.current ? (
            <>
              {CLIENT_REVIEW_META[state.clientReviewStatus].label}
              {state.revision && ` · ${state.revision}`}
              {state.actualSubmissionDate &&
                ` · submitted ${formatDate(state.actualSubmissionDate)}`}
            </>
          ) : (
            <span className="text-muted-foreground">
              nothing reported yet — this would be the first approved position.
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="du-review-status">Client review status</Label>
            <Select
              value={clientReviewStatus}
              onValueChange={(value) =>
                setClientReviewStatus(value as ClientReviewStatus)
              }
            >
              <SelectTrigger id="du-review-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVIEW_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {CLIENT_REVIEW_META[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              What the client has done. Separate from whether Project Control has
              accepted this report.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="du-revision">Revision submitted</Label>
            <Input
              id="du-revision"
              value={revision}
              onChange={(event) => setRevision(event.target.value)}
              placeholder="Rev B"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="du-actual">Actual submission date</Label>
            <Input
              id="du-actual"
              type="date"
              value={actualSubmissionDate}
              onChange={(event) => setActualSubmissionDate(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="du-forecast">Forecast submission</Label>
            <Input
              id="du-forecast"
              type="date"
              value={forecastDate}
              onChange={(event) => setForecastDate(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="du-review-date">Client review date</Label>
            <Input
              id="du-review-date"
              type="date"
              value={clientReviewDate}
              onChange={(event) => setClientReviewDate(event.target.value)}
              disabled={notSubmitted}
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="du-client-ref">Client reference</Label>
            <Input
              id="du-client-ref"
              value={clientReference}
              onChange={(event) => setClientReference(event.target.value)}
              placeholder="Transmittal or comment-sheet number"
              disabled={notSubmitted}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="du-department">Reporting department</Label>
            <Select
              value={departmentId || NONE}
              onValueChange={(value) =>
                setDepartmentId(value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="du-department">
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
            <Label htmlFor="du-discipline">Scope item</Label>
            <Select
              value={disciplineId || NONE}
              onValueChange={(value) =>
                setDisciplineId(value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="du-discipline">
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

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="du-narrative">Narrative</Label>
            <Textarea
              id="du-narrative"
              rows={3}
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
              placeholder="What changed, and why."
            />
          </div>
        </div>

        {reviewDetailsBlocked && (
          <p className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
            A review date and client reference only make sense once the
            deliverable has been submitted. They will not be saved while the
            status is Not Submitted.
          </p>
        )}

        {outOfScope && (
          <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Choose a department you are assigned to on this project. Updates can
            only be reported inside your own scope.
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            Submits as
            <StatusBadge tone="warning" className="text-[10px]">
              Awaiting Approval
            </StatusBadge>
            whatever the client status says.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving || outOfScope}>
              {saving ? "Submitting…" : "Submit for Approval"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
