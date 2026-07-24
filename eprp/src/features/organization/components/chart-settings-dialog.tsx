"use client";

import * as React from "react";
import { Archive, Loader2, Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/shared";
import { organizationChartService } from "@/services/organization-chart-service";
import {
  allowedStatusTransitions,
  chartStatusLabel,
} from "@/lib/organization-lock";
import type {
  OrganizationChart,
  OrganizationChartStatus,
  OrganizationChartType,
} from "@/types";

const CHART_TYPE_LABELS: Record<OrganizationChartType, string> = {
  epc: "EPC",
  epcm: "EPCM",
  construction: "Construction",
  turnaround: "Turnaround",
  custom: "Custom",
};

const NO_TYPE = "__none__";

export interface ChartSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chart: OrganizationChart;
  /** Called with the updated chart after a save or status change. */
  onSaved: (chart: OrganizationChart) => void;
  /** Called after the chart is archived, so the owner can step away from it. */
  onArchived: () => void;
}

/**
 * Chart management: name, description, type, effective date and status in one
 * place, plus archiving. Every field is backed by the existing service —
 * metadata through `updateChart`, the lifecycle through `setChartStatus`, and
 * archiving through `archiveChart`.
 */
export function ChartSettingsDialog({
  open,
  onOpenChange,
  chart,
  onSaved,
  onArchived,
}: ChartSettingsDialogProps) {
  const [name, setName] = React.useState(chart.name);
  const [description, setDescription] = React.useState(chart.description ?? "");
  const [chartType, setChartType] = React.useState<string>(
    chart.chartType ?? NO_TYPE
  );
  const [effectiveDate, setEffectiveDate] = React.useState(
    chart.effectiveDate ?? ""
  );
  const [status, setStatus] = React.useState<OrganizationChartStatus>(
    chart.status
  );
  const [saving, setSaving] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const [confirmArchive, setConfirmArchive] = React.useState(false);

  // The form seeds from `chart` on mount; the caller keys this dialog on the
  // chart's identity, so a different or freshly-saved chart remounts it with
  // the new values rather than needing an effect to copy them in.

  // Status may only move where the lifecycle allows, plus staying put.
  const statusOptions = React.useMemo(
    () => [chart.status, ...allowedStatusTransitions(chart.status)],
    [chart.status]
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      let next = chart;

      if (status !== chart.status) {
        next = await organizationChartService.setChartStatus(chart.id, status);
      }

      // Metadata always goes through updateChart; "" clears a field.
      next = await organizationChartService.updateChart(chart.id, {
        name: name.trim(),
        description,
        ...(chartType !== NO_TYPE
          ? { chartType: chartType as OrganizationChartType }
          : {}),
        effectiveDate,
      });

      onSaved(next);
      onOpenChange(false);
      toast.success("Chart updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the chart"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await organizationChartService.archiveChart(chart.id);
      setConfirmArchive(false);
      onOpenChange(false);
      onArchived();
      toast.success("Chart archived");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not archive the chart"
      );
    } finally {
      setArchiving(false);
    }
  };

  const nameInvalid = name.trim().length === 0;
  const busy = saving || archiving;

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chart settings</DialogTitle>
          <DialogDescription>
            Manage this chart&rsquo;s details, type, effective date and status.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="chart-name" className="text-xs font-medium">
              Chart name<span className="ml-1 text-destructive">*</span>
            </label>
            <Input
              id="chart-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={nameInvalid}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="chart-description" className="text-xs font-medium">
              Description
            </label>
            <Textarea
              id="chart-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Chart type</label>
              <Select value={chartType} onValueChange={setChartType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TYPE}>Not set</SelectItem>
                  {(
                    Object.keys(CHART_TYPE_LABELS) as OrganizationChartType[]
                  ).map((type) => (
                    <SelectItem key={type} value={type}>
                      {CHART_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label htmlFor="chart-effective" className="text-xs font-medium">
                Effective date
              </label>
              <Input
                id="chart-effective"
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Status</label>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as OrganizationChartStatus)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {chartStatusLabel(option)}
                    {option === chart.status ? " (current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground text-pretty">
              Approved and locked charts become read-only. Only the next valid
              statuses are offered.
            </p>
          </div>

          <Separator />

          {/* ----------------------------- Danger zone -------------------- */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div>
              <p className="text-sm font-medium">Archive chart</p>
              <p className="text-xs text-muted-foreground text-pretty">
                Removes this chart from the project. Its positions and history
                are kept.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmArchive(true)}
              disabled={busy}
            >
              <Archive data-icon="inline-start" aria-hidden="true" />
              Archive
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy || nameInvalid}>
            {saving ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Save data-icon="inline-start" aria-hidden="true" />
            )}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive “${chart.name}”?`}
        description="The chart is removed from the project. Positions and assignment history are preserved, and it can be restored from the database if needed."
        confirmLabel="Archive chart"
        destructive
        onConfirm={handleArchive}
      />
    </Dialog>
  );
}
