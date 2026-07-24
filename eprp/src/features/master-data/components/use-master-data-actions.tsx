"use client";

import * as React from "react";
import { toast } from "sonner";

import type { MasterRecordBase } from "@/types";
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
  options: { onMutated?: () => void } = {}
) {
  const service = getMasterService(kind);
  const config = MASTER_KIND_CONFIG[kind];
  const kindLabel = config.plural.toLowerCase();
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
          toast.success(`${config.singular} archived`);
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
          toast.success(`${config.singular} restored`);
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
          toast.success(`${config.singular} deleted`);
          setDeleteTarget(null);
          onMutated?.();
        }}
      />
      <BlockedDeleteDialog
        open={blocked !== null}
        onOpenChange={(o) => !o && setBlocked(null)}
        name={blocked?.record.name ?? ""}
        kindLabel={config.singular.toLowerCase()}
        usedBy={blocked?.usedBy ?? []}
        canArchive={blocked?.record.active ?? false}
        onArchive={async () => {
          if (!blocked) return;
          await service.archive(blocked.record.id);
          toast.success(`${config.singular} archived`);
          setBlocked(null);
          onMutated?.();
        }}
      />
    </>
  );

  return { requestArchive, requestRestore, requestDelete, element };
}
