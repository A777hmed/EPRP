"use client";

import * as React from "react";
import Link from "next/link";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASSIGNMENT_ROLE_META } from "@/lib/constants";
import type { ScopeItemResponsibility } from "../workspace";
import type { WeeklyNameLookup } from "./weekly-department-section";

/** The sentinel the Select uses for "nobody" — Radix rejects an empty value. */
const NONE = "__none__";

export interface ScopedPersonSelectProps {
  value: string;
  onChange: (contactId: string) => void;
  /**
   * The people who hold this exact scope item. Offered first, because the
   * person already responsible for the work is the likely owner of what it
   * needs.
   */
  responsible: ScopeItemResponsibility[];
  /** Everyone else the project assigned to the department. */
  department: ScopeItemResponsibility[];
  names: WeeklyNameLookup;
  disabled?: boolean;
  label?: string;
  /** Deep-links the empty state at this project's team page when known. */
  projectId?: string;
}

/**
 * Owner selection, limited to the project's own scoped assignments.
 *
 * Deliberately NOT `ManagedPersonSelect`, which offers every contact in master
 * data: an owner on a Weekly row is someone accountable on this project, in
 * this department, and offering the whole address book invited rows owned by
 * people with no assignment to the work. The candidates come from
 * `DepartmentSection.eligiblePeople` and `ScopeItemRow.responsible`, both read
 * from `project.team` — no new storage, and a change made in Project Setup is
 * reflected here on the next render.
 *
 * A person already saved on the row but since unassigned is still shown, and
 * marked, rather than silently dropped: the stored value is history and the
 * picker must not quietly rewrite it.
 */
export function ScopedPersonSelect({
  value,
  onChange,
  responsible,
  department,
  names,
  disabled,
  label = "Owner",
  projectId,
}: ScopedPersonSelectProps) {
  const options = React.useMemo(() => {
    const seen = new Set<string>();
    const out: { contactId: string; role?: string; stale?: boolean }[] = [];

    for (const entry of [...responsible, ...department]) {
      if (seen.has(entry.contactId)) continue;
      seen.add(entry.contactId);
      out.push({
        contactId: entry.contactId,
        role: ASSIGNMENT_ROLE_META[entry.assignmentRole].label,
      });
    }
    // Whoever is stored stays selectable even if the project moved on.
    if (value && !seen.has(value)) {
      out.push({ contactId: value, stale: true });
    }
    return out;
  }, [responsible, department, value]);

  /*
   * An empty picker must say WHY it is empty and where to fix it. Rendering a
   * disabled Select with no options reads as a broken control; this states the
   * cause and links to the page that resolves it.
   */
  if (options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No eligible owner —{" "}
        {projectId ? (
          <Link
            href={`/projects/${projectId}/team`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Manage Project Contacts
          </Link>
        ) : (
          <Link
            href="/contacts"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Manage Project Contacts
          </Link>
        )}
      </p>
    );
  }

  return (
    <Select
      value={value === "" ? NONE : value}
      onValueChange={(next) => onChange(next === NONE ? "" : next)}
    >
      <SelectTrigger className="w-full" disabled={disabled} aria-label={label}>
        <SelectValue placeholder={`${label}…`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No owner</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.contactId} value={option.contactId}>
            {names.person(option.contactId)?.name ?? "Unknown person"}
            <span className="ml-1 text-xs text-muted-foreground">
              {option.stale ? "no longer assigned" : option.role}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
