import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Building2,
  CircleDashed,
  HardHat,
  Handshake,
  Lock,
  PenLine,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Contact } from "@/types";
import {
  responsibilityPerson,
  type ResponsibilityEntry,
} from "@/features/projects/responsibilities";
import {
  REPLACE_PERSON_HELP_TEXT,
  REPLACE_PERSON_POSITION_HELP_TEXT,
} from "@/features/projects/responsibility-guard";
import type { ResponsibilityGroupKey } from "@/features/projects/responsibility-groups";
import { PROJECT_SETUP_ARCHIVED_MESSAGE } from "@/features/projects/setup-save";

/**
 * Role-themed accent per card, drawn from the theme's own chart palette so it
 * follows light and dark without hardcoded colour. Class names are written out
 * in full because Tailwind reads them statically — composing them from a
 * variable would leave the utilities ungenerated.
 *
 * The five fixed roles each take a distinct hue; every additional position
 * shares one, so the grid reads as "the fixed five, plus the extras" at a
 * glance. Presentation only — nothing here affects ordering or behaviour.
 */
const RESPONSIBILITY_ACCENTS: Record<
  string,
  { stripe: string; tint: string; icon: string }
> = {
  projectManagerId: {
    stripe: "bg-chart-2",
    tint: "bg-chart-2/15",
    icon: "text-chart-2",
  },
  projectControlManagerId: {
    stripe: "bg-chart-1",
    tint: "bg-chart-1/15",
    icon: "text-chart-1",
  },
  clientRepresentativeId: {
    stripe: "bg-chart-3",
    tint: "bg-chart-3/15",
    icon: "text-chart-3",
  },
  reportingCoordinatorId: {
    stripe: "bg-primary",
    tint: "bg-primary/15",
    icon: "text-primary",
  },
  projectSponsorId: {
    stripe: "bg-chart-5",
    tint: "bg-chart-5/15",
    icon: "text-chart-5",
  },
  additional: {
    stripe: "bg-chart-4",
    tint: "bg-chart-4/15",
    icon: "text-chart-4",
  },
};

const accentFor = (entry: ResponsibilityEntry) =>
  RESPONSIBILITY_ACCENTS[entry.fixedField ?? "additional"] ??
  RESPONSIBILITY_ACCENTS.additional;

/**
 * Small pill beside the role name. Quiet by design — it labels, not shouts.
 * Also used by the People Organization Chart cards.
 */
export function ResponsibilityBadge({
  tone,
  children,
}: {
  tone: "muted" | "additional" | "warning" | "governed";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4",
        tone === "muted" && "text-muted-foreground",
        tone === "additional" && "border-chart-4/40 text-chart-4",
        tone === "warning" && "border-warning/40 text-warning",
        tone === "governed" && "border-primary/40 text-primary"
      )}
    >
      {children}
    </span>
  );
}

/** The governed footer's full meaning (tooltip and the action's accessible name). */
const REPLACE_PERSON_FOOTER =
  "Already assigned — use Replace Person in Team & Responsibilities to change it.";

/**
 * One resting card: role, holder, job title · party, note.
 *
 * A quiet card face with a role-coloured edge. The holder is the primary
 * line; the role labels it; job title and the holder's project party sit
 * below as one line of metadata. Text only: a card the user is not editing
 * should not look like a form that has been switched off.
 */
