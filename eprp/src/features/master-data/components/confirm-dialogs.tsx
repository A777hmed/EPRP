"use client";

import { Archive } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared";

export interface ArchiveActionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  kindLabel: string;
  onConfirm: () => void | Promise<void>;
}

/** Confirm archiving a master-data record (reversible). */
export function ConfirmArchiveDialog({
  open,
  onOpenChange,
  name,
  kindLabel,
  onConfirm,
}: ArchiveActionProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Archive “${name}”?`}
      description={`Archived ${kindLabel} stay in historical records but are hidden from new selections. You can restore it later.`}
      confirmLabel="Archive"
      destructive
      onConfirm={onConfirm}
    />
  );
}

/** Confirm restoring an archived record. */
export function ConfirmRestoreDialog({
  open,
  onOpenChange,
  name,
  kindLabel,
  onConfirm,
}: ArchiveActionProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Restore “${name}”?`}
      description={`This ${kindLabel} becomes selectable again for new records.`}
      confirmLabel="Restore"
      onConfirm={onConfirm}
    />
  );
}

/** Confirm permanent deletion — only reached when the record is unused. */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  name,
  kindLabel,
  onConfirm,
}: ArchiveActionProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Permanently delete “${name}”?`}
      description={`This ${kindLabel} is not used anywhere and will be removed permanently. This action cannot be undone.`}
      confirmLabel="Delete permanently"
      destructive
      onConfirm={onConfirm}
    />
  );
}

export interface BlockedDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  kindLabel: string;
  usedBy: string[];
  /** Show the "Archive instead" action (record is currently active). */
  canArchive: boolean;
  onArchive: () => void | Promise<void>;
}

/**
 * Shown when a delete is blocked by references. Lists the referencing
 * records and offers Archive as the safe alternative.
 */
export function BlockedDeleteDialog({
  open,
  onOpenChange,
  name,
  kindLabel,
  usedBy,
  canArchive,
  onArchive,
}: BlockedDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>“{name}” cannot be deleted</DialogTitle>
          <DialogDescription>
            This {kindLabel} is still referenced and can only be archived. It is
            used by:
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-56 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-muted-foreground">
          {usedBy.map((usage) => (
            <li key={usage}>{usage}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canArchive && (
            <Button variant="destructive" onClick={onArchive}>
              <Archive data-icon="inline-start" aria-hidden="true" />
              Archive instead
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
