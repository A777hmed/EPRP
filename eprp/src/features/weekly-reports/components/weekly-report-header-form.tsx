"use client";

import * as React from "react";
import { format, isValid, parseISO } from "date-fns";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { ConfirmDialog, SectionCard, StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ManagedMultiSelect,
  ManagedPersonSelect,
  useMasterData,
} from "@/features/master-data";
import { RhfField } from "@/features/projects/components/form-field";
import {
  KPI_RATING_META,
  OVERALL_STATUS_META,
  PROGRESS_STATUS_META,
  REPORT_STATUS_META,
} from "@/lib/constants";
import {
  calculateSpi,
  formatReportNumber,
  getReportingWeekRange,
  getReportingYear,
  getWeekNumber,
  scheduleVariance,
} from "@/lib/reporting";
import { cn } from "@/lib/utils";
import type {
  Discipline,
  KpiRating,
  ProgressStatus,
  Project,
} from "@/types";
import {
  spiTone,
  suggestProgressStatus,
  varianceTone,
} from "../utils";
import {
  emptyDepartmentUpdate,
  normalizeWeeklyPeriodStart,
  weeklyReportHeaderSchema,
  type WeeklyReportHeaderValues,
} from "../schemas/weekly-report-header";
import { DepartmentUpdatesSection } from "./department-updates-section";
import { WeeklyEntriesSection } from "./weekly-entries-section";

interface WeeklyReportHeaderFormProps {
  projects: Project[];
  initialValues: WeeklyReportHeaderValues;
  existingReportNumber?: string;
  projectLocked?: boolean;
  onSaveDraft: (values: WeeklyReportHeaderValues) => Promise<void>;
  onCancel: () => void;
}

function AutoMarker() {
  return (
    <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-success">
      Auto
    </span>
  );
}

function AutoValueField({
  label,
  value,
  placeholder,
  description,
  mono = false,
}: {
  label: string;
  value?: string;
  placeholder: string;
  description?: string;
  mono?: boolean;
}) {
  const id = React.useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        <AutoMarker />
      </FieldLabel>
      <Input
        id={id}
        readOnly
        value={value ?? ""}
        placeholder={placeholder}
        className={mono ? "bg-muted/50 font-mono" : "bg-muted/50"}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function AutoStatusField({
  label,
  statusLabel,
  tone,
  placeholder,
  description,
}: {
  label: string;
  statusLabel?: string;
  tone?: React.ComponentProps<typeof StatusBadge>["tone"];
  placeholder: string;
  description: string;
}) {
  return (
    <Field>
      <FieldLabel>
        {label}
        <AutoMarker />
      </FieldLabel>
      <div className="flex h-8 items-center rounded-lg border bg-muted/50 px-2.5">
        {statusLabel ? (
          <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
        ) : (
          <span className="text-sm text-muted-foreground">{placeholder}</span>
        )}
      </div>
      <FieldDescription>{description}</FieldDescription>
    </Field>
  );
}

const toneText = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

/** Read-only, auto-calculated metric with a semantic tone. */
function AutoMetricField({
  label,
  value,
  tone,
  description,
  placeholder,
}: {
  label: string;
  value?: string;
  tone?: keyof typeof toneText;
  description: string;
  placeholder: string;
}) {
  return (
    <Field>
      <FieldLabel>
        {label}
        <AutoMarker />
      </FieldLabel>
      <div className="flex h-8 items-center rounded-lg border bg-muted/50 px-2.5">
        {value ? (
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              tone && toneText[tone]
            )}
          >
            {value}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{placeholder}</span>
        )}
      </div>
      <FieldDescription>{description}</FieldDescription>
    </Field>
  );
}

