"use client";

import * as React from "react";
import { Check, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard, StatusBadge } from "@/components/shared";
import { cn } from "@/lib/utils";
import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { ManagedSelect, useMasterData } from "@/features/master-data";
import {
  ADD_PROJECT_CATEGORY_LABEL,
  canManageProjectCategories,
  createdCategoryOutcome,
  isOtherProjectCategory,
  MANAGE_PROJECT_CATEGORIES_LABEL,
  otherProjectCategoryCreateGuard,
  selectProjectCategory,
} from "../project-category";
import type {
  MasterRecordBase,
  Project,
  ProjectType,
  StructureFamily,
} from "@/types";
import {
  categoryChangeKeepsDetail,
  classificationIssues,
  classificationLabel,
  classifyPayload,
  correctionIssues,
  STRUCTURE_FAMILY_META,
  structureFamilyChangePatch,
  typeLockConfirmationCopy,
  type ClassificationValues,
} from "../classification";

type ClassificationErrors = Partial<
  Record<"structureFamily" | "projectTypeId" | "projectCategoryDetail", string>
>;

/** PSM / PSAIM rows belong to the PSM family, never to an Other project. */
const isOtherCategory = (record: MasterRecordBase) =>
  isOtherProjectCategory(record as ProjectType);

/* ----------------------------- Family choice ------------------------------ */

