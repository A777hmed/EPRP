/** Shared copy for Users & Roles confirmations — kept in one place so the
 * row-level quick actions and the Edit dialog never say this differently. */

export const ACTIVE_FIELD_DESCRIPTION =
  "Controls database-enforced platform access. Does not immediately revoke an existing Auth session.";

export const SET_INACTIVE_WARNING =
  "This blocks database-enforced platform actions for this account. An existing authenticated session may remain signed in until it expires or the user signs out.";

export const UNLINK_PERSON_DESCRIPTION =
  "This removes only the identity link between this login account and the person record. It does not delete the Contact, project assignments, Weekly/Monthly history, sign-off snapshots, or the Auth account. Any project-scoped access this login derived from the linked person will no longer apply until it is relinked.";

export function changeLinkedPersonDescription(
  fromName?: string,
  toName?: string
): string {
  return `This changes who this login account represents${
    fromName ? ` — from ${fromName}` : ""
  }${
    toName ? ` to ${toName}` : ""
  }. Effective project scope, derived from the linked person, may change as soon as this is saved. Project assignments themselves are not moved, copied, or edited.`;
}

export const LAST_ADMIN_BLOCKED_MESSAGE =
  "Cannot proceed — this is the last active System Administrator, and the platform must keep at least one.";
