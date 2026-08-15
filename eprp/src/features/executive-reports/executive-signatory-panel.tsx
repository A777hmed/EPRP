"use client";

/**
 * The Signatory Selector — one control, used for all three sign-off roles.
 *
 * Each role can take a person from Contacts OR a free-typed name and job title,
 * can have that entry corrected for THIS report only, and can have it removed.
 * Prepared By, Reviewed By and Approved By all use this same component, so the
 * three blocks cannot drift apart in behaviour or appearance.
 *
 * A custom signatory is NOT written to Contacts. Executive sign-off frequently
 * names a client representative or a board member who has no reason to exist in
 * project master data, and silently creating master-data records as a side
 * effect of printing a report would pollute every contact dropdown in the
 * platform.
 *
 * What leaves this component is already the snapshot: a name and a job title as
 * they should print. Nothing here stores an id to be re-resolved later.
 */

import * as React from "react";
import { Check, Pencil, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Contact } from "@/types";
import {
  SIGNATORY_ROLE_HINT,
  SIGNATORY_ROLE_LABEL,
  newSignatoryId,
  type Signatory,
  type SignatoryRole,
} from "./executive-signatories";

interface SignatoryFieldProps {
  role: SignatoryRole;
  people: Signatory[];
  contacts: Contact[];
  onChange: (next: Signatory[]) => void;
}

/** Blank draft used by both "add custom" and "edit this entry". */
interface Draft {
  name: string;
  title: string;
}

const EMPTY_DRAFT: Draft = { name: "", title: "" };