export function ResponsibilityCard({
  entry,
  contacts,
  onEdit,
  onDelete,
  busy,
  locked,
  teamHref,
  party,
  needsParty = false,
  archived = false,
}: {
  entry: ResponsibilityEntry;
  contacts: Contact[];
  onEdit: () => void;
  onDelete?: () => void;
  busy: boolean;
  /** Already holds a person — a raw setup save may not reassign it. */
  locked: boolean;
  /** Team & Responsibilities, where Replace Person actually lives. */
  teamHref?: string;
  /** The holder's party on this project, when known (e.g. "EPROM"). */
  party?: string;
  /** The holder has no recorded party on this project (a data-quality flag). */
  needsParty?: boolean;
  /**
   * 2C.3E: the project is archived, so its setup is read-only. The card still
   * shows who holds the role, but offers no Replace Person action.
   */
  archived?: boolean;
}) {
  const person = responsibilityPerson(entry, contacts);
  const unfilled = !entry.contactId;
  const accent = accentFor(entry);
  const helpText = archived
    ? PROJECT_SETUP_ARCHIVED_MESSAGE
    : entry.kind === "additional"
      ? REPLACE_PERSON_POSITION_HELP_TEXT
      : REPLACE_PERSON_HELP_TEXT;
  // Job title · party (or the person's company when no party is recorded).
  const metadata = [
    person.position ?? "No job title",
    party ?? person.organization,
  ].filter(Boolean).join(" · ");

  return (
    <article
      data-responsibility-card={entry.key}
      className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-xs"
    >
      {/* Role-themed edge, the card's only strong colour. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-0.75", accent.stripe)}
        aria-hidden="true"
      />

      <div className="flex items-start gap-3 py-3 pr-2.5 pl-4">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            unfilled ? "bg-muted text-muted-foreground" : [accent.tint, accent.icon]
          )}
          aria-hidden="true"
        >
          <UserRound className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <p className="mr-0.5 min-w-0 truncate text-xs font-medium text-muted-foreground">
              {entry.roleLabel}
            </p>
            {entry.kind === "additional" ? (
              <ResponsibilityBadge tone="additional">
                Additional
              </ResponsibilityBadge>
            ) : (
              !entry.required && (
                <ResponsibilityBadge tone="muted">Optional</ResponsibilityBadge>
              )
            )}
            {entry.required && unfilled && (
              <ResponsibilityBadge tone="warning">Required</ResponsibilityBadge>
            )}
            {locked && (
              <ResponsibilityBadge tone="governed">Governed</ResponsibilityBadge>
            )}
            {needsParty && !unfilled && (
              <ResponsibilityBadge tone="warning">Needs party</ResponsibilityBadge>
            )}
          </div>

          {/* The holder — the line a reader scans for. */}
          <p
            className={cn(
              "mt-0.5 truncate text-sm leading-5",
              unfilled
                ? "text-muted-foreground"
                : "font-semibold text-foreground"
            )}
            title={person.name}
          >
            {person.name ?? (unfilled ? "Not assigned" : "Unknown contact")}
          </p>
          {/* An unfilled role has nothing more to say than "Not assigned". */}
          {!unfilled && (
            <p className="truncate text-xs text-muted-foreground" title={metadata}>
              {metadata}
            </p>
          )}
          {entry.notes && (
            <p className="mt-1 truncate text-xs text-muted-foreground/80 italic" title={entry.notes}>
              {entry.notes}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            disabled={busy || locked || archived}
            aria-label={
              archived
                ? `${entry.roleLabel} is read-only — this project is archived`
                : locked
                  ? `${entry.roleLabel} is already assigned — reassign it from Replace Person`
                  : `Edit ${entry.roleLabel}`
            }
            title={locked || archived ? helpText : undefined}
            onClick={onEdit}
          >
            <PenLine className="size-3.5" aria-hidden="true" />
          </Button>
          {/* Fixed roles are part of the project shape, so they are editable
              but never removable — only `onDelete` distinguishes them here. */}
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              disabled={busy || locked || archived}
              aria-label={
                archived
                  ? `${entry.roleLabel} is read-only — this project is archived`
                  : locked
                    ? `${entry.roleLabel} cannot be removed while assigned`
                    : `Remove ${entry.roleLabel}`
              }
              title={locked || archived ? helpText : undefined}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {/* Why the controls above are disabled: a short status and the one
          action that changes it. The full sentence is the tooltip and the
          action's accessible name. An archived project has no such action:
          the status stays, Replace Person is not offered. */}
      {locked && (
        <div
          className="mt-auto flex min-w-0 items-center justify-between gap-2 border-t border-border/60 py-1.5 pr-3 pl-4 text-[11px] leading-4 text-muted-foreground"
          title={teamHref && !archived ? REPLACE_PERSON_FOOTER : helpText}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Lock className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">Assigned</span>
          </span>
          {archived ? null : teamHref ? (
            <Link
              href={teamHref}
              aria-label={REPLACE_PERSON_FOOTER}
              className="inline-flex shrink-0 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
            >
              <ArrowLeftRight className="size-3" aria-hidden="true" />
              Replace Person
            </Link>
          ) : (
            <span className="shrink-0 font-medium">Use Replace Person</span>
          )}
        </div>
      )}
    </article>
  );
}

/* ------------------------------ party sections ------------------------------ */

/**
 * How each section is introduced. No coloured panels: colour is an accent on
 * the icon and the heading rule only. "Needs Party Assignment" is not a
 * party — it renders as a compact data-quality notice above its cards.
 * Class names are written out in full for Tailwind's static scan.
 */
const GROUP_META: Record<
  ResponsibilityGroupKey,
  {
    title: string;
    description: string;
    empty: string;
    icon: React.ComponentType<{ className?: string }>;
    /** Icon colour on a faint chip. */
    tile: string;
    /** Short accent under the heading. */
    rule: string;
  }
> = {
  eprom: {
    title: "EPROM",
    description: "Held by members of the EPROM team.",
    empty: "No EPROM team member holds a responsibility yet.",
    icon: Building2,
    tile: "bg-primary/10 text-primary",
    rule: "bg-primary",
  },
  client: {
    title: "Client",
    description: "Held by members of the Owner / Client team.",
    empty: "No Owner / Client team member holds a responsibility yet.",
    icon: Handshake,
    tile: "bg-chart-3/12 text-chart-3",
    rule: "bg-chart-3",
  },
  subcontractor: {
    title: "Subcontractor",
    description: "Held by members of a subcontractor's team.",
    empty: "No subcontractor team member holds a responsibility yet.",
    icon: HardHat,
    tile: "bg-chart-2/12 text-chart-2",
    rule: "bg-chart-2",
  },
  party_not_recorded: {
    title: "Needs Party Assignment",
    description:
      "The holder is not on the Project Team, or their party is not set yet. Complete it on the Project Team.",
    empty: "",
    icon: TriangleAlert,
    tile: "text-warning",
    rule: "bg-warning",
  },
  assigned: {
    title: "Assigned",
    description:
      "Grouped by party once the project is saved and its people join the Project Team.",
    empty: "",
    icon: UserRound,
    tile: "bg-muted text-muted-foreground",
    rule: "bg-muted-foreground/40",
  },
  unassigned: {
    title: "Unassigned Responsibilities",
    description: "Roles and positions with no holder yet.",
    empty: "",
    icon: CircleDashed,
    tile: "bg-muted text-muted-foreground",
    rule: "bg-muted-foreground/40",
  },
};

/**
 * One section of responsibilities: a slim heading (icon, name, count,
 * subtitle, a short accent rule) with the cards directly below in a
 * one / two / three-column grid. "Needs Party Assignment" is introduced by a
 * compact notice instead of a heading. An empty party section says so in one
 * quiet line.
 */
export function ResponsibilityGroupSection({
  groupKey,
  count,
  children,
}: {
  groupKey: ResponsibilityGroupKey;
  count: number;
  children?: React.ReactNode;
}) {
  const meta = GROUP_META[groupKey];
  const Icon = meta.icon;
  const titleId = `responsibility-group-${groupKey}`;
  const countBadge = (
    <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium leading-4 tabular-nums text-muted-foreground">
      {count}
      <span className="sr-only"> {count === 1 ? "responsibility" : "responsibilities"}</span>
    </span>
  );

  return (
    <section
      aria-labelledby={titleId}
      data-responsibility-group={groupKey}
      className="space-y-3"
    >
      {groupKey === "party_not_recorded" ? (
        <div
          role="note"
          className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.04] px-3 py-2"
        >
          <Icon className={cn("mt-0.5 size-4 shrink-0", meta.tile)} aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 id={titleId} className="text-sm font-medium leading-5">
                {meta.title}
              </h4>
              {countBadge}
            </div>
            <p className="text-pretty text-xs text-muted-foreground">{meta.description}</p>
          </div>
        </div>
      ) : (
        <header className="relative flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b pb-2">
          <span
            className={cn("grid size-6 shrink-0 place-items-center rounded-md", meta.tile)}
            aria-hidden="true"
          >
            <Icon className="size-3.5" />
          </span>
          <h4 id={titleId} className="text-sm font-semibold leading-5">
            {meta.title}
          </h4>
          {countBadge}
          <p className="min-w-0 basis-full text-pretty text-xs text-muted-foreground sm:ml-1 sm:basis-auto sm:truncate">
            {meta.description}
          </p>
          {/* A short coloured rule on the divider: the section's only accent. */}
          <span
            className={cn("absolute -bottom-px left-0 h-0.5 w-10 rounded-full", meta.rule)}
            aria-hidden="true"
          />
        </header>
      )}

      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{meta.empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      )}
    </section>
  );
}
