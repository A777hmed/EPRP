"use client";

import * as React from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  Building2,
  Info,
  Loader2,
  Lock,
  PenLine,
  Plus,
  Save,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  useForm,
  useFieldArray,
  useWatch,
  type Control,
  type FieldPath,
  type SubmitErrorHandler,
} from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared";
import {
  OVERALL_STATUS_META,
  PRIORITY_META,
  PROJECT_LIFECYCLE_META,
} from "@/lib/constants";
import type {
  Client,
  Contact,
  OverallStatus,
  Priority,
  Project,
  ProjectLifecycleStatus,
} from "@/types";
import {
  createProjectDraftSchema,
  createProjectFinalSchema,
  type ProjectFormValues,
} from "@/features/projects/schemas/project-form";
import {
  computeSectionStatuses,
  flattenFormErrors,
  labelForPath,
  type SummaryError,
} from "@/features/projects/form-meta";
import {
  projectResponsibilities,
  responsibilityPerson,
  type ResponsibilityEntry,
} from "@/features/projects/responsibilities";
import {
  isFixedResponsibilityOccupied,
  isProjectPositionOccupied,
  REPLACE_PERSON_HELP_TEXT,
  REPLACE_PERSON_POSITION_HELP_TEXT,
} from "@/features/projects/responsibility-guard";
import { projectSectionHref } from "@/config/project-sections";
import type { ProjectLinkContext } from "@/features/projects/project-link-context";
import {
  currencyOptions,
  languageOptions,
  timeZoneOptions,
  weekdayOptions,
  workingWeekOptions,
} from "@/features/projects/options";
import {
  ManagedPersonSelect,
  ManagedSelect,
  MasterRecordEditButton,
  type MasterKind,
  useMasterData,
} from "@/features/master-data";
import { RhfField } from "./form-field";
import { ProjectFormSection } from "./project-form-section";
import { ProjectScopeSummary } from "./project-scope-summary";
import { LogoUploadField } from "./logo-upload-field";

/* ------------------------- Local field shorthands ------------------------- */

interface BaseFieldProps {
  control: Control<ProjectFormValues>;
  name: FieldPath<ProjectFormValues>;
  label: string;
  required?: boolean;
  optional?: boolean;
  description?: string;
  className?: string;
}

