"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import {
  useForm,
  useWatch,
  type Control,
  type FieldPath,
  type SubmitErrorHandler,
} from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  currencyOptions,
  languageOptions,
  timeZoneOptions,
  weekdayOptions,
  workingWeekOptions,
} from "@/features/projects/options";
import {
  ManagedPersonSelect,
  ManagedSelect,
  type MasterKind,
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

function PersonField({
  placeholder = "Search or select person…",
  allowClear = false,
  onMutated,
  ...props
}: BaseFieldProps & {
  placeholder?: string;
  allowClear?: boolean;
  onMutated?: () => void;
}) {
  return (
    <RhfField {...props}>
      {({ field, controlProps }) => (
        <ManagedPersonSelect
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
  /** Initial values — Edit passes the mapped project, Add passes defaults. */
  initialValues: ProjectFormValues;
  /** Codes already in use (current project's own code excluded by caller). */
  usedCodes: string[];
  submitLabel: string;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
  /** Save Draft: called with (possibly incomplete) values after draft validation. */
  onSaveDraft?: (values: ProjectFormValues) => Promise<void>;
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
  initialValues,
  usedCodes,
  submitLabel,
  onSubmit,
  onSaveDraft,
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
  const { control, handleSubmit, formState } = form;

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
        description="Who manages, controls, and sponsors the project."
        status={sectionStatuses[3]}
      >
        <PersonField control={control} name="projectManagerId" label="Project Manager" required onMutated={markMasterTouched} />
        <PersonField control={control} name="projectControlManagerId" label="Project Control Manager" required onMutated={markMasterTouched} />
        <PersonField control={control} name="clientRepresentativeId" label="Client Representative" optional allowClear onMutated={markMasterTouched} />
        <PersonField control={control} name="reportingCoordinatorId" label="Reporting Coordinator" required onMutated={markMasterTouched} />
        <PersonField control={control} name="projectSponsorId" label="Project Sponsor" optional allowClear onMutated={markMasterTouched} />
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
        <TextField control={control} name="site" label="Project Location" required placeholder="e.g. SOPC Refinery" />
        <TextField control={control} name="country" label="Country" required />
        <TextField control={control} name="city" label="City" optional />
        <TextField control={control} name="clientContactName" label="Client Contact Name" optional />
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
          />
        </div>
      </ProjectFormSection>

      <ProjectFormSection
        title="8. Branding & Report Settings"
        description="How generated reports are titled, referenced, and signed."
        status={sectionStatuses[8]}
      >
        <LogoUploadField control={control} name="projectLogoRef" label="Project Logo" />
        <LogoUploadField control={control} name="clientLogoRef" label="Client Logo" />
        <TextField control={control} name="reportHeaderTitle" label="Report Header Title" optional placeholder="e.g. PSAIM Progress Report" />
        <TextField control={control} name="reportReferencePrefix" label="Report Reference Prefix" optional placeholder="e.g. EPR-PSAIM" />
        <TextField control={control} name="reportFooterText" label="Report Footer Text" optional placeholder="e.g. One Team. One Goal." />
        <SelectField control={control} name="defaultLanguage" label="Default Report Language" options={[...languageOptions]} />
        <SwitchField control={control} name="includeQrCode" label="Include QR Code" optional description="Adds a scan-to-access QR code to report headers." />
        <SwitchField control={control} name="includeSignatureSection" label="Include Signature Section" optional description="Adds prepared/reviewed/approved signature blocks." />
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
