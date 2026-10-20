"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  Info,
  Loader2,
  Plus,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import {
  useForm,
  useFieldArray,
  useWatch,
  type Control,
  type FieldPath,
  type Resolver,
  type SubmitErrorHandler,
} from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { PROJECT_LIFECYCLE_META } from "@/lib/constants";
import type {
  Client,
  Contact,
  PlanningOnboardingMode,
  Project,
  ProjectLifecycleStatus,
} from "@/types";
import { planningService } from "@/services/planning-service";
import {
  createProjectDraftSchema,
  createProjectFinalSchema,
  projectToFormValues,
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
  type ResponsibilityEntry,
} from "@/features/projects/responsibilities";
import {
  isFixedResponsibilityOccupied,
  isProjectPositionOccupied,
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
import { ProjectPartiesFields, touchSubcontractorFields } from "./project-parties-fields";
import { usePeopleMasterAuthority } from "@/features/auth/people-master-authority";
import {
  groupResponsibilities,
  holderGroup,
  holderPartyLabel,
} from "@/features/projects/responsibility-groups";
import { ResponsibilityCard, ResponsibilityGroupSection } from "./responsibility-cards";
import { isSetupReadOnly } from "@/features/projects/setup-save";
import { memberPickerPool, type MemberPickerPool } from "../project-team";
import { ProjectScopeSummary } from "./project-scope-summary";
import { OtherStructureScopeSummary } from "./other-structure-scope-summary";
import { LogoUploadField } from "./logo-upload-field";
import { PlanningEntry } from "./planning-entry";
import {
  AmendSetupDialog,
  GovernedField,
  SetupGovernanceProvider,
  type SetupFormGovernance,
} from "./governance/setup-governance-ui";
import { SETUP_FIELD_UI, type SetupAmendment } from "../setup-amendments";
import {
  clearNewProjectDraft,
  setNewProjectDraft,
} from "@/features/projects/new-project-draft-store";
import {
  ClassificationSummaryBar,
  ClassifyProjectDialog,
  CorrectProjectTypeDialog,
  FirstSaveLockDialog,
  ProjectCategoryFields,
  ProjectClassificationStep,
  useCustomNameCategoryIds,
  type ClassifyProjectInput,
  type CorrectProjectTypeTarget,
} from "./project-classification";
import {
  classificationFormValues,
  firstSaveGate,
  type FirstSaveGateState,
  classificationSummary,
  projectCategoryLabel,
  type ClassificationValues,
} from "@/features/projects/classification";

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
 * Project Responsibility, grouped by the party each holder represents (EPROM,
 * Client, Subcontractor; then holders whose party is not recorded, and
 * unassigned roles) — presentation only.
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
  /*
   * An EXISTING project offers its ACTIVE Project Team as the candidates for
   * every role and position (2C.3E): a person joins the team first. A new
   * project has no team yet, so its creation flow is unchanged.
   */
  const memberPool = React.useMemo(
    () => (savedProject ? memberPickerPool(savedProject) : undefined),
    [savedProject]
  );
  /*
   * Cards grouped by holder party. A row being edited stays in the group it
   * was saved in, so its editor never jumps while a person is picked.
   */
  const groups = React.useMemo(
    () => groupResponsibilities(entries, { savedProject, editingKey: editingRow }),
    [entries, savedProject, editingRow]
  );
  /* 2C.3E: an archived project's setup is read-only — its cards offer no
     Replace Person action (Team & Responsibilities refuses it there too). */
  const archived = isSetupReadOnly(savedProject);

  /** One entry: its resting card, or its editor in place across the group. */
  const renderEntry = (entry: ResponsibilityEntry) => {
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
                <ResponsibilityCard
                  key={entry.key}
                  entry={entry}
                  contacts={contacts}
                  busy={saving || blockedByOtherEditor}
                  locked={locked}
                  teamHref={teamHref}
                  party={holderPartyLabel(savedProject, entry.contactId)}
                  needsParty={holderGroup(savedProject, entry.contactId) === "party_not_recorded"}
                  archived={archived}
                  onEdit={() => onEditRow(entry.key)}
                />
              );
            }
            return (
              /* The editor needs the full width, so it spans the group's
                 columns and the resting cards reflow around it. */
              <div
                key={entry.key}
                className="space-y-2 rounded-xl border border-primary/40 bg-background p-3 shadow-sm col-span-full"
                data-field-name={entry.fixedField}
              >
                <PersonField
                  control={control}
                  allowCreate={!savedProject}
                  memberPool={memberPool}
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
              <ResponsibilityCard
                key={entry.key}
                entry={entry}
                contacts={contacts}
                busy={saving || blockedByOtherEditor}
                locked={locked}
                teamHref={teamHref}
                party={holderPartyLabel(savedProject, entry.contactId)}
                needsParty={holderGroup(savedProject, entry.contactId) === "party_not_recorded"}
                archived={archived}
                onEdit={() => onEditRow(entry.key)}
                onDelete={locked ? undefined : () => onDeleteRow(index)}
              />
            );
          }

          return (
            <div
              key={entry.key}
              className="space-y-3 rounded-xl border border-primary/40 bg-background p-3 shadow-sm col-span-full"
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
                  allowCreate={!savedProject}
                  memberPool={memberPool}
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
  };

  return (
    <div className="space-y-3">
      <div className="space-y-6">
        {groups.map((group) => (
          <ResponsibilityGroupSection
            key={group.key}
            groupKey={group.key}
            count={group.entries.length}
          >
            {group.entries.map(renderEntry)}
          </ResponsibilityGroupSection>
        ))}
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
  allowCreate = true,
  memberPool,
  onMutated,
  onValueChange,
  ...props
}: BaseFieldProps & {
  placeholder?: string;
  allowClear?: boolean;
  /**
   * Offer "Add new person" / Manage People. Off on an EXISTING project
   * (2C.3D Wave 2): a new person joins it on its Project Team first; one
   * created here would hold a role, or fail to save as a position, without
   * being on the project.
   */
  allowCreate?: boolean;
  /**
   * An existing project's ACTIVE Project Team: only its members are offered,
   * with Party / Project Role / Position and the Needs badges. A holder who
   * is not a member stays shown as the current value. Absent = every person
   * (a new project, which has no team yet).
   */
  memberPool?: MemberPickerPool;
  onMutated?: () => void;
  onValueChange?: (value: string, previousValue: string) => void;
}) {
  // Only the People-master authorities may create or edit a person from here;
  // everyone else assigns existing people (2C.3C). Presentation only.
  const canEditPeople = usePeopleMasterAuthority();
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
                  // The form validates on blur, and a role's editor can close
                  // before the picker blurs again — so re-validate here, or a
                  // "required" error raised while the role was empty outlives
                  // the selection and keeps the section at "Has Errors".
                  field.onBlur();
                  onValueChange?.(value, previousValue);
                }}
                onBlur={field.onBlur}
                placeholder={placeholder}
                allowClear={allowClear}
                clearLabel={`Clear ${props.label}`}
                controlProps={controlProps}
                onMutated={onMutated}
                allowManage={canEditPeople && allowCreate}
                filter={memberPool ? (record) => memberPool.isCandidate(record.id) : undefined}
                optionSublabel={
                  memberPool
                    ? (record) => memberPool.sublabel(record.id, (record as Contact).position)
                    : undefined
                }
                optionBadges={memberPool ? (record) => memberPool.badges(record.id) : undefined}
                searchPlaceholder={memberPool ? "Search the project team…" : undefined}
                emptyLabel={
                  memberPool
                    ? "No active Project Team members yet. Add people to the Project Team first."
                    : undefined
                }
              />
            </div>
            {/* Opens the person already chosen here, rather than sending the
                user to Manage People to search for someone they have just
                selected. Saving closes the dialog and leaves this form — and
                every unsaved edit on it — exactly as it was. */}
            {canEditPeople && (
              <MasterRecordEditButton
                kind="contact"
                recordId={selectedId}
                onMutated={onMutated}
              />
            )}
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
  onSubmit: (values: ProjectFormValues) => Promise<Project | void>;
  /** Save Draft: called with (possibly incomplete) values after draft validation. */
  onSaveDraft?: (values: ProjectFormValues) => Promise<Project | void>;
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
  /**
   * One-time classification of a legacy (unclassified) project, saved on its
   * own. Omit it and the "Classify Project" action is not offered.
   */
  onClassify?: (input: ClassifyProjectInput) => Promise<Project>;
  /**
   * System Admin only: the exceptional, audited correction of a locked
   * Project Type. Omit it and "Correct Project Type" is not offered.
   */
  onCorrectProjectType?: (target: CorrectProjectTypeTarget) => Promise<Project>;
  /**
   * 13.9B (owner closure 2026-10-17): System Admin only — the one-time
   * classification of a CONTROLLED legacy project (no Project Type yet),
   * through the correction path. Omit it and the action is not offered.
   */
  onClassifyLegacy?: (target: CorrectProjectTypeTarget) => Promise<Project>;
  /**
   * 13.9B: Project Setup governance. Once `controlled`, lightweight and
   * governed fields are shown with their saved value and an Amend / Request
   * amendment action instead of an editable control, so the ordinary Save can
   * never carry a change to them. Omit it (or `controlled: false`) and every
   * field behaves exactly as before.
   */
  governance?: ProjectFormGovernance;
  /**
   * Rendered above the form AND above the Project Type screen, from the live
   * values — the setup shell's workflow tracker for a new project, so it
   * stays visible while the type is being chosen.
   */
  renderHeader?: (values: ProjectFormValues) => React.ReactNode;
  onCancel: () => void;
}

