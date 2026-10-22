/**
 * Phase 13.11 UAT — ONE compact toast for every Project Setup amendment path:
 * the notification feed (approval needed / approved / rejected / not applied /
 * frozen) and the in-page actions (request, amend, approve, reject, withdraw).
 *
 * A toast is a glance: a short title, one context line ("project code ·
 * subject"), an optional View action. Values, reason, impact, people and dates
 * stay in the Notification Center card and the amendment record. Pure.
 */

import type { NotificationToastTone } from "@/features/notifications/model";
import type { SetupAmendment } from "./setup-amendments";
import { amendmentWording, isStructureAmendment } from "./structure-amendments";

export type AmendmentToastEvent =
  | "approval_needed"
  | "submitted"
  | "applied"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "stale"
  | "frozen";

export interface CompactToast {
  title: string;
  /** One line: "⟨project code⟩ · ⟨what⟩". */
  context: string;
  tone: NotificationToastTone;
}

const TITLE: Record<AmendmentToastEvent, string> = {
  approval_needed: "Approval needed",
  submitted: "Amendment requested",
  applied: "Amendment applied",
  approved: "Amendment approved",
  rejected: "Amendment rejected",
  withdrawn: "Request withdrawn",
  stale: "Amendment not applied",
  frozen: "Amendment frozen",
};

const TONE: Record<AmendmentToastEvent, NotificationToastTone> = {
  approval_needed: "approval",
  submitted: "pending",
  applied: "approved",
  approved: "approved",
  rejected: "rejected",
  withdrawn: "notice",
  stale: "notice",
  frozen: "notice",
};

/** The everyday name where the governed field label is long (display only). */
const SHORT_SUBJECT: Readonly<Record<string, string>> = {
  onboarding_mode: "Planning approach",
};

const CONTEXT_MAX = 90;
function clip(text: string): string {
  return text.length <= CONTEXT_MAX ? text : `${text.slice(0, CONTEXT_MAX - 1).trimEnd()}…`;
}

/** What the request is about, in a few words: "Planning approach", "Rename Unit · U2". */
export function amendmentToastSubject(
  amendment: Pick<SetupAmendment, "fieldKey" | "targetKey" | "previousValue" | "proposedValue"> | null
): string {
  if (!amendment) return "Project Setup request";
  if (!isStructureAmendment(amendment) && SHORT_SUBJECT[amendment.fieldKey]) return SHORT_SUBJECT[amendment.fieldKey];
  // The subject never depends on the values, so no value formatting is needed.
  return amendmentWording(amendment, () => "").subject;
}

export function compactAmendmentToast(
  event: AmendmentToastEvent,
  input: {
    projectCode: string | undefined;
    amendment: Pick<SetupAmendment, "fieldKey" | "targetKey" | "previousValue" | "proposedValue"> | null;
  }
): CompactToast {
  const subject = amendmentToastSubject(input.amendment);
  const field = input.amendment !== null && !isStructureAmendment(input.amendment);
  const what =
    (event === "approved" || event === "applied") && field ? `${subject} updated`
      : event === "submitted" ? `${subject} awaits approval`
        : event === "stale" ? `${subject} changed after the request`
          : subject;
  return {
    title: TITLE[event],
    context: clip([input.projectCode, what].filter(Boolean).join(" · ")),
    tone: TONE[event],
  };
}