/** Status dropdown with a colour-coded badge indicator underneath. */
function StatusSelect({
  value,
  onChange,
  onBlur,
  controlProps,
  meta,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  controlProps: Record<string, unknown>;
  meta: Record<
    string,
    { label: string; tone: React.ComponentProps<typeof StatusBadge>["tone"] }
  >;
  placeholder: string;
}) {
  const current = meta[value];
  return (
    <div className="space-y-1.5">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger {...controlProps} className="w-full" onBlur={onBlur}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(meta).map(([key, option]) => (
            <SelectItem key={key} value={key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {current && <StatusBadge tone={current.tone}>{current.label}</StatusBadge>}
    </div>
  );
}

function defaultDisciplineIds(
  project: Project,
  disciplines: Discipline[]
): string[] {
  const departmentIds = new Set(
    project.departments.map((assignment) => assignment.departmentId)
  );
  const active = disciplines.filter((discipline) => discipline.active);
  const relevant = active.filter(
    (discipline) =>
      discipline.departmentId && departmentIds.has(discipline.departmentId)
  );
  return (relevant.length > 0 ? relevant : active).map(
    (discipline) => discipline.id
  );
}

function derivePeriod(periodStart: string) {
  const date = parseISO(periodStart);
  if (!isValid(date) || format(date, "yyyy-MM-dd") !== periodStart) return null;
  const { start, end } = getReportingWeekRange(date);
  return {
    start,
    end,
    periodEnd: format(end, "yyyy-MM-dd"),
    weekNumber: getWeekNumber(start),
    year: getReportingYear(start),
  };
}

/**
 * Weekly form through Phase 6A.4: header, KPIs, department updates, and the
 * comments / risks / issues / action items.
 */
export function WeeklyReportHeaderForm({
  projects,
  initialValues,
  existingReportNumber,
  projectLocked = false,
  onSaveDraft,
  onCancel,
}: WeeklyReportHeaderFormProps) {
  const { records: clientRecords } = useMasterData("client");
  const { records: disciplineRecords } = useMasterData("discipline");
  const disciplines = disciplineRecords as Discipline[];

  const form = useForm<WeeklyReportHeaderValues>({
    resolver: zodResolver(weeklyReportHeaderSchema),
    defaultValues: initialValues,
    mode: "onBlur",
    shouldFocusError: false,
  });
  const { control, handleSubmit, setValue, formState } = form;
  const projectId = useWatch({ control, name: "projectId" });
  const periodStart = useWatch({ control, name: "periodStart" });
  const reportStatus = useWatch({ control, name: "status" });
  const plannedProgress = useWatch({ control, name: "plannedProgress" });
  const actualProgress = useWatch({ control, name: "actualProgress" });
  const selectedProject =
    projects.find((project) => project.id === projectId) ?? null;
  const selectedClient = selectedProject
    ? clientRecords.find((client) => client.id === selectedProject.clientId)
    : undefined;
  const period = derivePeriod(periodStart);

  const identityUnchanged =
    projectId === initialValues.projectId &&
    periodStart === initialValues.periodStart;
  const generatedReportNumber =
    selectedProject && period
      ? formatReportNumber(
          "weekly",
          selectedProject.code,
          period.year,
          period.weekNumber
        )
      : undefined;
  const reportNumber =
    existingReportNumber && identityUnchanged
      ? existingReportNumber
      : generatedReportNumber;

  // Schedule variance and SPI are always derived — never user input.
  const progressEntered =
    Number.isFinite(plannedProgress) && Number.isFinite(actualProgress);
  const variance = progressEntered
    ? scheduleVariance(plannedProgress, actualProgress)
    : null;
  const spi = progressEntered && plannedProgress > 0
    ? calculateSpi(plannedProgress, actualProgress)
    : null;

  const reportStatusMeta = REPORT_STATUS_META[reportStatus];
  const projectStatusMeta = selectedProject
    ? OVERALL_STATUS_META[selectedProject.overallStatus]
    : undefined;

  const handleProjectChange = (nextProjectId: string) => {
    const nextProject =
      projects.find((project) => project.id === nextProjectId) ?? null;
    setValue("projectId", nextProjectId, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("preparedByContactId", nextProject?.reportingCoordinatorId ?? "", {
      shouldDirty: true,
      shouldValidate: false,
    });
    setValue(
      "disciplineIds",
      nextProject ? defaultDisciplineIds(nextProject, disciplines) : [],
      { shouldDirty: true, shouldValidate: false }
    );
    // Seed the KPIs from the project's current figures; all stay editable.
    const planned = nextProject?.plannedProgress ?? Number.NaN;
    const actual = nextProject?.actualProgress ?? Number.NaN;
    setValue("plannedProgress", planned, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("actualProgress", actual, {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (nextProject) {
      setValue(
        "overallProgressStatus",
        suggestProgressStatus(scheduleVariance(planned, actual)),
        { shouldDirty: true, shouldValidate: true }
      );
      // Pre-fill one department update row per reporting department.
      const reporting = nextProject.departments.filter(
        (assignment) => assignment.reportingRequired
      );
      const seed = reporting.length > 0 ? reporting : nextProject.departments;
      setValue(
        "departmentUpdates",
        seed.map((assignment) =>
          emptyDepartmentUpdate(assignment.departmentId)
        ),
        { shouldDirty: true, shouldValidate: true }
      );
    }
  };

  const updatePeriodStart = (value: string) => {
    setValue("periodStart", normalizeWeeklyPeriodStart(value), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const saveDraft = handleSubmit(async (values) => {
    try {
      await onSaveDraft(values);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the draft"
      );
    }
  });

  const [discardOpen, setDiscardOpen] = React.useState(false);
  const requestCancel = () => {
    if (formState.isDirty) setDiscardOpen(true);
    else onCancel();
  };

  return (
    <>
      <form onSubmit={saveDraft} noValidate className="space-y-6">
        <SectionCard
          title="Weekly report header"
          description="Project master data and report identity are filled automatically. Update the reporting scope where needed."
        >
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <RhfField
              control={control}
              name="projectId"
              label="Project"
              required
              description={
                projectLocked
                  ? "The project cannot be changed after the report is created."
                  : "Selecting a project fills the related header data."
              }
            >
              {({ field, controlProps }) =>
                projectLocked ? (
                  <Input
                    {...controlProps}
                    readOnly
                    value={
                      selectedProject?.shortName ?? selectedProject?.name ?? ""
                    }
                    className="bg-muted/50"
                  />
                ) : (
                  <Select
                    value={field.value}
                    onValueChange={handleProjectChange}
                  >
                    <SelectTrigger
                      {...controlProps}
                      className="w-full"
                      onBlur={field.onBlur}
                    >
                      <SelectValue placeholder="Select a project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.shortName ?? project.name}
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            {project.code}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              }
            </RhfField>

            <AutoValueField
              label="Project ID"
              value={selectedProject?.code}
              placeholder="Auto-filled from project"
              mono
            />
            <AutoValueField
              label="Client"
              value={selectedClient?.name}
              placeholder="Auto-filled from project"
            />
            <AutoValueField
              label="Report ID"
              value={reportNumber}
              placeholder="Select a project"
              description="Generated from project, year, and ISO week."
              mono
            />
            <AutoValueField
              label="Week No."
              value={period ? String(period.weekNumber).padStart(2, "0") : undefined}
              placeholder="Auto-filled from period"
              mono
            />

            <RhfField
              control={control}
              name="periodStart"
              label="Reporting Period"
              required
              description="Choose any date; the period snaps to Monday–Sunday."
            >
              {({ field, controlProps }) => (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">From</span>
                    <Input
                      {...controlProps}
                      type="date"
                      value={field.value}
                      onInput={(event) =>
                        updatePeriodStart(event.currentTarget.value)
                      }
                      onChange={(event) => updatePeriodStart(event.target.value)}
                      onBlur={(event) => {
                        updatePeriodStart(event.currentTarget.value);
                        field.onBlur();
                      }}
                      name={field.name}
                      ref={field.ref}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      To <span className="text-success">· Auto</span>
                    </span>
                    <Input
                      type="date"
                      readOnly
                      value={period?.periodEnd ?? ""}
                      aria-label="Reporting period end date"
                      className="bg-muted/50"
                    />
                  </div>
                </div>
              )}
            </RhfField>

            <RhfField
              control={control}
              name="preparedByContactId"
              label="Prepared By"
              required
              description="Defaults to the project reporting coordinator and remains editable."
            >
              {({ field, controlProps }) => (
                <ManagedPersonSelect
                  value={field.value}
                  onChange={(value) =>
                    setValue("preparedByContactId", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  onBlur={field.onBlur}
                  placeholder="Search or select person…"
                  controlProps={controlProps}
                />
              )}
            </RhfField>

            <AutoStatusField
              label="Report Status"
              statusLabel={reportStatusMeta.label}
              tone={reportStatusMeta.tone}
              placeholder="Draft"
              description="Workflow status changes are managed from the report workspace."
            />
            <AutoStatusField
              label="Current Project Status"
              statusLabel={projectStatusMeta?.label}
              tone={projectStatusMeta?.tone}
              placeholder="Select a project"
              description="Auto-filled from the project's overall health status."
            />

            <RhfField
              control={control}
              name="disciplineIds"
              label="Discipline(s)"
              required
              className="sm:col-span-2 xl:col-span-3"
              description="Preselected from the project’s assigned departments; edit this report’s scope as needed."
            >
              {({ field, controlProps }) => (
                <ManagedMultiSelect
                  kind="discipline"
                  value={field.value}
                  onChange={(value) =>
                    setValue("disciplineIds", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  onBlur={field.onBlur}
                  disabled={!selectedProject}
                  placeholder="Select one or more disciplines…"
                  controlProps={controlProps}
                />
              )}
            </RhfField>
          </div>
        </SectionCard>

        <SectionCard
          title="Progress & KPIs"
          description="Schedule variance and SPI are calculated automatically from planned and actual progress."
        >
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <RhfField
              control={control}
              name="plannedProgress"
              label="Planned Progress %"
              required
              description="Cumulative planned completion."
            >
              {({ field, controlProps }) => (
                <Input
                  {...controlProps}
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  value={
                    typeof field.value === "number" &&
                    Number.isFinite(field.value)
                      ? String(field.value)
                      : ""
                  }
                  onChange={(event) =>
                    field.onChange(
                      event.target.value === ""
                        ? Number.NaN
                        : event.target.valueAsNumber
                    )
                  }
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              )}
            </RhfField>

            <RhfField
              control={control}
              name="actualProgress"
              label="Actual Progress %"
              required
              description="Cumulative actual completion."
            >
              {({ field, controlProps }) => (
                <Input
                  {...controlProps}
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  value={
                    typeof field.value === "number" &&
                    Number.isFinite(field.value)
                      ? String(field.value)
                      : ""
                  }
                  onChange={(event) =>
                    field.onChange(
                      event.target.value === ""
                        ? Number.NaN
                        : event.target.valueAsNumber
                    )
                  }
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              )}
            </RhfField>

            <AutoMetricField
              label="Schedule Variance"
              value={
                variance === null
                  ? undefined
                  : `${variance > 0 ? "+" : ""}${variance}%`
              }
              tone={variance === null ? undefined : varianceTone(variance)}
              placeholder="Enter progress"
              description="Actual − planned progress."
            />
            <AutoMetricField
              label="SPI"
              value={spi === null ? undefined : spi.toFixed(2)}
              tone={spi === null ? undefined : spiTone(spi)}
              placeholder={
                progressEntered && plannedProgress === 0
                  ? "N/A when plan is 0%"
                  : "Enter progress"
              }
              description="Actual ÷ planned (1.00 = on plan)."
            />

            <RhfField
              control={control}
              name="manHoursToDate"
              label="Man-hours to Date"
              optional
              description="Cumulative man-hours expended."
            >
              {({ field, controlProps }) => (
                <Input
                  {...controlProps}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="e.g. 1250000"
                  value={
                    typeof field.value === "number" &&
                    Number.isFinite(field.value)
                      ? String(field.value)
                      : ""
                  }
                  onChange={(event) =>
                    field.onChange(
                      event.target.value === ""
                        ? Number.NaN
                        : event.target.valueAsNumber
                    )
                  }
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              )}
            </RhfField>

            <RhfField
              control={control}
              name="hseStatus"
              label="HSE Status"
              required
              description="Health, safety, and environment rating."
            >
              {({ field, controlProps }) => (
                <StatusSelect
                  value={field.value as KpiRating}
                  onChange={(value) =>
                    setValue("hseStatus", value as KpiRating, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  onBlur={field.onBlur}
                  controlProps={controlProps}
                  meta={KPI_RATING_META}
                  placeholder="Select HSE status"
                />
              )}
            </RhfField>

            <RhfField
              control={control}
              name="qualityStatus"
              label="Quality Status"
              required
              description="Inspection and quality rating."
            >
              {({ field, controlProps }) => (
                <StatusSelect
                  value={field.value as KpiRating}
                  onChange={(value) =>
                    setValue("qualityStatus", value as KpiRating, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  onBlur={field.onBlur}
                  controlProps={controlProps}
                  meta={KPI_RATING_META}
                  placeholder="Select quality status"
                />
              )}
            </RhfField>

            <RhfField
              control={control}
              name="overallProgressStatus"
              label="Overall Progress Status"
              required
              description={
                variance === null
                  ? "Reported verdict for the week."
                  : `Suggested from variance: ${PROGRESS_STATUS_META[suggestProgressStatus(variance)].label}.`
              }
            >
              {({ field, controlProps }) => (
                <StatusSelect
                  value={field.value as ProgressStatus}
                  onChange={(value) =>
                    setValue("overallProgressStatus", value as ProgressStatus, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  onBlur={field.onBlur}
                  controlProps={controlProps}
                  meta={PROGRESS_STATUS_META}
                  placeholder="Select overall status"
                />
              )}
            </RhfField>
          </div>
        </SectionCard>

        <DepartmentUpdatesSection
          control={control}
          setValue={setValue}
          disabled={!selectedProject}
        />

        <WeeklyEntriesSection control={control} disabled={!selectedProject} />

        <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
          {formState.isDirty && (
            <p className="mr-auto text-xs text-muted-foreground">
              Unsaved changes
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={requestCancel}
            disabled={formState.isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? (
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
        </div>
      </form>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard unsaved changes?"
        description="Your edits to this weekly report header have not been saved and will be lost."
        confirmLabel="Discard changes"
        destructive
        onConfirm={onCancel}
      />
    </>
  );
}