/** What the hosting page supplies for 13.9B governance (the form adds the Amend dialog). */
export interface ProjectFormGovernance extends Omit<SetupFormGovernance, "onAmend"> {
  /**
   * After an amendment is stored. Returns the fresh project for an APPLIED
   * (lightweight) amendment so the form adopts the new saved value; null
   * otherwise.
   */
  onAmendmentSubmitted: (amendment: SetupAmendment) => Promise<Project | null>;
  /**
   * Bumped by the hosting page after every amendment DECISION (approve /
   * reject / stale / withdraw). The form re-reads what is stored outside the
   * project row (the planning mode); governed column values follow the fresh
   * project on their own.
   */
  decisionRevision?: number;
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
  onClassify,
  onCorrectProjectType,
  onClassifyLegacy,
  governance,
  renderHeader,
  onCancel,
}: ProjectFormProps) {
  const isNewProject = !projectId;
  const customNameCategoryIds = useCustomNameCategoryIds();
  const schemaOptions = React.useMemo(
    () => ({ customNameCategoryIds, requireStructureFamily: isNewProject }),
    [customNameCategoryIds, isNewProject]
  );
  const finalSchema = React.useMemo(
    () => createProjectFinalSchema(usedCodes, schemaOptions),
    [usedCodes, schemaOptions]
  );
  const draftSchema = React.useMemo(
    () => createProjectDraftSchema(usedCodes, schemaOptions),
    [usedCodes, schemaOptions]
  );

  // The final schema depends on master data that loads after mount (which
  // categories require a custom name), so the resolver reads the latest one.
  const finalSchemaRef = React.useRef(finalSchema);
  React.useEffect(() => {
    finalSchemaRef.current = finalSchema;
  }, [finalSchema]);
  const resolver = React.useCallback<Resolver<ProjectFormValues>>(
    (values, context, options) => zodResolver(finalSchemaRef.current)(values, context, options),
    []
  );

  const form = useForm<ProjectFormValues>({
    resolver,
    defaultValues: initialValues,
    mode: "onBlur",
  });
  const { control, getValues, handleSubmit, formState, setValue } = form;

  /*
   * Classification (Phase 2C.1). A new project starts on the PSM / Other
   * screen; Continue only reveals Project Information — same form state,
   * nothing written. Change returns to it until the first successful save,
   * after which the project has an id and the family is locked.
   */
  const [classificationPhase, setClassificationPhase] = React.useState<
    "classify" | "details"
  >(isNewProject && !initialValues.structureFamily ? "classify" : "details");
  const [classifyOpen, setClassifyOpen] = React.useState(false);
  const [structureFamily, classifiedCategoryId, categoryDetail] = useWatch({
    control,
    name: ["structureFamily", "projectTypeId", "projectCategoryDetail"],
  });
  const classification: ClassificationValues = {
    structureFamily,
    projectTypeId: classifiedCategoryId,
    projectCategoryDetail: categoryDetail,
  };
  const setClassification = (next: ClassificationValues) => {
    const options = { shouldDirty: true, shouldValidate: formState.isSubmitted };
    setValue("structureFamily", next.structureFamily ?? "", options);
    setValue("projectTypeId", next.projectTypeId ?? "", options);
    setValue("projectCategoryDetail", next.projectCategoryDetail ?? "", options);
  };
  const { records: categoryRecords } = useMasterData("projectType");
  const selectedCategory = categoryRecords.find(
    (record) => record.id === classifiedCategoryId
  );
  const summaryText = classificationSummary(
    structureFamily,
    projectCategoryLabel({ projectCategoryDetail: categoryDetail }, selectedCategory)
  );
  const classificationErrors = {
    structureFamily: formState.errors.structureFamily?.message,
    projectTypeId: formState.errors.projectTypeId?.message,
    projectCategoryDetail: formState.errors.projectCategoryDetail?.message,
  };
  const [correctOpen, setCorrectOpen] = React.useState(false);
  /**
   * Adopt a saved classification as the form's baseline, not as edits — so a
   * corrected PSM project keeps no stale category in the form.
   */
  const adoptClassification = (updated: Project) => {
    const saved = classificationFormValues(updated);
    form.resetField("structureFamily", { defaultValue: saved.structureFamily });
    form.resetField("projectTypeId", { defaultValue: saved.projectTypeId });
    form.resetField("projectCategoryDetail", { defaultValue: saved.projectCategoryDetail });
  };
  const handleClassify = async (input: ClassifyProjectInput) => {
    if (!onClassify) return;
    adoptClassification(await onClassify(input));
  };
  const handleCorrectProjectType = async (target: CorrectProjectTypeTarget) => {
    if (!onCorrectProjectType) return;
    adoptClassification(await onCorrectProjectType(target));
  };
  const [classifyLegacyOpen, setClassifyLegacyOpen] = React.useState(false);
  const handleClassifyLegacy = async (target: CorrectProjectTypeTarget) => {
    if (!onClassifyLegacy) return;
    adoptClassification(await onClassifyLegacy(target));
  };

  // The new-project setup sidebar lives in the layout, outside this form:
  // tell it which Project Type is chosen so it shows that type's steps.
  React.useEffect(() => {
    if (!isNewProject) return;
    setNewProjectDraft({ structureFamily: structureFamily || undefined });
  }, [isNewProject, structureFamily]);
  React.useEffect(() => {
    if (!isNewProject) return;
    return () => clearNewProjectDraft();
  }, [isNewProject]);

  // Planning Onboarding Mode — deliberately NOT a react-hook-form field. It
  // lives in project_planning_settings, a separate table saved through
  // planningService.upsertSettings() after the project itself saves (see
  // performSubmit below), not through toProjectInput. Section 5, Planning
  // Entry, asks for it as a guided question (13.9A).
  const [onboardingMode, setOnboardingMode] =
    React.useState<PlanningOnboardingMode>("new_project");
  // What is actually stored, so an unsaved guided answer counts as unsaved
  // work (13.9A hardening) — it is not a react-hook-form field, so isDirty
  // alone never saw it.
  const [savedOnboardingMode, setSavedOnboardingMode] =
    React.useState<PlanningOnboardingMode>("new_project");
  const decisionRevision = governance?.decisionRevision ?? 0;
  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void planningService.getSettings(projectId).then((settings) => {
      if (!cancelled && settings) {
        setOnboardingMode(settings.onboardingMode);
        setSavedOnboardingMode(settings.onboardingMode);
      }
    });
    return () => {
      cancelled = true;
    };
    // Also after an amendment decision: an approved planning mode must show
    // without a browser refresh.
  }, [projectId, decisionRevision]);

  /*
   * An approved (or otherwise stored) value of a CONTROLLED field must show
   * as soon as the fresh project arrives. These fields are inert while
   * Controlled, so a differing value can only be a newer saved one: adopt it
   * as the field's default. A field with an unsaved edit is left alone.
   */
  const governedSnapshot = JSON.stringify(
    Object.values(SETUP_FIELD_UI).flatMap((ui) => ui.formFields.map((name) => initialValues[name as keyof ProjectFormValues]))
  );
  const controlledNow = Boolean(governance?.controlled);
  React.useEffect(() => {
    if (!controlledNow) return;
    for (const ui of Object.values(SETUP_FIELD_UI)) {
      for (const name of ui.formFields) {
        const key = name as keyof ProjectFormValues;
        if (form.getFieldState(key).isDirty) continue;
        const stored = initialValues[key];
        if (JSON.stringify(form.getValues(key)) !== JSON.stringify(stored)) {
          form.resetField(key, { defaultValue: stored as never });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the stored values themselves.
  }, [controlledNow, governedSnapshot]);

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

  const onboardingUnsaved = onboardingMode !== savedOnboardingMode;
  const hasUnsavedWork = formState.isDirty || masterTouched || onboardingUnsaved;

  /*
   * 13.9B governance. The form owns the Amend dialog so an APPLIED
   * (lightweight) amendment can be adopted as the field's saved value at
   * once — otherwise the next Save would send the old value back and be
   * refused.
   */
  const [amendField, setAmendField] = React.useState<string | null>(null);
  const governanceContext = React.useMemo<SetupFormGovernance | null>(
    () =>
      governance
        ? {
            controlled: governance.controlled,
            canAmend: governance.canAmend,
            pending: governance.pending,
            onAmend: setAmendField,
            finalise: governance.finalise,
          }
        : null,
    [governance]
  );
  const handleAmendmentSubmitted = async (amendment: SetupAmendment) => {
    if (!governance) return;
    const updated = await governance.onAmendmentSubmitted(amendment);
    if (!updated || amendment.status !== "applied") return;
    const fresh = projectToFormValues(updated);
    for (const name of SETUP_FIELD_UI[amendment.fieldKey]?.formFields ?? []) {
      const key = name as keyof ProjectFormValues;
      form.resetField(key, { defaultValue: fresh[key] as never });
    }
  };


  /*
   * First save locks the Project Type (Phase 2C.1b). A new project's first
   * Create or Save Draft is held for an explicit confirmation; every later
   * save — and every save of an existing project — goes straight through.
   */
  const [firstSave, setFirstSave] = React.useState<FirstSaveGateState>({});
  const [pendingValues, setPendingValues] = React.useState<ProjectFormValues | null>(null);
  const [savingConfirmed, setSavingConfirmed] = React.useState(false);

  const performSubmit = async (values: ProjectFormValues) => {
    setSummary(null);
    const saved = await onSubmit(values);
    if (saved) {
      // Adopt confirmed UUIDs so another save never recreates newly added parties.
      setValue("subcontractors", projectToFormValues(saved).subcontractors);
    }
    await persistOnboardingMode();
  };

  /*
   * Planning configuration is supplementary to a project save that just
   * succeeded, and only meaningful once the project exists (a brand-new
   * project chooses it after its first save). BOTH saves — Save Changes /
   * Save & Continue AND Save Draft — write it: before the 13.9A UAT fix only
   * the submit path did, so "Draft saved" silently left the guided answer
   * unstored and still "Not saved yet". On success the stored baseline moves,
   * clearing the unsaved / Pending Save state; on failure it stays unsaved.
   */
  const persistOnboardingMode = async () => {
    // 13.9B: once Controlled the mode changes only through an approved
    // amendment, so the ordinary save never writes it.
    if (!projectId || governance?.controlled) return;
    try {
      const stored = await planningService.upsertSettings({ projectId, onboardingMode });
      setSavedOnboardingMode(stored.onboardingMode);
    } catch (error) {
      toast.warning(
        error instanceof Error
          ? error.message
          : "Planning Onboarding Mode could not be saved."
      );
    }
  };

  const onValid = async (values: ProjectFormValues) => {
    const next = firstSaveGate(firstSave, { type: "request", intent: "submit", isNewProject });
    setFirstSave(next.state);
    if (next.effect.kind === "save") await performSubmit(values);
    else setPendingValues(values);
  };

  const onInvalid: SubmitErrorHandler<ProjectFormValues> = (rhfErrors) => {
    // Save Changes / Save & Continue was refused: reveal every current
    // subcontractor row's errors (display timing only; nothing was saved).
    touchSubcontractorFields(form);
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
    touchSubcontractorFields(form);
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
    const next = firstSaveGate(firstSave, { type: "request", intent: "draft", isNewProject });
    setFirstSave(next.state);
    if (next.effect.kind === "save") await performSaveDraft(values);
    else setPendingValues(values);
  };

  const performSaveDraft = async (values: ProjectFormValues) => {
    if (!onSaveDraft) return;
    try {
      setSavingDraft(true);
      const saved = await onSaveDraft(values);
      form.reset(saved ? { ...values, subcontractors: projectToFormValues(saved).subcontractors } : values);
      await persistOnboardingMode();
      toast.success("Draft saved");
    } finally {
      setSavingDraft(false);
    }
  };

  const resolveFirstSave = async (
    event: { type: "change-type" } | { type: "confirm" } | { type: "dismiss" }
  ) => {
    const next = firstSaveGate(firstSave, event);
    setFirstSave(next.state);
    const values = pendingValues;
    if (next.effect.kind === "classify") {
      setPendingValues(null);
      setClassificationPhase("classify");
      return;
    }
    if (next.effect.kind !== "save" || !values) {
      setPendingValues(null);
      return;
    }
    setPendingValues(null);
    if (next.effect.intent === "draft") {
      await performSaveDraft(values);
      return;
    }
    setSavingConfirmed(true);
    try {
      await performSubmit(values);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The project could not be saved.");
    } finally {
      setSavingConfirmed(false);
    }
  };

  const handleCancel = () => {
    if (hasUnsavedWork) {
      setDiscardOpen(true);
    } else {
      onCancel();
    }
  };

  if (classificationPhase === "classify") {
    return (
      <div className="space-y-6">
        {renderHeader?.(watchedValues)}
        <ProjectClassificationStep
          value={classification}
          onChange={setClassification}
          onContinue={() => setClassificationPhase("details")}
          onCancel={handleCancel}
        />
        <ConfirmDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title="Discard unsaved changes?"
          description="Your edits to this project have not been saved and will be lost."
          confirmLabel="Discard changes"
          destructive
          onConfirm={onCancel}
        />
      </div>
    );
  }

  const classificationState: "new" | "locked" | "legacy" = isNewProject
    ? "new"
    : structureFamily
      ? "locked"
      : "legacy";

  return (
    <SetupGovernanceProvider value={governanceContext}>
    <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate className="space-y-6">
      {renderHeader?.(watchedValues)}
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
        title="1. Basic Information & Classification"
        description="Identity, classification, contract references and portfolio grouping."
        status={sectionStatuses[1]}
      >
        <div className="space-y-4 sm:col-span-2">
          <ClassificationSummaryBar
            summary={summaryText}
            state={classificationState}
            onChange={
              isNewProject ? () => setClassificationPhase("classify") : undefined
            }
            onClassify={onClassify ? () => setClassifyOpen(true) : undefined}
            onCorrect={onCorrectProjectType ? () => setCorrectOpen(true) : undefined}
            onClassifyLegacy={onClassifyLegacy ? () => setClassifyLegacyOpen(true) : undefined}
          />
          {classificationState === "locked" && structureFamily === "other" && (
            <GovernedField fieldKey="project_category">
              <ProjectCategoryFields
                value={classification}
                onChange={setClassification}
                errors={classificationErrors}
              />
            </GovernedField>
          )}
        </div>
        <GovernedField fieldKey="name"><TextField control={control} name="name" label="Project Name" required placeholder="e.g. Plant Systems Asset Integrity Management" /></GovernedField>
        <GovernedField fieldKey="code"><TextField control={control} name="code" label="Project Code" required placeholder="e.g. PRJ-001, PSAIM-001, EPROM-2026-001" description="Uppercase letters, numbers, and dashes. Must be unique." /></GovernedField>
        <GovernedField fieldKey="short_name"><TextField control={control} name="shortName" label="Project Short Name" optional placeholder="e.g. PSAIM – SOPC" /></GovernedField>
        <ProjectPartiesFields
          control={control}
          disabled={formState.isSubmitting || savingDraft || savingConfirmed}
          supported={!projectId || project?.parties !== undefined}
          ownerFields={<>
            <GovernedField fieldKey="client_id"><ManagedSelectField control={control} name="clientId" label="Owner / Client" required kind="client" placeholder="Search or select client…" onMutated={markMasterTouched} /></GovernedField>
            <ClientShortNameField clientId={watchedValues.clientId ?? ""} onMutated={markMasterTouched} />
          </>}
        />
        <GovernedField fieldKey="contract_number"><TextField control={control} name="contractNumber" label="Contract Number" optional placeholder="e.g. SOPC-CN-2025-114" /></GovernedField>
        <GovernedField fieldKey="purchase_order_number"><TextField control={control} name="purchaseOrderNumber" label="Purchase Order Number" optional placeholder="e.g. PO-88231" /></GovernedField>
        {classificationState === "legacy" && (
          // Unclassified (legacy) project: the category keeps its existing
          // field and rule until the one-time classification above is made.
          <GovernedField fieldKey="project_category"><ManagedSelectField control={control} name="projectTypeId" label="Project Category" required kind="projectType" placeholder="Search or select project category…" onMutated={markMasterTouched} /></GovernedField>
        )}
        <ManagedSelectField control={control} name="portfolioGroupId" label="Portfolio / Reporting Group" optional kind="portfolioGroup" placeholder="Search or select group…" allowClear onMutated={markMasterTouched} />
        <TextareaField control={control} name="description" label="Project Description" required placeholder="Scope, objectives, and context for this project…" />
      </ProjectFormSection>

      <ProjectFormSection
        title="2. Contract & Reference Dates"
        description="Contract and reference dates. Once a plan is published, schedule dates are governed by the Published Planning Snapshot."
        status={sectionStatuses[2]}
      >
        <GovernedField fieldKey="contract_start_date"><DateField control={control} name="contractStartDate" label="Contract Start Date" optional /></GovernedField>
        <GovernedField fieldKey="planned_start_date"><DateField control={control} name="plannedStartDate" label="Planned Start Date" required /></GovernedField>
        <GovernedField fieldKey="actual_start_date"><DateField control={control} name="actualStartDate" label="Actual Start Date" description="Required once the project has started." /></GovernedField>
        <GovernedField fieldKey="planned_finish_date"><DateField control={control} name="plannedFinishDate" label="Planned Finish Date" required /></GovernedField>
        <GovernedField fieldKey="forecast_finish_date"><DateField control={control} name="forecastFinishDate" label="Forecast Finish Date" description="Required when overall status is Behind or Critical." /></GovernedField>
        <GovernedField fieldKey="actual_finish_date"><DateField control={control} name="actualFinishDate" label="Actual Finish Date" description="Required for completed projects." /></GovernedField>
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

      {/* 13.9A: the former "Status & Progress" section is split. Lifecycle
          stays here; Portfolio / Reporting Group moved to section 1; Priority
          is no longer shown (its stored value is kept and saved unchanged);
          planning lives in Planning Entry; performance is read in Project
          Progress, never typed here. */}
      <ProjectFormSection
        title="4. Project Lifecycle"
        description="Where the project is in its life. Administrative only — schedule performance comes from planning."
        status={sectionStatuses[4]}
      >
        <SelectField control={control} name="status" label="Project Status" required options={statusOptions} />
        <ManagedSelectField control={control} name="currentPhaseId" label="Project Lifecycle Phase" required kind="projectPhase" placeholder="Search or select phase…" onMutated={markMasterTouched} />
      </ProjectFormSection>

      <ProjectFormSection
        id="planning-entry"
        title="5. Planning Entry"
        description="How the project comes under planning control. Plan details are kept in the Planning Workspace."
        plain
      >
        <PlanningEntry
          project={project}
          value={onboardingMode}
          onChange={setOnboardingMode}
          readOnly={isSetupReadOnly(project) || Boolean(governance?.controlled)}
          unsavedChanges={hasUnsavedWork}
          onboardingUnsaved={onboardingUnsaved}
          savedValue={savedOnboardingMode}
        />
      </ProjectFormSection>

      <ProjectFormSection
        title="6. Reporting Configuration"
        description="Which reports this project produces and when. At least one reporting type must be enabled."
        status={sectionStatuses[6]}
      >
        <GovernedField fieldKey="weekly_enabled"><SwitchField control={control} name="weeklyEnabled" label="Weekly Reporting Enabled" /></GovernedField>
        <GovernedField fieldKey="monthly_enabled"><SwitchField control={control} name="monthlyEnabled" label="Monthly Reporting Enabled" /></GovernedField>
        <GovernedField fieldKey="executive_enabled"><SwitchField control={control} name="executiveEnabled" label="Executive Reporting Enabled" /></GovernedField>
        <GovernedField fieldKey="weekly_reporting_day"><SelectField control={control} name="weeklyReportingDay" label="Weekly Reporting Day" options={weekdayOptions} description="Required when weekly reporting is enabled." /></GovernedField>
        <GovernedField fieldKey="monthly_cutoff_day"><NumberField control={control} name="monthlyCutoffDay" label="Monthly Cut-off Day" min={1} max={28} description="Day of the month (1–28). Required when monthly reporting is enabled." /></GovernedField>
        <GovernedField fieldKey="currency"><SelectField control={control} name="currency" label="Reporting Currency" required options={asOptions(currencyOptions)} /></GovernedField>
        <GovernedField fieldKey="working_week"><SelectField control={control} name="workingWeek" label="Working Week" required options={asOptions(workingWeekOptions)} /></GovernedField>
        <GovernedField fieldKey="time_zone"><SelectField control={control} name="timeZone" label="Time Zone" required options={asOptions(timeZoneOptions)} /></GovernedField>
      </ProjectFormSection>

      <ProjectFormSection
        title="7. Contact & Location"
        description="Where the project runs and who to reach at the client."
        status={sectionStatuses[7]}
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
        title="8. Scope & Structure"
        description={
          structureFamily === "other"
            ? "This project's configured structure. Its levels and units are managed in Project Setup → Project Structure."
            : "Departments, systems, and contacts linked to this project. Each record is shared master data — open or edit it on its own page and you will be returned here."
        }
        status={sectionStatuses[8]}
        plain
      >
        <div data-field-name="departments">
          {structureFamily === "other" ? (
            // An Other project has no Departments / Systems / Disciplines: its own configured levels.
            <OtherStructureScopeSummary projectId={projectId} />
          ) : (
            <ProjectScopeSummary
              projectId={projectId}
              control={control}
              project={project}
              linkContext={linkContext}
            />
          )}
        </div>
      </ProjectFormSection>

      <ProjectFormSection
        title="9. Branding & Report Settings"
        description="Separate EPROM/company and Client identity, plus report title, reference, QR, and signature preferences."
        status={sectionStatuses[9]}
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
            disabled={savingDraft || formState.isSubmitting || savingConfirmed}
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
          disabled={formState.isSubmitting || savingDraft || savingConfirmed}
        >
          {(formState.isSubmitting || savingConfirmed) && (
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
      <FirstSaveLockDialog
        open={Boolean(firstSave.pending)}
        family={structureFamily || undefined}
        onChangeType={() => void resolveFirstSave({ type: "change-type" })}
        onConfirm={() => void resolveFirstSave({ type: "confirm" })}
        onDismiss={() => void resolveFirstSave({ type: "dismiss" })}
      />
      {onClassify && (
        <ClassifyProjectDialog
          open={classifyOpen}
          onOpenChange={setClassifyOpen}
          onClassify={handleClassify}
        />
      )}
      {onClassifyLegacy && !structureFamily && (
        <CorrectProjectTypeDialog
          open={classifyLegacyOpen}
          onOpenChange={setClassifyLegacyOpen}
          currentFamily={undefined}
          currentLabel="Not classified"
          onCorrect={handleClassifyLegacy}
          mode="legacy"
        />
      )}
      {onCorrectProjectType && structureFamily && (
        <CorrectProjectTypeDialog
          open={correctOpen}
          onOpenChange={setCorrectOpen}
          currentFamily={structureFamily}
          currentLabel={summaryText}
          onCorrect={handleCorrectProjectType}
        />
      )}
    </form>
    {projectId && governance && (
      <AmendSetupDialog
        projectId={projectId}
        fieldKey={amendField}
        onClose={() => setAmendField(null)}
        onSubmitted={(amendment) => void handleAmendmentSubmitted(amendment)}
      />
    )}
    </SetupGovernanceProvider>
  );
}
