"use client";

import * as React from "react";
import { toast } from "sonner";

import type { MasterRecordBase } from "@/types";
import type { HierarchyTerms } from "@/config/project-terminology";
import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { getMasterService, MASTER_KIND_CONFIG } from "../services";
import type { MasterKind } from "../types";
import {
  BlockedDeleteDialog,
  ConfirmArchiveDialog,
  ConfirmDeleteDialog,
  ConfirmRestoreDialog,
} from "./confirm-dialogs";

/**
 * Encapsulates archive / restore / safe-delete for a master-data kind:
 * confirmation dialogs, the blocked-delete flow (with "Archive instead"),
 * toasts, and change notification. Returns request handlers plus the
 * dialog elements to render.
 */
export function useMasterDataActions(
  kind: MasterKind,
  options: { onMutated?: () => void; displayTerms?: HierarchyTerms } = {}
) {
  const { isGlobalAuthority, resolved } = useCurrentIdentity();
  const service = getMasterService(kind);
  const config = MASTER_KIND_CONFIG[kind];
  const singular = options.displayTerms?.singular ?? config.singular;
  const plural = options.displayTerms?.plural ?? config.plural;
  const singularLower =
    options.displayTerms?.singularLower ?? singular.toLowerCase();
  const kindLabel = options.displayTerms?.pluralLower ?? plural.toLowerCase();
  const { onMutated } = options;

  const [archiveTarget, setArchiveTarget] =
    React.useState<MasterRecordBase | null>(null);
  const [restoreTarget, setRestoreTarget] =
    React.useState<MasterRecordBase | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<MasterRecordBase | null>(null);
  const [blocked, setBlocked] = React.useState<{
    record: MasterRecordBase;
    usedBy: string[];
  } | null>(null);

  const requestArchive = (record: MasterRecordBase) => setArchiveTarget(record);
  const requestRestore = (record: MasterRecordBase) => setRestoreTarget(record);
  const requestDelete = async (record: MasterRecordBase) => {
    const result = await service.canDelete(record.id);
    if (result.allowed) {
      setDeleteTarget(record);
    } else {
      setBlocked({ record, usedBy: result.usedBy });
    }
  };

  const element = (
    <>
      <ConfirmArchiveDialog
        open={archiveTarget !== null}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        name={archiveTarget?.name ?? ""}
        kindLabel={kindLabel}
        onConfirm={async () => {
          if (!archiveTarget) return;
          await service.archive(archiveTarget.id);
          toast.success(`${singular} archived`);
          setArchiveTarget(null);
          onMutated?.();
        }}
      />
      <ConfirmRestoreDialog
        open={restoreTarget !== null}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        name={restoreTarget?.name ?? ""}
        kindLabel={kindLabel}
        onConfirm={async () => {
          if (!restoreTarget) return;
          await service.restore(restoreTarget.id);
          toast.success(`${singular} restored`);
          setRestoreTarget(null);
          onMutated?.();
        }}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        name={deleteTarget?.name ?? ""}
        kindLabel={kindLabel}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await service.delete(deleteTarget.id);
          toast.success(`${singular} deleted`);
          setDeleteTarget(null);
          onMutated?.();
        }}
      />
      <BlockedDeleteDialog
        open={blocked !== null}
        onOpenChange={(o) => !o && setBlocked(null)}
        name={blocked?.record.name ?? ""}
        kindLabel={singularLower}
        usedBy={blocked?.usedBy ?? []}
        canArchive={blocked?.record.active ?? false}
        onArchive={async () => {
          if (!blocked) return;
          await service.archive(blocked.record.id);
          toast.success(`${singular} archived`);
          setBlocked(null);
          onMutated?.();
        }}
      />
    </>
  );

  return {
    requestArchive,
    requestRestore,
    requestDelete,
    element,
    /**
     * Whether this account may mutate master data at all.
     *
     * Every master-data table carries the SAME policy for INSERT, UPDATE and
     * DELETE — `has_global_operational_authority()`, i.e. System Admin or
     * Project Control Admin — while SELECT is `USING (true)`. So one answer
     * covers Add, Edit, Archive, Restore and Delete across all seven kinds,
     * and reading stays open to everyone.
     *
     * Surfaced here rather than resolved in each view because every view that
     * renders those controls already calls this hook.
     *
     * PRESENTATION AUTHORITY ONLY — RLS remains the boundary.
     */
    canMutate: isGlobalAuthority,
    /** False until identity settles, so no control flashes before it is known. */
    authorityResolved: resolved,
  };
}
