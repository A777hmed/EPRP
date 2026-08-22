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
import { MILESTONE_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { milestoneService } from "@/services/milestone-service";
import type { MilestoneStatus } from "@/types";
import { isRegression, type MilestoneState } from "../../milestone-state";
import type { MilestoneScopeOptions } from "./scope-options";

const STATUSES: MilestoneStatus[] = [
  "not_started",
  "in_progress",
  "completed",
  "delayed",
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
  const [narrative, setNarrative] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState(
    milestone.departmentId ?? ""
  );
  const [disciplineId, setDisciplineId] = React.useState(
    milestone.disciplineId ?? ""
  );
  const [saving, setSaving] = React.useState(false);

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
        narrative: narrative || undefined,
        // Flagged at submission, so the row is stored already marked and the
        // approver cannot accept it without giving a reason.
        isRegression: regression,
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
            disabled={saving || !progressValid || outOfScope}
          >
            {saving ? "Submitting…" : "Submit for Approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
