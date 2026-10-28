/**
 * Phase 13.12 — database refusals of the publish and baseline functions, as
 * sentences a planner can act on. Pure.
 *
 * Every 13.12 refusal is raised as "[CODE] Sentence." — the sentence is shown,
 * the code kept for tests and logs. A handful of inherited publish refusals
 * are already plain sentences. Anything else is never shown raw: it becomes
 * the caller's fallback.
 */

import type { PublishProblem } from "./publish-plan";

const CODED = /^\s*\[([A-Z0-9_]+)\]\s*([\s\S]+)$/;

/** Inherited plain-sentence refusals (the legacy publish wording kept by v2). */
const PLAIN_SENTENCES: readonly RegExp[] = [
  /^Publishing a Planning Snapshot requires Project Control authority on this project\.$/,
  /^A Data Date is required to publish\./,
  /^This import batch has already been published\./,
];

export function planningRefusal(
  error: { message?: string | null; code?: string | null } | null | undefined,
  fallback: string
): PublishProblem {
  const message = (error?.message ?? "").trim();
  const coded = CODED.exec(message);
  if (coded) return { code: coded[1], message: coded[2].trim() };
  if (PLAIN_SENTENCES.some((pattern) => pattern.test(message))) {
    return { code: error?.code ?? "REFUSED", message };
  }
  if (error?.code === "42501") {
    return { code: "NOT_AUTHORIZED", message: "You do not have permission to do this on this project." };
  }
  return { code: "UNEXPECTED", message: fallback };
}