export function SignatoryField({ role, people, contacts, onChange }: SignatoryFieldProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [addingCustom, setAddingCustom] = React.useState(false);

  const chosenContactIds = React.useMemo(
    () => new Set(people.map((person) => person.contactId).filter(Boolean)),
    [people]
  );

  // A contact already named for this role is not offered again — the same
  // person signing twice in one block is always a mistake.
  const available = React.useMemo(
    () => contacts.filter((contact) => !chosenContactIds.has(contact.id)),
    [contacts, chosenContactIds]
  );

  const closeEditors = () => {
    setEditingId(null);
    setAddingCustom(false);
    setDraft(EMPTY_DRAFT);
  };

  const addFromContact = (contactId: string) => {
    const contact = contacts.find((entry) => entry.id === contactId);
    if (!contact) return;
    // Copied, not referenced: this is the snapshot being taken.
    onChange([
      ...people,
      {
        id: newSignatoryId(),
        contactId: contact.id,
        name: contact.name,
        title: contact.position?.trim() || undefined,
      },
    ]);
  };

  const commitCustom = () => {
    const name = draft.name.trim();
    if (!name) return;
    onChange([
      ...people,
      { id: newSignatoryId(), name, title: draft.title.trim() || undefined },
    ]);
    closeEditors();
  };

  const commitEdit = () => {
    const name = draft.name.trim();
    if (!name || !editingId) return;
    onChange(
      people.map((person) =>
        person.id === editingId
          ? { ...person, name, title: draft.title.trim() || undefined }
          : person
      )
    );
    closeEditors();
  };

  const startEdit = (person: Signatory) => {
    setAddingCustom(false);
    setEditingId(person.id);
    setDraft({ name: person.name, title: person.title ?? "" });
  };

  const remove = (id: string) => {
    onChange(people.filter((person) => person.id !== id));
    if (editingId === id) closeEditors();
  };

  const fieldId = `exec-sig-${role}`;

  return (
    <section className="exec-sig-field">
      <div className="exec-sig-head">
        <b>{SIGNATORY_ROLE_LABEL[role]}</b>
        <small>{SIGNATORY_ROLE_HINT[role]}</small>
      </div>

      {people.length ? (
        <ul className="exec-sig-list">
          {people.map((person) =>
            editingId === person.id ? (
              <li className="exec-sig-item exec-sig-editing" key={person.id}>
                <DraftFields
                  draft={draft}
                  setDraft={setDraft}
                  idPrefix={`${fieldId}-edit`}
                  onSubmit={commitEdit}
                />
                <div className="exec-sig-item-actions">
                  <Button size="sm" onClick={commitEdit} disabled={!draft.name.trim()}>
                    <Check aria-hidden /> Done
                  </Button>
                  <Button size="sm" variant="ghost" onClick={closeEditors}>
                    Cancel
                  </Button>
                </div>
              </li>
            ) : (
              <li className="exec-sig-item" key={person.id}>
                <div className="exec-sig-person">
                  <span>{person.name}</span>
                  <em>{person.title || "No job title recorded"}</em>
                  {person.projects?.length ? <i>{person.projects.join(", ")}</i> : null}
                </div>
                <span className={person.contactId ? "exec-sig-tag" : "exec-sig-tag is-custom"}>
                  {person.contactId ? "From Contacts" : "Custom"}
                </span>
                <div className="exec-sig-item-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEdit(person)}
                    aria-label={`Edit ${person.name} for this report`}
                  >
                    <Pencil aria-hidden /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(person.id)}
                    aria-label={`Remove ${person.name}`}
                  >
                    <Trash2 aria-hidden /> Remove
                  </Button>
                </div>
              </li>
            )
          )}
        </ul>
      ) : (
        <p className="exec-sig-empty">
          Nobody assigned — this role prints a blank signature line for completion by hand.
        </p>
      )}

      {addingCustom ? (
        <div className="exec-sig-item exec-sig-editing">
          <DraftFields
            draft={draft}
            setDraft={setDraft}
            idPrefix={`${fieldId}-new`}
            onSubmit={commitCustom}
          />
          <div className="exec-sig-item-actions">
            <Button size="sm" onClick={commitCustom} disabled={!draft.name.trim()}>
              <Check aria-hidden /> Add
            </Button>
            <Button size="sm" variant="ghost" onClick={closeEditors}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="exec-sig-add">
          <label htmlFor={`${fieldId}-pick`}>
            <span>Add from Contacts</span>
            <select
              id={`${fieldId}-pick`}
              value=""
              disabled={available.length === 0}
              onChange={(event) => {
                if (event.target.value) addFromContact(event.target.value);
              }}
            >
              <option value="">
                {available.length ? "Select a person…" : "No further contacts available"}
              </option>
              {available.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.position ? ` — ${contact.position}` : ""}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingId(null);
              setDraft(EMPTY_DRAFT);
              setAddingCustom(true);
            }}
          >
            <UserPlus aria-hidden /> Add Custom Signatory
          </Button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------ Draft fields ------------------------------- */

function DraftFields({
  draft,
  setDraft,
  idPrefix,
  onSubmit,
}: {
  draft: Draft;
  setDraft: (next: Draft) => void;
  idPrefix: string;
  onSubmit: () => void;
}) {
  return (
    <div className="exec-sig-draft">
      <label htmlFor={`${idPrefix}-name`}>
        <span>Full Name</span>
        <input
          id={`${idPrefix}-name`}
          value={draft.name}
          autoComplete="off"
          placeholder="e.g. Ahmed Morsy"
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
      <label htmlFor={`${idPrefix}-title`}>
        <span>Job Title / Position</span>
        <input
          id={`${idPrefix}-title`}
          value={draft.title}
          autoComplete="off"
          placeholder="e.g. Chairman"
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
    </div>
  );
}

/* ------------------------------ Whole block -------------------------------- */

export function SignatoryEditor({
  snapshot,
  contacts,
  onChange,
}: {
  snapshot: Partial<Record<SignatoryRole, Signatory[]>>;
  contacts: Contact[];
  onChange: (role: SignatoryRole, next: Signatory[]) => void;
}) {
  return (
    <div className="exec-sig-grid">
      {(["prepared", "reviewed", "approved"] as SignatoryRole[]).map((role) => (
        <SignatoryField
          key={role}
          role={role}
          people={snapshot[role] ?? []}
          contacts={contacts}
          onChange={(next) => onChange(role, next)}
        />
      ))}
    </div>
  );
}
