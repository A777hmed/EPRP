"use client";

import * as React from "react";

import { ConfirmDialog } from "@/components/shared";

export interface ConfirmArchiveDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  projectName: string;
  onConfirm: () => void | Promise<void>;
}

/** Confirmation for archiving a project (reversible, but consequential). */
export function ConfirmArchiveDialog({
  trigger,
  open,
  onOpenChange,
  projectName,
  onConfirm,
}: ConfirmArchiveDialogProps) {
  return (
    <ConfirmDialog
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      title={`Archive “${projectName}”?`}
      description="Archived projects are hidden from active views and reporting. You can restore the project later from Administration."
      confirmLabel="Archive project"
      destructive
      onConfirm={onConfirm}
    />
  );
}
