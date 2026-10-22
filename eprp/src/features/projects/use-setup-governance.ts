"use client";

import * as React from "react";

import {
  NOT_CONTROLLED,
  setupGovernanceService,
  type SetupControlState,
} from "@/services/setup-governance-service";
import type { SetupAmendment } from "./setup-amendments";
import { useReturnRefresh } from "./use-return-refresh";

/**
 * Phase 13.9B — the project's Setup control state and its amendments, loaded
 * together and reloadable after any governance action. Read-only: it decides
 * what the screens show, never what the database allows.
 */
export interface SetupGovernanceState {
  status: "loading" | "ready" | "error";
  control: SetupControlState;
  controlled: boolean;
  amendments: SetupAmendment[];
  /** The project the shown amendments were read for (set once a read completes). */
  loadedFor?: string;
  reload: () => void;
}

export function useSetupGovernance(projectId: string | undefined): SetupGovernanceState {
  const [state, setState] = React.useState<{
    status: SetupGovernanceState["status"];
    control: SetupControlState;
    amendments: SetupAmendment[];
    loadedFor?: string;
  }>({ status: projectId ? "loading" : "ready", control: NOT_CONTROLLED, amendments: [] });
  const [version, setVersion] = React.useState(0);
  const reload = React.useCallback(() => setVersion((current) => current + 1), []);
  // 13.11 UAT: a decision taken in another tab shows on return, no refresh needed.
  const returned = useReturnRefresh();

  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    Promise.all([
      setupGovernanceService.getControlState(projectId),
      setupGovernanceService.listProjectAmendments(projectId),
    ])
      .then(([control, amendments]) => {
        if (!cancelled) setState({ status: "ready", control, amendments, loadedFor: projectId });
      })
      .catch(() => {
        // Fail closed for presentation: an unknown state is shown as an error,
        // never as "not controlled" (which would offer direct edits the
        // database would then refuse).
        if (!cancelled) setState((previous) => ({ ...previous, status: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, version, returned]);

  // No project yet (a new project): nothing to govern.
  if (!projectId) {
    return { status: "ready", control: NOT_CONTROLLED, controlled: false, amendments: [], reload };
  }
  return {
    ...state,
    controlled: Boolean(state.control.controlledSince),
    reload,
  };
}