function TextField({
  placeholder,
  type = "text",
  ...props
}: BaseFieldProps & { placeholder?: string; type?: string }) {
  return (
    <RhfField {...props}>
      {({ field, controlProps }) => (
        <Input
          {...controlProps}
          type={type}
          placeholder={placeholder}
          value={typeof field.value === "string" ? field.value : ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
          name={field.name}
          ref={field.ref}
        />
      )}
    </RhfField>
  );
}

function NumberField({
  min,
  max,
  ...props
}: BaseFieldProps & { min?: number; max?: number }) {
  return (
    <RhfField {...props}>
      {({ field, controlProps }) => (
        <Input
          {...controlProps}
          type="number"
          min={min}
          max={max}
          value={
            typeof field.value === "number" && Number.isFinite(field.value)
              ? String(field.value)
              : ""
          }
          onChange={(e) =>
            field.onChange(
              e.target.value === "" ? Number.NaN : e.target.valueAsNumber
            )
          }
          onBlur={field.onBlur}
          name={field.name}
          ref={field.ref}
        />
      )}
    </RhfField>
  );
}

function DateField(props: BaseFieldProps) {
  return <TextField {...props} type="date" />;
}

function SelectField({
  options,
  placeholder = "Select…",
  allowNone = false,
  ...props
}: BaseFieldProps & {
  options: { value: string; label: string }[];
  placeholder?: string;
  allowNone?: boolean;
}) {
  return (
    <RhfField {...props}>
      {({ field, controlProps }) => (
        <Select
          value={
            typeof field.value === "string" && field.value !== ""
              ? field.value
              : allowNone
                ? "none"
                : undefined
          }
          onValueChange={(v) => field.onChange(v === "none" ? "" : v)}
        >
          <SelectTrigger
            {...controlProps}
            className="w-full"
            onBlur={field.onBlur}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {allowNone && <SelectItem value="none">Not assigned</SelectItem>}
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </RhfField>
  );
}

function ManagedSelectField({
  kind,
  placeholder,
  allowClear = false,
  onMutated,
  ...props
}: BaseFieldProps & {
  kind: MasterKind;
  placeholder?: string;
  allowClear?: boolean;
  onMutated?: () => void;
}) {
  return (
    <RhfField {...props}>
      {({ field, controlProps }) => (
        <ManagedSelect
          kind={kind}
          value={typeof field.value === "string" ? field.value : ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
          placeholder={placeholder}
          allowClear={allowClear}
          clearLabel={`Clear ${props.label}`}
          controlProps={controlProps}
          onMutated={onMutated}
        />
      )}
    </RhfField>
  );
}

/* --------------------- Unified responsibility list ------------------------ */

/** Field name for the fixed role held in `entry`, for RHF binding. */
const fixedFieldOf = (
  entry: ResponsibilityEntry
): FieldPath<ProjectFormValues> =>
  entry.fixedField as FieldPath<ProjectFormValues>;

/**
 * One resting row: role, person, company, and an optional note.
 *
 * Deliberately plain text rather than disabled inputs — a row the user is not
 * editing should read like a record, not like a form someone switched off.
 */
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

/** Small pill beside the role name. Quiet by design — it labels, not shouts. */
function ResponsibilityBadge({
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

/**
 * One resting card: role, person, job title, company.
 *
 * Elevated rather than flat — a darker face than the section behind it, a soft
 * border and a small shadow — so the list reads as a set of records instead of
 * a stack of rows. Text only; a card the user is not editing should not look
 * like a form that has been switched off.
 */
function ResponsibilityRow({
  entry,
  contacts,
  onEdit,
  onDelete,
  busy,
  locked,
  teamHref,
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
}) {
  const person = responsibilityPerson(entry, contacts);
  const unfilled = !entry.contactId;
  const accent = accentFor(entry);
  const helpText =
    entry.kind === "additional"
      ? REPLACE_PERSON_POSITION_HELP_TEXT
      : REPLACE_PERSON_HELP_TEXT;

  return (
    <div className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background p-3 pl-4 shadow-sm">
      {/* Role-themed edge, the card's only strong colour. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accent.stripe)}
        aria-hidden="true"
      />

      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full",
            accent.tint,
            accent.icon
          )}
          aria-hidden="true"
        >
          <UserRound className="size-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="min-w-0 truncate text-sm font-semibold">
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
          </div>

          <p
            className={cn(
              "mt-0.5 truncate text-sm",
              unfilled && "text-muted-foreground"
            )}
          >
            {person.name ?? (unfilled ? "Not assigned" : "Unknown contact")}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {person.position ?? (unfilled ? "—" : "No job title")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7"
            disabled={busy || locked}
            aria-label={
              locked
                ? `${entry.roleLabel} is already assigned — reassign it from Replace Person`
                : `Edit ${entry.roleLabel}`
            }
            title={locked ? helpText : undefined}
            onClick={onEdit}
          >
            <PenLine className="size-3.5" aria-hidden="true" />
          </Button>
          {/* Fixed roles are part of the project shape, so they are editable
              but never removable — only `onDelete` distinguishes them here. */}
          {onDelete && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7"
              disabled={busy || locked}
              aria-label={
                locked
                  ? `${entry.roleLabel} cannot be removed while assigned`
                  : `Remove ${entry.roleLabel}`
              }
              title={locked ? helpText : undefined}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {person.organization ?? (unfilled ? "—" : "No organization")}
        </span>
      </div>

      {entry.notes && (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {entry.notes}
        </p>
      )}

      {/* Explains the disabled controls above in place, so a locked card reads
          as governed rather than broken. */}
      {locked && (
        <p className="mt-2 flex items-start gap-1.5 text-pretty text-xs text-muted-foreground">
          <Lock className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>
            {teamHref ? (
              <>
                Already assigned —{" "}
                <Link
                  href={teamHref}
                  className="underline underline-offset-2"
                >
                  use Replace Person in Team &amp; Responsibilities
                </Link>{" "}
                to change it.
              </>
            ) : (
              helpText
            )}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Project Responsibility as one list.
 *
 * The five fixed roles and the saved additional positions render identically;
 * what differs is where each is stored and therefore how it saves. A fixed
 * role's person is a form field and goes with the project's own save. An
 * additional position owns its row and persists as soon as its editor is
 * saved. The editor is a mode over one row, never a panel that stays open.
 */
function ResponsibilityList({
  entries,
  control,
  contacts,
  editingRow,
  onEditRow,
  onCancelRow,
  onSaveRow,
  onDeleteRow,
  canEditPositions,
  saving,
  onMutated,
  onClientRepresentativeChange,
  savedProject,
  teamHref,
}: {
  entries: ResponsibilityEntry[];
  control: Control<ProjectFormValues>;
  contacts: Contact[];
  editingRow: string | null;
  onEditRow: (key: string | null) => void;
  onCancelRow: (index: number) => void;
  onSaveRow: (index: number) => void;
  onDeleteRow: (index: number) => void;
  canEditPositions: boolean;
  saving: boolean;
  onMutated: () => void;
  onClientRepresentativeChange: (value: string, previous: string) => void;
  /**
   * The project as last saved — never the live draft — so a person picked in
   * this same editing session, before Save, does not immediately lock itself
   * back up. `undefined`/`null` (creating a new project) locks nothing.
   */
  savedProject: Project | null | undefined;
  /** Team & Responsibilities, where Replace Person actually lives. */
  teamHref?: string;
}) {
  return (
    <div className="space-y-3">
      {/* Two columns from `sm` up, one below. A card is short enough that two
          fit side by side without crowding, which roughly halves the height
          this section used to occupy. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => {
          const editing = editingRow === entry.key;
          /*
           * One editor at a time. Without this, opening a second row would
           * leave a half-filled new row sitting in the list as a resting row,
           * and the next save would silently drop it for being incomplete.
           */
          const blockedByOtherEditor = editingRow !== null && !editing;

          if (entry.kind === "fixed") {
            const locked = Boolean(
              savedProject &&
                entry.fixedField &&
                isFixedResponsibilityOccupied(savedProject, entry.fixedField)
            );
            if (!editing || locked) {
              return (
                <ResponsibilityRow
                  key={entry.key}
                  entry={entry}
                  contacts={contacts}
                  busy={saving || blockedByOtherEditor}
                  locked={locked}
                  teamHref={teamHref}
                  onEdit={() => onEditRow(entry.key)}
                />
              );
            }
            return (
              /* The editor needs the full width, so it spans both columns and
                 the resting cards reflow around it. */
              <div
                key={entry.key}
                className="space-y-2 rounded-xl border border-primary/40 bg-background p-3 shadow-sm sm:col-span-2 lg:col-span-3"
                data-field-name={entry.fixedField}
              >
                <PersonField
                  control={control}
                  name={fixedFieldOf(entry)}
                  label={entry.roleLabel}
                  required={entry.required}
                  optional={!entry.required}
                  allowClear={!entry.required}
                  onMutated={onMutated}
                  onValueChange={
                    entry.fixedField === "clientRepresentativeId"
                      ? onClientRepresentativeChange
                      : undefined
                  }
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Saved with the project — use the Save button at the bottom
                    of the form.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onEditRow(null)}
                  >
                    Done
                  </Button>
                </div>
              </div>
            );
          }

          const index = entry.positionIndex ?? 0;
          const locked = isProjectPositionOccupied(entry.positionId);
          if (!editing || locked) {
            return (
              <ResponsibilityRow
                key={entry.key}
                entry={entry}
                contacts={contacts}
                busy={saving || blockedByOtherEditor}
                locked={locked}
                teamHref={teamHref}
                onEdit={() => onEditRow(entry.key)}
                onDelete={locked ? undefined : () => onDeleteRow(index)}
              />
            );
          }

          return (
            <div
              key={entry.key}
              className="space-y-3 rounded-xl border border-primary/40 bg-background p-3 shadow-sm sm:col-span-2 lg:col-span-3"
              data-field-name="additionalPositions"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <ManagedSelectField
                  control={control}
                  name={`additionalPositions.${index}.jobTitleId`}
                  label="Position / Role"
                  required
                  kind="jobTitle"
                  placeholder="e.g. Delegate Manager…"
                  onMutated={onMutated}
                />
                <PersonField
                  control={control}
                  name={`additionalPositions.${index}.contactId`}
                  label="Person"
                  required
                  onMutated={onMutated}
                />
                <PositionOrganizationField
                  contactId={entry.contactId}
                  index={index}
                />
                <TextField
                  control={control}
                  name={`additionalPositions.${index}.notes`}
                  label="Note"
                  optional
                  placeholder="e.g. covers night shift"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => onCancelRow(index)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => onSaveRow(index)}
                >
                  {saving ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Save data-icon="inline-start" aria-hidden="true" />
                  )}
                  {saving ? "Saving…" : "Save Position"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Only the caveat stays at the foot; the action itself now lives in the
          section header, where it is visible without scrolling past the list. */}
      <p className="flex items-start gap-2 rounded-lg border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {canEditPositions
            ? "The five fixed roles cannot be removed. You can add a new position freely, but an existing position that already has a holder is governed — use Replace Person in Team & Responsibilities to change who holds it."
            : "Save the project first — additional positions attach to a saved project."}
        </span>
      </p>
    </div>
  );
}

/** The section header's "+ Add Position", kept beside the status badge. */
function AddPositionButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
    >
      <Plus data-icon="inline-start" aria-hidden="true" />
      Add Position
    </Button>
  );
}

/**
 * The Company / Organization of the person chosen in a position row.
 *
 * Read-only and resolved from the Person master record, so the organization
 * lives in exactly one place. Storing it on the position row would duplicate
 * it and let the two drift the moment someone changes employer.
 */
function PositionOrganizationField({
  contactId,
  index,
}: {
  contactId: string;
  index: number;
}) {
  const { records } = useMasterData("contact");
  const contact = records.find((record) => record.id === contactId) as
    | Contact
    | undefined;
  const organization = contact?.organization?.trim();
  const id = `position-${index}-organization`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        Company / Organization
        <span className="ml-1 font-normal text-muted-foreground">
          (from Person)
        </span>
      </Label>
      <Input
        id={id}
        readOnly
        value={organization ?? ""}
        placeholder={
          contact ? "Not set on this Person" : "Select a person first"
        }
        className="bg-muted/40"
      />
    </div>
  );
}

/**
 * The selected Client's short name / acronym, resolved from Client master data.
 *
 * Read-only on purpose. There is no project-level column for it, and adding
 * one would copy Client master data onto every project that names the same
 * Client — the duplication this platform explicitly forbids. So the value is
 * resolved from the one Client record, and Edit Client changes it at source,
 * for every project at once. Nothing here creates or copies a Client.
 */
function ClientShortNameField({
  clientId,
  onMutated,
}: {
  clientId: string;
  onMutated?: () => void;
}) {
  const { records } = useMasterData("client");
  const client = records.find((record) => record.id === clientId) as
    | Client
    | undefined;

  const value = client?.shortName?.trim();
  const description = !client
    ? "Select a Client above to resolve its short name."
    : value
      ? "Resolved from Client master data. Edit Client changes it everywhere the Client is used."
      : "This Client has no short name yet. Use Edit Client to add one.";

  return (
    <div className="space-y-1.5" data-field-name="clientShortName">
      <Label htmlFor="client-short-name">
        Client Short Name / Acronym
        <span className="ml-1 font-normal text-muted-foreground">
          (from Client)
        </span>
      </Label>
      <div className="flex gap-1.5">
        <Input
          id="client-short-name"
          readOnly
          value={value ?? ""}
          placeholder={client ? "Not set on this Client" : "No client selected"}
          className="min-w-0 flex-1 bg-muted/40"
        />
        <MasterRecordEditButton
          kind="client"
          recordId={clientId}
          onMutated={onMutated}
        />
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function PersonField({
  placeholder = "Search or select person…",
  allowClear = false,
  onMutated,
  onValueChange,
  ...props
}: BaseFieldProps & {
  placeholder?: string;
  allowClear?: boolean;
  onMutated?: () => void;
  onValueChange?: (value: string, previousValue: string) => void;
}) {
  return (
    <RhfField {...props}>
      {({ field, controlProps }) => {
        const selectedId = typeof field.value === "string" ? field.value : "";
        return (
          <div className="flex gap-1.5">
            <div className="min-w-0 flex-1">
              <ManagedPersonSelect
                value={selectedId}
                onChange={(value) => {
                  const previousValue =
                    typeof field.value === "string" ? field.value : "";
                  field.onChange(value);
                  onValueChange?.(value, previousValue);
                }}
                onBlur={field.onBlur}
                placeholder={placeholder}
                allowClear={allowClear}
                clearLabel={`Clear ${props.label}`}
                controlProps={controlProps}
                onMutated={onMutated}
              />
            </div>
            {/* Opens the person already chosen here, rather than sending the
                user to Manage People to search for someone they have just
                selected. Saving closes the dialog and leaves this form — and
                every unsaved edit on it — exactly as it was. */}
            <MasterRecordEditButton
              kind="contact"
              recordId={selectedId}
              onMutated={onMutated}
            />
          </div>
        );
      }}
    </RhfField>
  );
}

function SwitchField(props: BaseFieldProps) {
  return (
    <RhfField {...props}>
      {({ field, controlProps }) => (
        <Switch
          {...controlProps}
          checked={field.value === true}
          onCheckedChange={field.onChange}
          onBlur={field.onBlur}
          name={field.name}
          ref={field.ref}
        />
      )}
    </RhfField>
  );
}

function TextareaField({
  placeholder,
  rows = 4,
  ...props
}: BaseFieldProps & { placeholder?: string; rows?: number }) {
  return (
    <RhfField {...props} className="sm:col-span-2">
      {({ field, controlProps }) => (
        <Textarea
          {...controlProps}
          rows={rows}
          placeholder={placeholder}
          value={typeof field.value === "string" ? field.value : ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
          name={field.name}
          ref={field.ref}
        />
      )}
    </RhfField>
  );
}

/* ------------------------------ Option lists ------------------------------ */

const statusOptions = (
  Object.keys(PROJECT_LIFECYCLE_META) as ProjectLifecycleStatus[]
).map((s) => ({ value: s, label: PROJECT_LIFECYCLE_META[s].label }));
const overallOptions = (Object.keys(OVERALL_STATUS_META) as OverallStatus[]).map(
  (s) => ({ value: s, label: OVERALL_STATUS_META[s].label })
);
const priorityOptions = (Object.keys(PRIORITY_META) as Priority[]).map((p) => ({
  value: p,
  label: PRIORITY_META[p].label,
}));
const asOptions = (values: readonly string[]) =>
  values.map((v) => ({ value: v, label: v }));

/* ----------------------------- Focus handling ----------------------------- */

function focusField(fieldName: string) {
  const wrapper = document.querySelector(
    `[data-field-name="${CSS.escape(fieldName)}"]`
  );
  const target = wrapper ?? document.querySelector('[data-field-name="departments"]');
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = target.querySelector<HTMLElement>(
    "input, textarea, [role=combobox], [role=switch], button"
  );
  window.setTimeout(() => focusable?.focus({ preventScroll: true }), 250);
}

/* -------------------------------- Summary --------------------------------- */

function FormErrorSummary({
  title,
  errors,
}: {
  title: string;
  errors: SummaryError[];
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {errors.map((error) => (
          <li key={error.fieldName}>
            <button
              type="button"
              onClick={() => focusField(error.fieldName)}
              className="text-left text-sm text-destructive underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-destructive/30 rounded-sm outline-none"
            >
              {error.label}
              <span className="text-destructive/80"> — {error.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------- Form ----------------------------------- */

export interface ProjectFormProps {
  /** Set once the project exists, so the scope links can carry its id. */
  projectId?: string;
  /** Loaded project — supplies the linked team the form does not edit. */
  project?: Project | null;
  /**
   * The hosting route's project trail, passed straight to Linked Scope so a
   * record opened from there returns to this route rather than to Project
   * Edit. The Setup wizard supplies its own; Project Edit omits it.
   */
  linkContext?: ProjectLinkContext;
  /** Initial values — Edit passes the mapped project, Add passes defaults. */
  initialValues: ProjectFormValues;
  /** Codes already in use (current project's own code excluded by caller). */
  usedCodes: string[];
  submitLabel: string;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
  /** Save Draft: called with (possibly incomplete) values after draft validation. */
  onSaveDraft?: (values: ProjectFormValues) => Promise<void>;
  /**
   * Persist ONLY the additional positions, without submitting the rest of the
   * form. Omit it (or leave `projectId` unset) and the section's Save button
   * explains that the project has to exist first.
   */
  /**
   * Returns the rows as stored, so the form can adopt the ids the database
   * assigned. Without that, a later Save & Continue would treat freshly saved
   * rows as new, delete them and re-insert them under different ids.
   */
  onSavePositions?: (
    positions: ProjectFormValues["additionalPositions"]
  ) => Promise<ProjectFormValues["additionalPositions"]>;
  onCancel: () => void;
}

/**
 * The single project form used by both Add and Edit. Eight sections with
 * completion badges, draft vs. final Zod validation, an accessible error
 * summary, and an unsaved-changes guard on cancel.
 */
export function ProjectForm({
  projectId,
  project,
  linkContext,
  initialValues,
  usedCodes,
  submitLabel,
  onSubmit,
  onSaveDraft,
  onSavePositions,
  onCancel,
}: ProjectFormProps) {
  const finalSchema = React.useMemo(
    () => createProjectFinalSchema(usedCodes),
    [usedCodes]
  );
  const draftSchema = React.useMemo(
    () => createProjectDraftSchema(usedCodes),
    [usedCodes]
  );

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(finalSchema),
    defaultValues: initialValues,
    mode: "onBlur",
  });
  const { control, getValues, handleSubmit, formState, setValue } = form;
  const additionalSites = useFieldArray({ control, name: "additionalSites" });
  const additionalPositions = useFieldArray({
    control,
    name: "additionalPositions",
  });
  const { records: contactRecordBase } = useMasterData("contact");
  const contactRecords = contactRecordBase as Contact[];

  /*
   * Explicit save state for the additional positions.
   *
   * The section persists on its own, so it needs its own notion of "what is on
   * the server" — the snapshot is the last value known to be saved, whether
   * that came from the loaded project or from this button. Comparing against
   * it is what makes "Unsaved changes" honest, rather than inferring it from
   * RHF's dirty flags, which also trip on unrelated fields.
   */
  const [savingPositions, setSavingPositions] = React.useState(false);
  /**
   * The positions exactly as last stored, so cancelling a row editor can put
   * the row back instead of leaving a partial edit in the list.
   */
  const savedPositionRows = React.useRef<
    ProjectFormValues["additionalPositions"]
  >(initialValues.additionalPositions ?? []);
  /**
   * Which responsibility row is open in its editor, if any.
   *
   * Exactly one at a time: the list is the resting state and an editor is a
   * temporary mode over one row, which is what keeps additional positions from
   * sitting in a permanent panel of their own.
   */
  const [editingRow, setEditingRow] = React.useState<string | null>(null);

  const fillClientContactFromRepresentative = React.useCallback(
    (contactId: string, previousContactId: string) => {
      const contact = contactRecords.find((record) => record.id === contactId);
      if (!contact) return;
      const previous = contactRecords.find(
        (record) => record.id === previousContactId
      );
      const mappings = [
        ["clientContactName", contact.name, previous?.name],
        ["clientContactEmail", contact.email, previous?.email],
        ["clientContactPhone", contact.phone, previous?.phone],
      ] as const;

      for (const [fieldName, nextValue, previousValue] of mappings) {
        const currentValue = getValues(fieldName)?.trim() ?? "";
        const wasDerivedFromPrevious =
          Boolean(previousValue) && currentValue === previousValue;
        if (!currentValue || wasDerivedFromPrevious) {
          setValue(fieldName, nextValue ?? "", {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
      }
    },
    [contactRecords, getValues, setValue]
  );

  // useWatch returns DeepPartial, but the form always holds the full value
  // shape (defaultValues covers every field), so the assertion is safe.
  const watchedValues = useWatch({ control }) as ProjectFormValues;
  const sectionStatuses = React.useMemo(
    () => computeSectionStatuses(watchedValues, finalSchema, formState.errors),
    [watchedValues, finalSchema, formState.errors]
  );

  const [summary, setSummary] = React.useState<{
    title: string;
    errors: SummaryError[];
  } | null>(null);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  // Master-data mutations (add/edit/archive from managed selects) count as
  // unsaved work even when no project field changed yet.
  const [masterTouched, setMasterTouched] = React.useState(false);
  const markMasterTouched = React.useCallback(() => setMasterTouched(true), []);

  /* ------------------ Additional positions: explicit save ------------------ */

  const currentPositions = React.useMemo(
    () => watchedValues.additionalPositions ?? [],
    [watchedValues.additionalPositions]
  );
  /** Additional positions can only attach to a project that exists. */
  const canEditPositions =
    onSavePositions !== undefined && projectId !== undefined;

  const { records: jobTitleRecords } = useMasterData("jobTitle");
  const jobTitleName = React.useCallback(
    (id: string) => jobTitleRecords.find((record) => record.id === id)?.name,
    [jobTitleRecords]
  );

  /** The five fixed roles and the saved positions as ONE list. */
  const responsibilities = React.useMemo(
    () =>
      projectResponsibilities(
        { ...watchedValues, positions: currentPositions },
        jobTitleName
      ),
    [watchedValues, currentPositions, jobTitleName]
  );

  /**
   * Persist the additional positions and adopt the stored ids.
   *
   * Every path that changes a position — saving a row editor, deleting a row —
   * goes through here, so the list on screen and the rows in the database are
   * never more than one awaited call apart.
   */
  const persistPositions = async (
    next: ProjectFormValues["additionalPositions"],
    successMessage: string
  ): Promise<boolean> => {
    if (!onSavePositions || savingPositions) return false;
    setSavingPositions(true);
    try {
      const stored = await onSavePositions(next);
      // Replacing rather than patching keeps ids, order and notes in step with
      // what was actually written.
      additionalPositions.replace(stored);
      savedPositionRows.current = stored;
      toast.success(successMessage);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Could not save positions: ${error.message}`
          : "Could not save positions."
      );
      return false;
    } finally {
      setSavingPositions(false);
    }
  };

  const saveRowPosition = async (index: number) => {
    const row = getValues(`additionalPositions.${index}`);
    if (!row?.jobTitleId || !row?.contactId) {
      toast.error("A position needs both a Position / Role and a Person.");
      return;
    }
    const saved = await persistPositions(
      getValues("additionalPositions"),
      "Position saved"
    );
    if (saved) setEditingRow(null);
  };

  const deleteRowPosition = async (index: number) => {
    const remaining = getValues("additionalPositions").filter(
      (_, candidate) => candidate !== index
    );
    const saved = await persistPositions(remaining, "Position removed");
    if (saved) setEditingRow(null);
  };

  /**
   * Discard a row editor. An unsaved new row is dropped entirely; an existing
   * row is restored from what was last stored, so cancelling never half-applies
   * an edit.
   */
  const cancelRowEdit = (index: number) => {
    const row = getValues(`additionalPositions.${index}`);
    if (row && !row.id) additionalPositions.remove(index);
    else additionalPositions.replace(savedPositionRows.current);
    setEditingRow(null);
  };

  const addPositionRow = () => {
    additionalPositions.append({
      id: "",
      jobTitleId: "",
      contactId: "",
      notes: "",
    });
    setEditingRow(`position:new:${currentPositions.length}`);
  };

  const hasUnsavedWork = formState.isDirty || masterTouched;


  const onValid = async (values: ProjectFormValues) => {
    setSummary(null);
    await onSubmit(values);
  };

  const onInvalid: SubmitErrorHandler<ProjectFormValues> = (rhfErrors) => {
    const errors = flattenFormErrors(rhfErrors);
    setSummary({
      title: `Project cannot be created. Complete ${errors.length} required ${
        errors.length === 1 ? "field" : "fields"
      }.`,
      errors,
    });
    if (errors[0]) focusField(errors[0].fieldName);
  };

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return;
    setSummary(null);
    form.clearErrors();
    const values = form.getValues();
    const parsed = draftSchema.safeParse(values);
    if (!parsed.success) {
      const errors: SummaryError[] = parsed.error.issues.map((issue) => {
        const path = issue.path as (string | number)[];
        const fieldName = path.join(".");
        form.setError(fieldName as FieldPath<ProjectFormValues>, {
          type: "manual",
          message: issue.message,
        });
        return { fieldName, label: labelForPath(path), message: issue.message };
      });
      setSummary({
        title: `Draft cannot be saved. Fix ${errors.length} ${
          errors.length === 1 ? "field" : "fields"
        }.`,
        errors,
      });
      if (errors[0]) focusField(errors[0].fieldName);
      return;
    }
    try {
      setSavingDraft(true);
      await onSaveDraft(values);
      toast.success("Draft saved");
      form.reset(values);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleCancel = () => {
    if (hasUnsavedWork) {
      setDiscardOpen(true);
    } else {
      onCancel();
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Fields marked with{" "}
        <span className="font-semibold text-destructive" aria-hidden="true">
          *
        </span>
        <span className="sr-only">an asterisk</span> are required for final
        submission. You may save an incomplete project as a draft.
      </p>

      {summary && <FormErrorSummary title={summary.title} errors={summary.errors} />}

      <ProjectFormSection
        title="1. Basic Information"
        description="Identity and contract references."
        status={sectionStatuses[1]}
      >
        <TextField control={control} name="name" label="Project Name" required placeholder="e.g. Plant Systems Asset Integrity Management" />
        <TextField control={control} name="code" label="Project Code" required placeholder="e.g. PRJ-001, PSAIM-001, EPROM-2026-001" description="Uppercase letters, numbers, and dashes. Must be unique." />
        <TextField control={control} name="shortName" label="Project Short Name" optional placeholder="e.g. PSAIM – SOPC" />
        <ManagedSelectField control={control} name="clientId" label="Client" required kind="client" placeholder="Search or select client…" onMutated={markMasterTouched} />
        <ClientShortNameField clientId={watchedValues.clientId ?? ""} onMutated={markMasterTouched} />
        <TextField control={control} name="contractNumber" label="Contract Number" optional placeholder="e.g. SOPC-CN-2025-114" />
        <TextField control={control} name="purchaseOrderNumber" label="Purchase Order Number" optional placeholder="e.g. PO-88231" />
        <ManagedSelectField control={control} name="projectTypeId" label="Project Type" required kind="projectType" placeholder="Search or select project type…" onMutated={markMasterTouched} />
        <TextareaField control={control} name="description" label="Project Description" required placeholder="Scope, objectives, and context for this project…" />
      </ProjectFormSection>

      <ProjectFormSection
        title="2. Project Dates"
        description="Contract, planned, actual, and forecast dates."
        status={sectionStatuses[2]}
      >
        <DateField control={control} name="contractStartDate" label="Contract Start Date" optional />
        <DateField control={control} name="plannedStartDate" label="Planned Start Date" required />
        <DateField control={control} name="actualStartDate" label="Actual Start Date" description="Required once the project has started." />
        <DateField control={control} name="plannedFinishDate" label="Planned Finish Date" required />
        <DateField control={control} name="forecastFinishDate" label="Forecast Finish Date" description="Required when overall status is Behind or Critical." />
        <DateField control={control} name="actualFinishDate" label="Actual Finish Date" description="Required for completed projects." />
      </ProjectFormSection>

      <ProjectFormSection
        title="3. Project Responsibility"
        description="Every role on this project, fixed and additional, in one list."
        status={sectionStatuses[3]}
        plain
        action={
          <AddPositionButton
            disabled={!canEditPositions || savingPositions || editingRow !== null}
            onClick={addPositionRow}
          />
        }
      >
        <ResponsibilityList
          entries={responsibilities}
          control={control}
          contacts={contactRecords}
          editingRow={editingRow}
          onEditRow={setEditingRow}
          onCancelRow={cancelRowEdit}
          onSaveRow={saveRowPosition}
          onDeleteRow={deleteRowPosition}
          canEditPositions={canEditPositions}
          saving={savingPositions}
          onMutated={markMasterTouched}
          onClientRepresentativeChange={fillClientContactFromRepresentative}
          savedProject={project}
          teamHref={projectId ? projectSectionHref(projectId, "team") : undefined}
        />
      </ProjectFormSection>

      <ProjectFormSection
        title="4. Status & Progress"
        description="Lifecycle, health, and progress figures."
        status={sectionStatuses[4]}
      >
        <SelectField control={control} name="status" label="Project Status" required options={statusOptions} />
        <SelectField control={control} name="overallStatus" label="Overall Status" required options={overallOptions} />
        <NumberField control={control} name="plannedProgress" label="Planned Progress (%)" min={0} max={100} description="Required once the project has started." />
        <NumberField control={control} name="actualProgress" label="Actual Progress (%)" min={0} max={100} description="Required once the project has started." />
        <ManagedSelectField control={control} name="currentPhaseId" label="Current Phase" required kind="projectPhase" placeholder="Search or select phase…" onMutated={markMasterTouched} />
        <SelectField control={control} name="priority" label="Priority" required options={priorityOptions} />
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Schedule variance and SPI are calculated automatically from planned
          and actual progress.
        </p>
      </ProjectFormSection>

      <ProjectFormSection
        title="5. Reporting Configuration"
        description="Which reports this project produces and when. At least one reporting type must be enabled."
        status={sectionStatuses[5]}
      >
        <SwitchField control={control} name="weeklyEnabled" label="Weekly Reporting Enabled" />
        <SwitchField control={control} name="monthlyEnabled" label="Monthly Reporting Enabled" />
        <SwitchField control={control} name="executiveEnabled" label="Executive Reporting Enabled" />
        <SelectField control={control} name="weeklyReportingDay" label="Weekly Reporting Day" options={weekdayOptions} description="Required when weekly reporting is enabled." />
        <NumberField control={control} name="monthlyCutoffDay" label="Monthly Cut-off Day" min={1} max={28} description="Day of the month (1–28). Required when monthly reporting is enabled." />
        <SelectField control={control} name="currency" label="Reporting Currency" required options={asOptions(currencyOptions)} />
        <SelectField control={control} name="workingWeek" label="Working Week" required options={asOptions(workingWeekOptions)} />
        <SelectField control={control} name="timeZone" label="Time Zone" required options={asOptions(timeZoneOptions)} />
      </ProjectFormSection>

      <ProjectFormSection
        title="6. Contact & Location"
        description="Where the project runs and who to reach at the client."
        status={sectionStatuses[6]}
      >
        <TextField control={control} name="site" label="Primary Site" required placeholder="e.g. SOPC Refinery" />
        <TextField control={control} name="country" label="Country" required />
        <TextField control={control} name="city" label="City" optional />
        <div className="space-y-3 sm:col-span-2" data-field-name="additionalSites">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Additional Sites</p>
              <p className="text-xs text-muted-foreground">
                Optional project locations. The Primary Site remains the default for existing reports.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                additionalSites.append({ id: "", name: "", country: "", city: "" })
              }
            >
              <Plus aria-hidden="true" />
              Add Site
            </Button>
          </div>
          {additionalSites.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <TextField
                control={control}
                name={`additionalSites.${index}.name`}
                label={`Site ${index + 2} Name`}
                required
                placeholder="e.g. BADR-1 Site"
              />
              <TextField
                control={control}
                name={`additionalSites.${index}.country`}
                label="Country"
                optional
              />
              <TextField
                control={control}
                name={`additionalSites.${index}.city`}
                label="City"
                optional
              />
              <div className="flex items-center gap-1 self-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const selected = getValues(`additionalSites.${index}`);
                    const currentPrimary = {
                      id: getValues("primarySiteId"),
                      name: getValues("site"),
                      country: getValues("country"),
                      city: getValues("city"),
                    };
                    setValue("primarySiteId", selected.id ?? "", { shouldDirty: true });
                    setValue("site", selected.name ?? "", { shouldDirty: true });
                    setValue("country", selected.country ?? "", { shouldDirty: true });
                    setValue("city", selected.city ?? "", { shouldDirty: true });
                    additionalSites.update(index, currentPrimary);
                  }}
                >
                  <Star aria-hidden="true" />
                  Make primary
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove site ${index + 2}`}
                  onClick={() => additionalSites.remove(index)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center sm:col-span-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!watchedValues.clientRepresentativeId}
            onClick={() =>
              fillClientContactFromRepresentative(
                watchedValues.clientRepresentativeId ?? "",
                ""
              )
            }
          >
            Fill empty contact fields from Client Representative
          </Button>
        </div>
        <TextField control={control} name="clientContactName" label="Client Contact Name" optional description="Auto-filled from the selected Client Representative when blank; remains editable." />
        <TextField control={control} name="clientContactEmail" label="Client Contact Email" optional type="email" placeholder="name@company.com" description="Must be a valid email when entered." />
        <TextField control={control} name="clientContactPhone" label="Client Contact Phone" optional type="tel" placeholder="+20 …" />
      </ProjectFormSection>

      <ProjectFormSection
        title="7. Linked Scope"
        description="Departments, systems, and contacts linked to this project. Each record is shared master data — open or edit it on its own page and you will be returned here."
        status={sectionStatuses[7]}
        plain
      >
        <div data-field-name="departments">
          <ProjectScopeSummary
            projectId={projectId}
            control={control}
            project={project}
            linkContext={linkContext}
          />
        </div>
      </ProjectFormSection>

      <ProjectFormSection
        title="8. Branding & Report Settings"
        description="Separate EPROM/company and Client identity, plus report title, reference, QR, and signature preferences."
        status={sectionStatuses[8]}
      >
        <LogoUploadField control={control} name="projectLogoRef" label="EPROM / Company Logo" />
        <LogoUploadField control={control} name="clientLogoRef" label="Client Logo" />
        <TextField control={control} name="reportHeaderTitle" label="Report Header Title" optional placeholder="e.g. PSAIM Progress Report" />
        <TextField control={control} name="reportReferencePrefix" label="Report Reference Prefix" optional placeholder="e.g. EPR-PSAIM" />
        <TextField control={control} name="reportFooterText" label="Report Footer Text" optional placeholder="e.g. One Team. One Goal." />
        <SelectField control={control} name="defaultLanguage" label="Default Report Language" options={[...languageOptions]} />
        <SwitchField control={control} name="includeQrCode" label="Include QR Code when a published report URL is available" optional description="Configuration flag only. The report publisher must supply a real report/revision destination; Project Setup does not create one." />
        <SwitchField control={control} name="includeSignatureSection" label="Include Signature Section" optional description="Adds Prepared / Reviewed / Approved signature blocks." />
      </ProjectFormSection>

      {/* Sticky action bar */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-background/95 p-3 shadow-soft-md backdrop-blur">
        {hasUnsavedWork && (
          <p className="mr-auto text-xs text-muted-foreground">
            Unsaved changes
          </p>
        )}
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        {onSaveDraft && (
          <Button
            type="button"
            variant="secondary"
            onClick={handleSaveDraft}
            disabled={savingDraft || formState.isSubmitting}
          >
            {savingDraft ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Save data-icon="inline-start" aria-hidden="true" />
            )}
            Save Draft
          </Button>
        )}
        <Button
          type="submit"
          disabled={formState.isSubmitting || savingDraft}
        >
          {formState.isSubmitting && (
            <Loader2
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {submitLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard unsaved changes?"
        description="Your edits to this project have not been saved and will be lost."
        confirmLabel="Discard changes"
        destructive
        onConfirm={onCancel}
      />
    </form>
  );
}
