import type { StructureFamily } from "@/types";

/**
 * What the new-project setup sidebar needs to know about the unsaved project
 * being created: only the Project Type chosen so far, so it can show that
 * type's setup steps. The form owns the values; it publishes this one fact
 * while /projects/new is open and clears it when it unmounts.
 *
 * Pure (no React): a subscribe/snapshot pair for `useSyncExternalStore`.
 */
export interface NewProjectDraftState {
  structureFamily?: StructureFamily;
}

const EMPTY: NewProjectDraftState = {};
let state: NewProjectDraftState = EMPTY;
const listeners = new Set<() => void>();

export function getNewProjectDraft(): NewProjectDraftState {
  return state;
}

/** Server render and first client render: nothing chosen yet. */
export function getServerNewProjectDraft(): NewProjectDraftState {
  return EMPTY;
}

export function subscribeNewProjectDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setNewProjectDraft(next: NewProjectDraftState): void {
  if (next.structureFamily === state.structureFamily) return;
  state = next.structureFamily ? { structureFamily: next.structureFamily } : EMPTY;
  for (const listener of listeners) listener();
}

export function clearNewProjectDraft(): void {
  setNewProjectDraft({});
}
