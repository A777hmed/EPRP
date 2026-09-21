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
import { Textarea } from "@/components/ui/textarea";
import { planningService } from "@/services/planning-service";

/**
 * Declares a project's Opening Position — the ONE honest starting position
 * for a project onboarded mid-execution (`existing_active_project`).
 *
 * The single implementation of this form. It is opened from the Planning
 * workspace's Baselines & Snapshots tab and from the Project Setup governed
 * performance panel — both reuse this component rather than each carrying
 * their own copy, so there is exactly one Opening Position mechanism in the
 * platform (see `planning-service.ts` "Opening Position" section).
 */
export function OpeningPositionDialog({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [dataDate, setDataDate] = React.useState("");
  const [planned, setPlanned] = React.useState("");
  const [actual, setActual] = React.useState("");
  const [forecastFinish, setForecastFinish] = React.useState("");
  const [source, setSource] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const valid = dataDate.trim().length > 0 && source.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await planningService.createOpeningPosition({
        projectId,
        dataDate,
        plannedProgressPercent: planned === "" ? undefined : Number(planned),
        actualProgressPercent: actual === "" ? undefined : Number(actual),
        forecastFinishDate: forecastFinish || undefined,
        source: source.trim(),
      });
      toast.success("Opening Position declared.");
      onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the Opening Position.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Declare Opening Position</DialogTitle>
          <DialogDescription>
            One honest starting position, as of a data date. Leave planned or
            actual blank if it is genuinely not known — absence is not zero.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="op-date">Data Date *</Label>
            <Input id="op-date" type="date" value={dataDate} onChange={(e) => setDataDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="op-planned">Planned %</Label>
              <Input id="op-planned" inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="op-actual">Actual %</Label>
              <Input id="op-actual" inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="op-forecast">Forecast Finish</Label>
            <Input id="op-forecast" type="date" value={forecastFinish} onChange={(e) => setForecastFinish(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="op-source">Source *</Label>
            <Textarea
              id="op-source"
              rows={2}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. Prior contractor S-curve, Client handover report"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            {saving ? "Saving…" : "Save Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
