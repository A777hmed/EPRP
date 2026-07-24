"use client";

import * as React from "react";

import type { MasterRecordBase } from "@/types";
import { getMasterService } from "./services";
import type { MasterKind } from "./types";

/**
 * Subscribe to a master-data kind. Re-renders automatically whenever the
 * kind's store changes (create / update / archive / restore / delete),
 * which keeps every managed select in sync.
 */
export function useMasterData(kind: MasterKind): {
  records: MasterRecordBase[];
  activeRecords: MasterRecordBase[];
} {
  const service = getMasterService(kind);

  const subscribe = React.useCallback(
    (onStoreChange: () => void) => service.subscribe(onStoreChange),
    [service]
  );
  const records = React.useSyncExternalStore(
    subscribe,
    () => service.getAllSync(),
    () => service.getAllSync()
  );

  const activeRecords = React.useMemo(
    () => records.filter((r) => r.active),
    [records]
  );

  return { records, activeRecords };
}