function StructureFamilyChoice({
  value,
  onSelect,
  error,
}: {
  value: ClassificationValues["structureFamily"];
  onSelect: (family: StructureFamily) => void;
  error?: string;
}) {
  const families: StructureFamily[] = ["psm", "other"];
  return (
    <div data-field-name="structureFamily" className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Project Type"
        aria-invalid={error ? true : undefined}
        className="grid gap-3 sm:grid-cols-2"
      >
        {families.map((family) => {
          const meta = STRUCTURE_FAMILY_META[family];
          const selected = value === family;
          return (
            <button
              key={family}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(family)}
              className={cn(
                "flex min-h-24 items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/40"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                  selected && "border-primary bg-primary text-primary-foreground"
                )}
              >
                {selected && <Check className="size-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{meta.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground text-pretty">
                  {meta.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/* --------------------------- Category + detail ---------------------------- */

/**
 * Project Category of an Other project: the curated `project_types` list
 * without PSM-family rows, choose-only (no inline Add, no Manage). A category
 * that accepts a custom name asks for it right below.
 */
export function ProjectCategoryFields({
  value,
  onChange,
  errors,
  onBlur,
}: {
  value: ClassificationValues;
  onChange: (next: ClassificationValues) => void;
  errors?: ClassificationErrors;
  onBlur?: () => void;
}) {
  const categoryId = React.useId();
  const detailId = React.useId();
  const { records } = useMasterData("projectType");
  const canManageCategories = canManageProjectCategories(useCurrentIdentity());
  const category = (records as ProjectType[]).find(
    (record) => record.id === value.projectTypeId
  );
  const showDetail = categoryChangeKeepsDetail(category);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field data-field-name="projectTypeId" data-invalid={errors?.projectTypeId ? true : undefined}>
        <FieldLabel htmlFor={categoryId}>
          Project Category
          <span className="text-destructive" aria-hidden="true">*</span>
        </FieldLabel>
        <ManagedSelect
          kind="projectType"
          value={value.projectTypeId ?? ""}
          onChange={(id) =>
            onChange(
              selectProjectCategory(
                value,
                id,
                (records as ProjectType[]).find((record) => record.id === id)
              )
            )
          }
          onBlur={onBlur}
          placeholder="Search or select project category…"
          // Only active, non-PSM-family categories — also for a category
          // that was just added: a PSM / PSAIM one is never selectable here.
          filter={isOtherCategory}
          enforceFilter
          // Add / Manage only for the existing master-data write authority
          // (System Admin, Project Control Admin). Both open inline dialogs,
          // so the unsaved Project Setup form is never left.
          allowManage={canManageCategories}
          addLabel={ADD_PROJECT_CATEGORY_LABEL}
          manageLabel={MANAGE_PROJECT_CATEGORIES_LABEL}
          showSublabelInTrigger
          // A PSM / PSAIM-family category is refused BEFORE it is created —
          // never inserted and then left unselectable.
          createGuard={otherProjectCategoryCreateGuard}
          onRecordCreated={(record) => {
            const outcome = createdCategoryOutcome(value, record as ProjectType);
            if (outcome.selected) onChange(outcome.value);
            else if (outcome.message) toast.warning(outcome.message);
          }}
          clearLabel="Clear Project Category"
          controlProps={{
            id: categoryId,
            "aria-required": true,
            "aria-invalid": errors?.projectTypeId ? true : undefined,
          }}
        />
        {errors?.projectTypeId && <FieldError>{errors.projectTypeId}</FieldError>}
      </Field>

      {showDetail && (
        <Field
          data-field-name="projectCategoryDetail"
          data-invalid={errors?.projectCategoryDetail ? true : undefined}
        >
          <FieldLabel htmlFor={detailId}>
            Specify Category
            <span className="text-destructive" aria-hidden="true">*</span>
          </FieldLabel>
          <Input
            id={detailId}
            aria-required
            aria-invalid={errors?.projectCategoryDetail ? true : undefined}
            maxLength={200}
            placeholder="e.g. Tank Inspection"
            value={value.projectCategoryDetail ?? ""}
            onChange={(event) =>
              onChange({ ...value, projectCategoryDetail: event.target.value })
            }
            onBlur={onBlur}
          />
          {errors?.projectCategoryDetail ? (
            <FieldError>{errors.projectCategoryDetail}</FieldError>
          ) : (
            <FieldDescription>Describes the work, not the project name.</FieldDescription>
          )}
        </Field>
      )}
    </div>
  );
}

/** Family cards plus, for Other, the category fields. */
function ClassificationEditor({
  value,
  onChange,
  errors,
}: {
  value: ClassificationValues;
  onChange: (next: ClassificationValues) => void;
  errors?: ClassificationErrors;
}) {
  return (
    <div className="space-y-4">
      <StructureFamilyChoice
        value={value.structureFamily}
        error={errors?.structureFamily}
        onSelect={(family) => {
          const patch = structureFamilyChangePatch(value, family);
          if (patch) onChange({ ...value, ...patch });
        }}
      />
      {value.structureFamily === "other" && (
        <ProjectCategoryFields value={value} onChange={onChange} errors={errors} />
      )}
    </div>
  );
}

/** Ids of categories that require a custom name, for the classification rules. */
export function useCustomNameCategoryIds(): string[] {
  const { records } = useMasterData("projectType");
  return React.useMemo(
    () =>
      (records as ProjectType[])
        .filter((record) => record.allowsCustomName)
        .map((record) => record.id),
    [records]
  );
}

/* ---------------------- New project: first screen ------------------------ */

/**
 * The first Project Setup screen for a new project, inside the Info step.
 * Continue writes nothing — it only reveals Project Information, which shares
 * the same form state.
 */
export function ProjectClassificationStep({
  value,
  onChange,
  onContinue,
  onCancel,
}: {
  value: ClassificationValues;
  onChange: (next: ClassificationValues) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const customNameCategoryIds = useCustomNameCategoryIds();
  const canContinue =
    classificationIssues(value, { requireStructureFamily: true, customNameCategoryIds })
      .length === 0;

  return (
    <SectionCard
      title="Project Type"
      description="Choose how this project is structured. You can change it until the first save — after that it is locked."
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onContinue} disabled={!canContinue}>
            Continue
          </Button>
        </div>
      }
    >
      <ClassificationEditor value={value} onChange={onChange} />
    </SectionCard>
  );
}

/* ---------------------- Project Information header ----------------------- */

/**
 * Compact classification line at the top of Project Information.
 *
 * - New project: summary with Change (back to the first screen).
 * - Classified project: the family, locked; Other projects keep an editable
 *   category below (rendered by the caller).
 * - Legacy project: "Not classified" with the one-time Classify action.
 */
export function ClassificationSummaryBar({
  summary,
  state,
  onChange,
  onClassify,
  onCorrect,
}: {
  summary: string;
  state: "new" | "locked" | "legacy";
  onChange?: () => void;
  onClassify?: () => void;
  /** System Admin only: the exceptional correction of a locked type. */
  onCorrect?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Project Type
        </span>
        {state === "legacy" ? (
          <StatusBadge tone="warning">Not classified</StatusBadge>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            {state === "locked" && (
              <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Locked" />
            )}
            <span className="truncate">{summary}</span>
          </span>
        )}
      </div>
      {state === "new" && onChange && (
        <Button type="button" variant="outline" size="sm" onClick={onChange}>
          Change
        </Button>
      )}
      {state === "locked" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Locked after the project was saved.
          </span>
          {onCorrect && (
            <Button type="button" variant="outline" size="sm" onClick={onCorrect}>
              Correct Project Type
            </Button>
          )}
        </div>
      )}
      {state === "legacy" && onClassify && (
        <Button type="button" variant="outline" size="sm" onClick={onClassify}>
          Classify Project
        </Button>
      )}
    </div>
  );
}

/* --------------------- Legacy project: classify once ---------------------- */

export type ClassifyProjectInput = Pick<
  Project,
  "structureFamily" | "projectTypeId" | "projectCategoryDetail"
>;

/**
 * One-time classification of a legacy (unclassified) project, saved on its
 * own. PSM clears the stored category and custom name (a PSM project has no
 * Project Category); Other saves the chosen category.
 */
export function ClassifyProjectDialog({
  open,
  onOpenChange,
  onClassify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClassify: (input: ClassifyProjectInput) => Promise<void>;
}) {
  const [saving, setSaving] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        {/* Content unmounts when closed, so every opening starts blank. */}
        <ClassifyProjectBody
          saving={saving}
          setSaving={setSaving}
          onClose={() => onOpenChange(false)}
          onClassify={onClassify}
        />
      </DialogContent>
    </Dialog>
  );
}

function ClassifyProjectBody({
  saving,
  setSaving,
  onClose,
  onClassify,
}: {
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onClose: () => void;
  onClassify: (input: ClassifyProjectInput) => Promise<void>;
}) {
  const customNameCategoryIds = useCustomNameCategoryIds();
  const [value, setValue] = React.useState<ClassificationValues>({
    structureFamily: "",
    projectTypeId: "",
    projectCategoryDetail: "",
  });

  const valid =
    classificationIssues(value, { requireStructureFamily: true, customNameCategoryIds })
      .length === 0;

  const confirm = async () => {
    if (!valid || !value.structureFamily) return;
    setSaving(true);
    try {
      await onClassify(classifyPayload(value.structureFamily, value));
      toast.success("Project classified");
      setSaving(false);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not classify the project.");
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Classify Project</DialogTitle>
        <DialogDescription>
          Choose this project&apos;s type. It is saved now and locked afterwards —
          only a System Admin can correct it later.
        </DialogDescription>
      </DialogHeader>
      <ClassificationEditor value={value} onChange={setValue} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={confirm} disabled={!valid || saving}>
          {saving && (
            <Loader2
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          Classify Project
        </Button>
      </DialogFooter>
    </>
  );
}

/* ---------------- System Admin: Correct Project Type (exceptional) -------- */

/** The corrected target and reason the dialog hands to its caller. */
export interface CorrectProjectTypeTarget {
  structureFamily: StructureFamily;
  projectTypeId?: string;
  projectCategoryDetail?: string;
  reason: string;
}

/**
 * The exceptional System Admin correction of a locked Project Type. Not an
 * edit: it states that the type is normally locked, shows the current
 * classification, takes a complete corrected target and a mandatory reason,
 * and asks for an explicit confirmation before anything is sent.
 */
export function CorrectProjectTypeDialog({
  open,
  onOpenChange,
  currentFamily,
  currentLabel,
  onCorrect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFamily: StructureFamily;
  /** e.g. "Other Project · Tank Inspection". */
  currentLabel: string;
  onCorrect: (target: CorrectProjectTypeTarget) => Promise<void>;
}) {
  const [saving, setSaving] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        {/* Content unmounts when closed, so every opening starts blank. */}
        <CorrectProjectTypeBody
          currentFamily={currentFamily}
          currentLabel={currentLabel}
          saving={saving}
          setSaving={setSaving}
          onClose={() => onOpenChange(false)}
          onCorrect={onCorrect}
        />
      </DialogContent>
    </Dialog>
  );
}

function CorrectProjectTypeBody({
  currentFamily,
  currentLabel,
  saving,
  setSaving,
  onClose,
  onCorrect,
}: {
  currentFamily: StructureFamily;
  currentLabel: string;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onClose: () => void;
  onCorrect: (target: CorrectProjectTypeTarget) => Promise<void>;
}) {
  const reasonId = React.useId();
  const customNameCategoryIds = useCustomNameCategoryIds();
  const { records } = useMasterData("projectType");
  const [target, setTarget] = React.useState<ClassificationValues>({
    structureFamily: "",
    projectTypeId: "",
    projectCategoryDetail: "",
  });
  const [reason, setReason] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

  const issues = correctionIssues(currentFamily, target, reason, { customNameCategoryIds });
  const sameFamily = issues.find((issue) => issue.path === "structureFamily" && target.structureFamily);
  const category = (records as ProjectType[]).find((record) => record.id === target.projectTypeId);
  const targetLabel = classificationLabel(
    target.structureFamily || undefined,
    category?.name,
    target.projectCategoryDetail
  );

  const submit = async () => {
    if (issues.length > 0 || !target.structureFamily) return;
    setSaving(true);
    try {
      const psm = target.structureFamily === "psm";
      await onCorrect({
        structureFamily: target.structureFamily,
        projectTypeId: psm ? undefined : target.projectTypeId || undefined,
        projectCategoryDetail: psm ? undefined : target.projectCategoryDetail?.trim() || undefined,
        reason: reason.trim(),
      });
      toast.success("Project Type corrected");
      setSaving(false);
      onClose();
    } catch (error) {
      // Service errors carry fixed, safe wording; anything else stays generic.
      toast.error(
        error instanceof Error && error.name === "ProjectTypeCorrectionError"
          ? error.message
          : "The Project Type could not be corrected. No changes were made."
      );
      setSaving(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Correct Project Type</DialogTitle>
        <DialogDescription>
          Project Type is locked once a project is saved. This exceptional
          System Admin correction changes it and is recorded permanently with
          your name and reason.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Current
        </span>
        <span className="font-semibold">{currentLabel}</span>
      </div>

      {confirming ? (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <p className="font-semibold">Confirm this correction</p>
          <p>
            <span className="text-muted-foreground">From</span> {currentLabel}{" "}
            <span className="text-muted-foreground">to</span> {targetLabel}
          </p>
          <p>
            <span className="text-muted-foreground">Reason:</span> {reason.trim()}
          </p>
          {target.structureFamily === "psm" && (
            <p className="text-xs text-muted-foreground">
              The Project Category and any custom category name are cleared.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium">Corrected Project Type</p>
          <ClassificationEditor
            value={target}
            onChange={setTarget}
            errors={sameFamily ? { structureFamily: sameFamily.message } : undefined}
          />
          <Field>
            <FieldLabel htmlFor={reasonId}>
              Reason for correction
              <span className="text-destructive" aria-hidden="true">*</span>
            </FieldLabel>
            <Textarea
              id={reasonId}
              aria-required
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why the original Project Type was wrong"
            />
          </Field>
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={confirming ? () => setConfirming(false) : onClose}
        >
          {confirming ? "Back" : "Cancel"}
        </Button>
        {confirming ? (
          <Button type="button" variant="destructive" onClick={submit} disabled={saving}>
            {saving && (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            Confirm correction
          </Button>
        ) : (
          <Button type="button" onClick={() => setConfirming(true)} disabled={issues.length > 0}>
            Review correction
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/* ------------------ First save: confirm locking the Project Type ---------- */

/**
 * Shown before a new project's FIRST save (Create or Save Draft), because that
 * save locks the Project Type. "Change Project Type" returns to the PSM /
 * Other choice without saving; "Save and Lock" performs the save.
 */
export function FirstSaveLockDialog({
  open,
  family,
  onChangeType,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  family: StructureFamily | undefined;
  onChangeType: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (!family) return null;
  const copy = typeLockConfirmationCopy(family);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          {copy.detail}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onChangeType}>
            {copy.changeLabel}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
