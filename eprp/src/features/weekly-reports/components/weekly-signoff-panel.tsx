"use client";

/**
 * Report Sign-off — the editable Prepared / Reviewed / Approved block.
 *
 * WHAT IS SAVED IS A SNAPSHOT, NOT A REFERENCE.
 * The name and job title are copied into `weekly_reports.signatories` when the
 * author saves. `contactId` is kept only as a note of where the name was picked
 * from and is never re-resolved on read, so correcting somebody's job title in
 * Contacts next month cannot rewrite the signature block of a report that was
 * approved this week.
 *
 * Prepared By opens seeded from the project's Reporting Coordinator so an
 * untouched report still prints the right preparer. Reviewed and Approved open
 * EMPTY and are never guessed — naming a reviewer the business has not
 * appointed would put a person's name under an approval they never gave. The
 * signed-in account is never used for any role.
 *
 * A person who is not in Contacts can be typed in by name and job title, which
 * is why the snapshot column exists at all: the legacy
 * `prepared_by_contact_id` columns are foreign keys and have nowhere to put one.
 */

import * as React from "react";
import { ArrowDown, ArrowUp, Check, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SIGNATORY_ROLES,
  SIGNATORY_ROLE_LABEL,
  isSnapshotEmpty,
  newSignatoryId,
  signatoryContactId,
} from "@/lib/report-signatories";
import { useMasterData } from "@/features/master-data";
import { weeklyReportService } from "@/services/weekly-report-service";
import type {
  Contact,
  ReportSignatory,
  ReportSignatoryRole,
  SignatorySnapshot,
} from "@/types";

const ROLE_HINT: Record<ReportSignatoryRole, string> = {
  prepared: "Defaults to the project's Reporting Coordinator until you set one.",
  reviewed: "Nobody is assumed — choose or type the reviewer for this week.",
  approved: "Nobody is assumed — choose or type the approving authority.",
};

const MANUAL = "__manual__";

/**
 * A contact's printable job title.
 *
 * `Contact.jobTitleId` is a master-data reference, not a string, so the title
 * has to be resolved before it is SNAPSHOTTED into the report. Resolving at
 * save time is the point: the printed title is then frozen, and renaming the
 * Job Title record later cannot alter a report that was already signed.
 */
export function useContactTitle() {
  const { records } = useMasterData("jobTitle");
  return React.useCallback(
    (contact: Contact | undefined): string | undefined => {
      if (!contact?.jobTitleId) return undefined;
      const match = (records as { id: string; name: string }[]).find(
        (record) => record.id === contact.jobTitleId
      );
      return match?.name;
    },
    [records]
  );
}

/* ------------------------------- One role ---------------------------------- */

