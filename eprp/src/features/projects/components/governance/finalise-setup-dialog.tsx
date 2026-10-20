"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { setupGovernanceService } from "@/services/setup-governance-service";
import type { SetupFinalisation } from "../../reported-progress";

/**
 * The statement the user confirms, stored with the finalisation exactly as
 * shown (`project_setup_finalisations.acknowledgement`).
 */
export const FINALISE_ACKNOWLEDGEMENT =
  "I confirm that core Project Setup becomes controlled and changes require an amendment from now on. " +
  "The project stays Reported — not planning governed: no Planning Snapshot, PV, EV or SPI is created. " +
  "Finalisation cannot be undone.";

export const FINALISE_EXPLANATION =
  "This project does not use a formal governed schedule. Finalising locks core Setup configuration under " +
  "amendment control. It does not create a Planning Snapshot or SPI.";

export function FinaliseSetupDialog({
  projectId,
  open,
  onOpenChange,
  onFinalised,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinalised: (finalisation: SetupFinalisation) => void;
}) {
  const [confirmed, setConfirmed] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const confirmId = React.useId();
  const noteId = React.useId();

  const close = (next: boolean) => {
    if (saving) return;
    if (!next) {
      setConfirmed(false);
      setNote("");
    }
    onOpenChange(next);
  };

  const finalise = async () => {
    if (!confirmed) return;
    setSaving(true);
    try {
      const finalisation = await setupGovernanceService.finaliseSetup({
        projectId,
        acknowledgement: FINALISE_ACKNOWLEDGEMENT,
        note,
      });
      toast.success("Project Setup finalised. Core configuration is now controlled.");
      onFinalised(finalisation);
      setConfirmed(false);
      setNote("");
      onOpenChange(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Project Setup could not be finalised.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Finalise Project Setup</DialogTitle>
          <DialogDescription>{FINALISE_EXPLANATION}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Team, contacts, location, branding and lifecycle fields still save directly and are recorded.</li>
          <li>Identity, contract, schedule-reference and reporting settings change only by amendment.</li>
          <li>Reported Progress can be recorded after finalisation. SPI stays N/A.</li>
          <li>Finalisation is permanent. A later move to a formal schedule is a governed change; it does not undo this.</li>
        </ul>
        <Field orientation="horizontal" className="items-start rounded-lg border border-warning/30 bg-warning/[0.07] p-3">
          <Checkbox id={confirmId} checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />
          <FieldLabel htmlFor={confirmId} className="text-sm font-normal leading-snug text-pretty">
            {FINALISE_ACKNOWLEDGEMENT}
          </FieldLabel>
        </Field>
        <Field>
          <FieldLabel htmlFor={noteId}>Note (optional)</FieldLabel>
          <Textarea id={noteId} rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)}
            placeholder="Context for the record, e.g. why the project has no formal schedule" />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void finalise()} disabled={!confirmed || saving}>
            {saving && <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Finalise Project Setup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
