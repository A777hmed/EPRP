"use client";

import * as React from "react";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MASTER_KIND_CONFIG } from "../services";
import type { MasterKind } from "../types";
import { useMasterData } from "../use-master-data";
import { MasterDataDialog } from "./master-data-dialog";

export interface MasterRecordEditButtonProps {
  kind: MasterKind;
  /** Record to edit. Empty means nothing is selected and the button is off. */
  recordId: string;
  /** Fires after any successful mutation, for unsaved-changes tracking. */
  onMutated?: () => void;
  disabled?: boolean;
  /** Render with a visible label instead of icon-only. */
  withLabel?: boolean;
}

/**
 * Edit the record a field already has selected, in place.
 *
 * The Manage surface reaches a record through a list and a search box, which
 * is the wrong shape when the user is looking straight at the person they want
 * to change: they have already chosen them, and being asked to find them again
 * is the complaint this answers. This opens that exact record's form, and
 * closes back to the calling form on save — the caller never navigates, so
 * whatever section and scroll position they were in is still there, along with
 * any unsaved edits elsewhere on the form.
 *
 * The underlying record is edited once, in the shared master data. Nothing is
 * copied onto the project and no second record is created.
 */
export function MasterRecordEditButton({
  kind,
  recordId,
  onMutated,
  disabled = false,
  withLabel = false,
}: MasterRecordEditButtonProps) {
  const config = MASTER_KIND_CONFIG[kind];
  const { records } = useMasterData(kind);
  const [open, setOpen] = React.useState(false);

  const selected = records.find((record) => record.id === recordId);
  const singularLower = config.singular.toLowerCase();
  const label = selected
    ? `Edit ${selected.name}`
    : `Edit selected ${singularLower}`;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={withLabel ? "sm" : "icon"}
        disabled={disabled || !selected}
        aria-label={withLabel ? undefined : label}
        title={
          selected ? label : `Select a ${singularLower} first`
        }
        onClick={() => setOpen(true)}
      >
        <PenLine
          data-icon={withLabel ? "inline-start" : undefined}
          aria-hidden="true"
        />
        {withLabel && `Edit ${config.singular}`}
      </Button>

      <MasterDataDialog
        kind={kind}
        open={open}
        onOpenChange={setOpen}
        initialMode="edit"
        initialRecordId={recordId}
        onMutated={onMutated}
      />
    </>
  );
}