function RoleField({
  role,
  people,
  contacts,
  editable,
  onChange,
}: {
  role: ReportSignatoryRole;
  people: ReportSignatory[];
  contacts: Contact[];
  editable: boolean;
  onChange: (next: ReportSignatory[]) => void;
}) {
  const titleOf = useContactTitle();
  const [picker, setPicker] = React.useState("");
  const [manualName, setManualName] = React.useState("");
  const [manualTitle, setManualTitle] = React.useState("");
  const manualOpen = picker === MANUAL;

  const alreadyChosen = new Set(
    people.map((person) => person.contactId).filter(Boolean)
  );

  const addContact = (contactId: string) => {
    const contact = contacts.find((entry) => entry.id === contactId);
    if (!contact) return;
    onChange([
      ...people,
      {
        id: newSignatoryId(),
        name: contact.name,
        title: titleOf(contact),
        contactId: contact.id,
      },
    ]);
    setPicker("");
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name) {
      toast.error("Enter the person's name.");
      return;
    }
    onChange([
      ...people,
      { id: newSignatoryId(), name, title: manualTitle.trim() || undefined },
    ]);
    setManualName("");
    setManualTitle("");
    setPicker("");
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= people.length) return;
    const next = [...people];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2">
        <p className="text-xs font-semibold text-foreground">
          {SIGNATORY_ROLE_LABEL[role]}
        </p>
        <p className="text-[0.68rem] leading-snug text-muted-foreground">
          {ROLE_HINT[role]}
        </p>
      </div>

      {people.length === 0 ? (
        <p className="rounded-md border border-dashed px-2.5 py-2 text-[0.7rem] text-muted-foreground">
          Not recorded — the printed report shows a blank line for signature.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {people.map((person, index) => (
            <li
              key={person.id}
              className="flex items-start gap-2 rounded-md border bg-background px-2.5 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {person.name}
                </span>
                <span className="block truncate text-[0.66rem] text-muted-foreground">
                  {person.title ?? "Job title not recorded"}
                  {!person.contactId && " · typed in"}
                </span>
              </span>
              {editable && (
                <span className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move ${person.name} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move ${person.name} down`}
                    disabled={index === people.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${person.name}`}
                    onClick={() =>
                      onChange(people.filter((entry) => entry.id !== person.id))
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-2 grid gap-2">
          <Select
            value={picker}
            onValueChange={(value) =>
              value === MANUAL ? setPicker(MANUAL) : addContact(value)
            }
          >
            <SelectTrigger
              className="h-8 text-xs"
              aria-label={`Add a person to ${SIGNATORY_ROLE_LABEL[role]}`}
            >
              <SelectValue placeholder="Add a person…" />
            </SelectTrigger>
            <SelectContent>
              {contacts
                .filter((contact) => !alreadyChosen.has(contact.id))
                .map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.name}
                    {titleOf(contact) ? ` — ${titleOf(contact)}` : ""}
                  </SelectItem>
                ))}
              <SelectItem value={MANUAL}>
                Someone not in Contacts…
              </SelectItem>
            </SelectContent>
          </Select>

          {manualOpen && (
            <div className="grid gap-1.5 rounded-md border bg-muted/40 p-2">
              <Input
                className="h-8 text-xs"
                placeholder="Full name"
                aria-label="Name"
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
              />
              <Input
                className="h-8 text-xs"
                placeholder="Job title (optional)"
                aria-label="Job title"
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
              />
              <div className="flex gap-1.5">
                <Button size="xs" onClick={addManual}>
                  <Check aria-hidden /> Add
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setPicker("");
                    setManualName("");
                    setManualTitle("");
                  }}
                >
                  <X aria-hidden /> Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- The panel --------------------------------- */

export function WeeklySignoffPanel({
  reportId,
  contacts,
  /** Seed for Prepared By — the project's Reporting Coordinator, never the viewer. */
  defaultPrepared,
  saved,
  editable,
  onSaved,
}: {
  reportId: string;
  contacts: Contact[];
  defaultPrepared: ReportSignatory[];
  saved: SignatorySnapshot | undefined;
  editable: boolean;
  onSaved: (next: SignatorySnapshot) => void;
}) {
  /*
   * `null` means "nobody has touched this yet", which is different from "the
   * author cleared it". Seeding is therefore derived during render rather than
   * written into state — otherwise removing the seeded coordinator would
   * immediately re-add them.
   */
  const [edited, setEdited] = React.useState<SignatorySnapshot | null>(null);
  const [saving, setSaving] = React.useState(false);

  const snapshot = React.useMemo<SignatorySnapshot>(() => {
    if (edited) return edited;
    if (saved && !isSnapshotEmpty(saved)) return saved;
    return defaultPrepared.length ? { prepared: defaultPrepared } : {};
  }, [edited, saved, defaultPrepared]);

  const setRole = (role: ReportSignatoryRole, next: ReportSignatory[]) =>
    setEdited({ ...snapshot, [role]: next });

  const save = async () => {
    setSaving(true);
    try {
      /*
       * Two things are written, because the report needs both.
       *
       *   `signatories` is the SNAPSHOT — what prints, frozen at save time.
       *   The three contact columns are what the LIFECYCLE reads:
       *   `weekly_transition_blockers()` refuses "No reviewer recorded." on
       *   `reviewed_by_contact_id is null` and never consults the snapshot, so
       *   a sign-off saved only as a snapshot left the Weekly stuck at Under
       *   Review with the reviewer visibly named on screen.
       *
       * A role resolves to a Contact only when the person was PICKED from
       * Contacts. Someone typed in by hand has no Contact row and no id to
       * record, so that key is omitted entirely — the service writes a column
       * only for a key it is given (`input.x !== undefined`), so an omitted
       * role leaves whatever is already stored untouched rather than clearing
       * a sign-off that is already recorded.
       */
      const preparedByContactId = signatoryContactId(snapshot.prepared);
      const reviewedByContactId = signatoryContactId(snapshot.reviewed);
      const approvedByContactId = signatoryContactId(snapshot.approved);

      await weeklyReportService.update(reportId, {
        signatories: snapshot,
        ...(preparedByContactId ? { preparedByContactId } : {}),
        ...(reviewedByContactId ? { reviewedByContactId } : {}),
        ...(approvedByContactId ? { approvedByContactId } : {}),
      });
      onSaved(snapshot);
      setEdited(null);
      toast.success("Report sign-off saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the sign-off."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Report Sign-off"
      description="Names are copied into the report when saved, so later edits to Contacts cannot change an issued report. This block prints once, at the end of the PDF."
      action={
        editable ? (
          <Button size="sm" onClick={save} disabled={saving || !edited}>
            <Save aria-hidden />
            {saving ? "Saving…" : "Save sign-off"}
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SIGNATORY_ROLES.map((role) => (
          <RoleField
            key={role}
            role={role}
            people={snapshot[role] ?? []}
            contacts={contacts}
            editable={editable}
            onChange={(next) => setRole(role, next)}
          />
        ))}
      </div>
      {edited && (
        <p className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-warning">
          <Plus aria-hidden className="size-3" />
          Unsaved changes — the report still prints the last saved sign-off.
        </p>
      )}
    </SectionCard>
  );
}
