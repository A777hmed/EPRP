"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Save,
  Send,
  Undo2,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, type StatusTone } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import {
  ASSIGNMENT_ROLE_META,
  ENTRY_STATUS_META,
  SUBMISSION_STATUS_META,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { weeklyReportService } from "@/services/weekly-report-service";
import type {
  MasterRecordBase,
  SubmissionStatus,
  WeeklyEntry,
  WeeklySubmission,
} from "@/types";
import {
  newWeeklyUpdateDraft,
  toWeeklyUpdateDraft,
  toWeeklyUpdateInput,
  weeklyUpdateErrors,
  weeklyCommentLabel,
  type WeeklyUpdateDraft,
} from "../weekly-update";
import type {
  DepartmentSection,
  DepartmentState,
  ScopeItemResponsibility,
  ScopeItemRow,
} from "../workspace";
import { WeeklyUpdateFields } from "./weekly-update-fields";
import { ScopedPersonSelect } from "./scoped-person-select";

/**
 * Who may record a VERDICT — Approved or Returned — and on which department.
 *
 * `approved` and `returned` are the acceptance of a department's work.
 * `docs/05_PERMISSION_MODEL.md` §1.2 gives that to the **Department Lead**:
 * "Approves the department's Weekly submission … A department's submission
 * cannot skip the Lead." Everything else in the list is the department
 * reporting on itself.
 *
 * TWO THINGS THIS DELIBERATELY NARROWS.
 *
 *   WHERE. A verdict belongs to the department's canonical submission, not to
 *   each scope item under it. Offering Approved on every Program & Study row
 *   invited a per-item approval that nothing in the product means and that the
 *   lifecycle guard does not read.
 *
 *   WHO. `managedDepartmentIds` are the departments this viewer actually
 *   manages, so a manager rules on their own department and no other.
 *   `canConsolidate` (Project Control / Report Coordinator / admin) is kept
 *   alongside it so an administrator is not locked out of a stuck report — it
 *   is the exception, not the normal business path.
 *
 * Carried on context rather than drilled: the Status control sits four
 * components below the panel and every one of them would otherwise gain props
 * it does not use. The default grants nothing, so a tree rendered without the
 * provider offers department input only.
 *
 * This decides what to OFFER. `weekly_submissions_update` remains the boundary
 * and enforces the same two narrowings independently.
 */
export interface SubmissionVerdictAuthority {
  /** Project Control / Report Coordinator / platform administrator. */
  canConsolidate: boolean;
  /** Departments this viewer is the assigned Department Manager of. */
  managedDepartmentIds: string[];
}

const NO_VERDICT_AUTHORITY: SubmissionVerdictAuthority = {
  canConsolidate: false,
  managedDepartmentIds: [],
};

const SubmissionVerdictAuthorityContext =
  React.createContext<SubmissionVerdictAuthority>(NO_VERDICT_AUTHORITY);

export const SubmissionVerdictAuthorityProvider =
  SubmissionVerdictAuthorityContext.Provider;

/** What a department may say about its own work. */
const DEPARTMENT_INPUT_STATUSES: SubmissionStatus[] = [
  "pending",
  "in_progress",
  "submitted",
];

/** The verdict pair, in the order a reviewer meets them. */
const VERDICT_STATUSES: SubmissionStatus[] = ["returned", "approved"];

/** Badge tone per completion state. Neutral until work actually starts. */
const STATE_TONE: Record<DepartmentState, StatusTone> = {
  not_started: "neutral",
  in_progress: "warning",
  submitted: "info",
  reviewed: "info",
  complete: "success",
};

/* ------------------------------ Name resolution --------------------------- */

/** The master-data records the workspace needs to name what it renders. */
export interface WeeklyNameLookup {
  department: (id: string | undefined) => MasterRecordBase | undefined;
  scopeItem: (id: string | undefined) => MasterRecordBase | undefined;
  system: (id: string | undefined) => MasterRecordBase | undefined;
  person: (id: string | undefined) => MasterRecordBase | undefined;
}

function indexById(records: MasterRecordBase[]): Map<string, MasterRecordBase> {
  return new Map(records.map((record) => [record.id, record]));
}

/**
 * Resolve department, scope-item, and System names for the whole panel.
 *
 * Subscribing rather than reading the caches directly is what makes the names
 * arrive at all: the Supabase-backed master-data stores hydrate lazily on the
 * first subscription, so a bare synchronous lookup on a freshly loaded page
 * would resolve nothing and every row would read "Unknown". Called once for
 * the panel and shared, so ten departments do not mean thirty subscriptions.
 */
export function useWeeklyNameLookup(): WeeklyNameLookup {
  const { records: departments } = useMasterData("department");
  const { records: scopeItems } = useMasterData("discipline");
  const { records: systems } = useMasterData("system");
  const { records: people } = useMasterData("contact");

  return React.useMemo(() => {
    const departmentIndex = indexById(departments);
    const scopeItemIndex = indexById(scopeItems);
    const systemIndex = indexById(systems);
    const personIndex = indexById(people);
    const from =
      (index: Map<string, MasterRecordBase>) => (id: string | undefined) =>
        id ? index.get(id) : undefined;

    return {
      department: from(departmentIndex),
      scopeItem: from(scopeItemIndex),
      system: from(systemIndex),
      person: from(personIndex),
    };
  }, [departments, scopeItems, systems, people]);
}

/* --------------------------------- Drafts --------------------------------- */

/**
 * The editable shape of one department-owned update.
 *
 * `progressPercent` is held as a string because an empty box means "not
 * reported", which a number cannot represent without conflating it with zero.
 */
interface Draft {
  status: SubmissionStatus;
  progressPercent: string;
  summary: string;
  keyAchievement: string;
  delayConstraint: string;
  nextWeekPlan: string;
  /** Who owns this item's work, and by when. Scope-item level only. */
  responsibleContactId: string;
  targetDate: string;
}

function toDraft(submission: WeeklySubmission | undefined): Draft {
  return {
    status: submission?.status ?? "pending",
    progressPercent:
      typeof submission?.progressPercent === "number"
        ? String(submission.progressPercent)
        : "",
    summary: submission?.summary ?? "",
    keyAchievement: submission?.keyAchievement ?? "",
    delayConstraint: submission?.delayConstraint ?? "",
    nextWeekPlan: submission?.nextWeekPlan ?? "",
    responsibleContactId: submission?.responsibleContactId ?? "",
    targetDate: submission?.targetDate ?? "",
  };
}

type LegacyNarrativeField =
  | "summary"
  | "keyAchievement"
  | "delayConstraint"
  | "nextWeekPlan";

const LEGACY_NARRATIVE_FIELDS: LegacyNarrativeField[] = [
  "summary",
  "keyAchievement",
  "delayConstraint",
  "nextWeekPlan",
];

/**
 * The two levels the same form serves.
 *
 * Only the wording differs — the stored row, the validation and the save path
 * are identical — so the difference lives in this table rather than in a
 * second component that would have to be kept in step.
 */
export type UpdateLevel = "department" | "scope_item";

const LEGACY_NARRATIVE_LABELS: Record<LegacyNarrativeField, string> = {
  summary: "Weekly Update / Current Progress",
  keyAchievement: "Key Achievement",
  delayConstraint: "Delay / Constraint",
  nextWeekPlan: "Next Week Plan",
};

/** Read-only rendering of one narrative field. */
function ReadOnlyText({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {value ? (
        <p className="text-sm whitespace-pre-wrap text-pretty">{value}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Not reported</p>
      )}
    </div>
  );
}

/** What a submission says, for a viewer who may not change it. */
function LegacyNarrative({ submission }: { submission: WeeklySubmission | undefined }) {
  const values = LEGACY_NARRATIVE_FIELDS.filter((key) => Boolean(submission?.[key]?.trim()));
  if (values.length === 0) return null;

  return (
    <details className="rounded-md border bg-muted/20 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Legacy narrative from earlier reporting
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {values.map((key) => (
          <ReadOnlyText
            key={key}
            label={LEGACY_NARRATIVE_LABELS[key]}
            value={submission?.[key] ?? ""}
          />
        ))}
      </div>
    </details>
  );
}

function ReadOnlyUpdate({
  submission,
  level,
  names,
}: {
  submission: WeeklySubmission | undefined;
  level: UpdateLevel;
  names: WeeklyNameLookup;
}) {
  const status = submission?.status ?? "pending";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border-l-4 border-l-primary bg-muted/30 px-3 py-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Status</span>
          <StatusBadge tone={SUBMISSION_STATUS_META[status].tone}>
            {SUBMISSION_STATUS_META[status].label}
          </StatusBadge>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Progress</span>
          <span className="text-sm font-medium tabular-nums">
            {typeof submission?.progressPercent === "number"
              ? `${submission.progressPercent}%`
              : "Not reported"}
          </span>
        </span>
        {level === "scope_item" && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Responsible</span>
              <span className="text-sm font-medium">
                {submission?.responsibleContactId
                  ? names.person(submission.responsibleContactId)?.name ?? "Assigned person"
                  : "Not assigned"}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Target Date</span>
              <span className="text-sm font-medium">
                {submission?.targetDate ?? "Not set"}
              </span>
            </span>
          </>
        )}
      </div>
      <LegacyNarrative submission={submission} />
    </div>
  );
}

/* ------------------------------ Responsibility ----------------------------- */

/**
 * Who holds this scope item, read from the project's own assignments.
 *
 * Display only, and never stored on the report: the same person assigned to
 * three items appears on all three because the project says so, and a change
 * made in Project Setup is reflected here with nothing to migrate.
 */
function ResponsibilityLine({
  responsible,
  names,
}: {
  responsible: ScopeItemResponsibility[];
  names: WeeklyNameLookup;
}) {
  if (responsible.length === 0) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-warning">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        No responsible person assigned — update Project Setup.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        Responsible
      </span>
      {responsible.map((entry) => (
        <span
          key={`${entry.contactId}-${entry.assignmentRole}`}
          className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
        >
          <span className="font-medium">
            {names.person(entry.contactId)?.name ?? "Unknown person"}
          </span>
          <span className="text-muted-foreground">
            {ASSIGNMENT_ROLE_META[entry.assignmentRole].label}
          </span>
          {entry.functionalTitle && (
            <span className="text-muted-foreground">
              · {entry.functionalTitle}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/* --------------------------------- Editor --------------------------------- */

interface ItemsConfig {
  disciplineId?: string;
  systemId?: string;
  entries: WeeklyEntry[];
  /** Who holds this scope item. The owner candidates for its items. */
  responsible: ScopeItemResponsibility[];
  /** Department-level candidates, used only by Department Overall comments. */
  departmentPeople: ScopeItemResponsibility[];
  /** Department Manager, Project Control and Admin may manage every comment. */
  canManageComments: boolean;
  names: WeeklyNameLookup;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
  viewerContactId?: string;
}

interface UpdateEditorProps {
  reportId: string;
  departmentId: string;
  /** Chooses the wording. The stored row is the same either way. */
  level: UpdateLevel;
  existing: WeeklySubmission | undefined;
  /** Owner candidates for the scope-item Responsible Person field. */
  responsible?: ScopeItemResponsibility[];
  names?: WeeklyNameLookup;
  onSaved: (submission: WeeklySubmission) => void;
  /**
   * Present only at the scope-item level. When given, this scope item's
   * management items are edited here too and committed by the same button.
   */
  items?: ItemsConfig;
}

/**
 * One department-owned scope summary followed by independent authored Weekly
 * comments. The summary remains the single `weekly_submissions` row identified
 * by (report, department, scope item). Every comment remains its own
 * `weekly_entries` row and saves independently, so changing one Monthly flag or
 * comment never rewrites its neighbours.
 *
 * Ids are folded back the moment a new comment returns. A retry therefore
 * updates the row that landed instead of inserting a twin.
 *
 * State is deliberately not synchronised from props: this component keeps the
 * identity of what it has saved, so a background reload cannot clobber typing.
 */
function UpdateEditor({
  reportId,
  departmentId,
  level,
  existing,
  responsible = [],
  names,
  onSaved,
  items,
}: UpdateEditorProps) {
  const [submissionId, setSubmissionId] = React.useState(existing?.id);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(existing));
  const [pristine, setPristine] = React.useState<Draft>(() => toDraft(existing));

  const [rows, setRows] = React.useState<WeeklyUpdateDraft[]>(() =>
    (items?.entries ?? []).map(toWeeklyUpdateDraft)
  );

  const verdictAuthority = React.useContext(SubmissionVerdictAuthorityContext);
  /*
   * A verdict is offered on the department's canonical row only, and only to
   * someone who may rule on THIS department. Both halves matter: without the
   * level check a Program & Study row offers an approval nothing reads;
   * without the department check a manager of one department is offered a
   * verdict on another and refused by RLS on save.
   */
  const mayRecordVerdict =
    level === "department" &&
    (verdictAuthority.canConsolidate ||
      verdictAuthority.managedDepartmentIds.includes(departmentId));

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [commentError, setCommentError] = React.useState<string | null>(null);
  const [commentSaving, setCommentSaving] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const nextKey = React.useRef(0);

  const updateDirty = React.useMemo(
    () =>
      (Object.keys(pristine) as (keyof Draft)[]).some(
        (key) => draft[key] !== pristine[key]
      ),
    [draft, pristine]
  );
  const dirty = updateDirty;

  const progress =
    draft.progressPercent === "" ? undefined : Number(draft.progressPercent);
  const progressInvalid =
    progress !== undefined &&
    (!Number.isFinite(progress) || progress < 0 || progress > 100);
  const blocked = progressInvalid;

  const markedForMonthly = rows.filter((row) => row.includeInMonthly).length;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSavedAt(null);
  };

  const patchRow = (key: string, change: Partial<WeeklyUpdateDraft>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row))
    );
    setSavedAt(null);
  };

  const addRow = () => {
    nextKey.current += 1;
    setRows((current) => [
      ...current,
      // Pre-scoped to the item being edited: the department, System and scope
      // item are already known here, so the row never asks for them again.
      newWeeklyUpdateDraft(`new-${nextKey.current}`),
    ]);
    setSavedAt(null);
  };

  const removeRow = async (key: string) => {
    const row = rows.find((candidate) => candidate.key === key);
    if (!row || !items) return;
    setCommentError(null);
    if (!row.id) {
      setRows((current) =>
        current.filter((candidate) => candidate.key !== key)
      );
      return;
    }
    setCommentSaving(key);
    try {
      await weeklyReportService.deleteEntry(reportId, row.id);
      items.onEntryDeleted(row.id);
      setRows((current) =>
        current.filter((candidate) => candidate.key !== key)
      );
      toast.success("Comment removed");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not remove this comment.";
      setCommentError(message);
      toast.error(message);
    } finally {
      setCommentSaving(null);
    }
  };

  const saveComment = async (key: string): Promise<boolean> => {
    const row = rows.find((candidate) => candidate.key === key);
    if (!row || !items || weeklyUpdateErrors(row).length > 0) return false;
    setCommentSaving(key);
    setCommentError(null);
    try {
      const entry = await weeklyReportService.saveEntry(
        reportId,
        toWeeklyUpdateInput(row, {
          departmentId,
          systemId: items.systemId,
          disciplineId: items.disciplineId,
          authorContactId: items.viewerContactId,
        })
      );
      items.onEntrySaved(entry);
      const next = { ...toWeeklyUpdateDraft(entry), key: row.key };
      setRows((current) =>
        current.map((candidate) =>
          candidate.key === row.key ? next : candidate
        )
      );
      toast.success("Comment saved");
      return true;
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not save this comment.";
      setCommentError(message);
      toast.error(message);
      return false;
    } finally {
      setCommentSaving(null);
    }
  };

  const setMonthly = async (key: string, checked: boolean) => {
    const row = rows.find((candidate) => candidate.key === key);
    if (!row) return;
    if (checked && !row.description.trim()) {
      const message = "Comment text is required before including this item in the Monthly Report.";
      setCommentError(message);
      toast.error(message);
      return;
    }
    const next = { ...row, includeInMonthly: checked };
    patchRow(key, { includeInMonthly: checked });
    // A new comment has no database row yet. Its flag lands with Save Comment.
    if (!row.id || !items) return;
    setCommentSaving(key);
    setCommentError(null);
    try {
      const entry = await weeklyReportService.saveEntry(
        reportId,
        toWeeklyUpdateInput(next, {
          departmentId,
          systemId: items.systemId,
          disciplineId: items.disciplineId,
          authorContactId: items.viewerContactId,
        })
      );
      items.onEntrySaved(entry);
      setRows((current) =>
        current.map((candidate) =>
          candidate.key === key
            ? { ...toWeeklyUpdateDraft(entry), key: candidate.key }
            : candidate
        )
      );
      toast.success(checked ? "Added to Monthly Tray" : "Removed from Monthly Tray");
    } catch (e) {
      patchRow(key, { includeInMonthly: row.includeInMonthly });
      const message =
        e instanceof Error ? e.message : "Could not update the Monthly flag.";
      setCommentError(message);
      toast.error(message);
    } finally {
      setCommentSaving(null);
    }
  };

  /**
   * Save the summary, optionally forcing the status.
   *
   * `verdict` is what the Approve / Return buttons pass. It bypasses the dirty
   * check on purpose: recording a verdict on an unchanged row IS the change,
   * and requiring the reviewer to edit something first would be nonsense.
   * Everything else about the write is identical, so a verdict travels the
   * same service call and the same policy as any other department save.
   */
  const save = async (verdict?: SubmissionStatus) => {
    const effective = verdict ? { ...draft, status: verdict } : draft;
    if (blocked || (!dirty && !verdict)) return;
    setSaving(true);
    setError(null);
    try {
      if (updateDirty || verdict) {
        const saved = await weeklyReportService.saveDepartmentUpdate(reportId, {
          id: submissionId,
          departmentId,
          disciplineId: items?.disciplineId,
          status: effective.status,
          progressPercent: progress,
          summary: draft.summary,
          keyAchievement: draft.keyAchievement,
          delayConstraint: draft.delayConstraint,
          nextWeekPlan: draft.nextWeekPlan,
          responsibleContactId: draft.responsibleContactId,
          targetDate: draft.targetDate,
        });
        setSubmissionId(saved.id);
        setDraft(effective);
        setPristine(effective);
        onSaved(saved);
      }

      setSavedAt(Date.now());
      toast.success(
        verdict === "approved"
          ? "Department submission approved"
          : verdict === "returned"
            ? "Department submission returned for revision"
            : level === "scope_item"
              ? "Scope summary saved"
              : "Department summary saved"
      );
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not save this update.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const fieldId = React.useId();

  return (
    <div className="space-y-3">
      <div className="rounded-md border-l-4 border-l-primary bg-muted/30 px-3 py-2">
        <h5 className="text-xs font-semibold">
          {level === "scope_item" ? "Scope Summary" : "Department Summary"}
        </h5>
        <p className="text-xs text-muted-foreground">
          Overall status and progress. Detailed authored comments are recorded
          separately below.
        </p>
      </div>

      {/*
        The department verdict is NOT recorded here.

        It used to be, and that was the defect: this editor only mounts inside
        the "Department Overall Update" disclosure, which is optional narrative
        and starts closed, so a Department Manager had no reachable Approve
        action at all. The verdict now lives on `DepartmentWorkflowBar`, which
        renders unconditionally at the top of the department card. The rule
        itself is unchanged and still `mayRecordVerdict` — kept here because the
        Status list below must still OFFER a verdict value to someone who may
        set one, and must still display one already recorded.
      */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${fieldId}-status`}>Status</FieldLabel>
          <Select
            value={draft.status}
            onValueChange={(value) => set("status", value as SubmissionStatus)}
          >
            <SelectTrigger
              id={`${fieldId}-status`}
              className="w-full"
              disabled={saving}
            >
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {/*
                The current value is always listed, even when it is a verdict
                this viewer cannot set: a row Project Control has already
                Approved must still READ as Approved rather than render an
                empty Status box.
              */}
              {(Object.keys(SUBMISSION_STATUS_META) as SubmissionStatus[])
                .filter(
                  (status) =>
                    DEPARTMENT_INPUT_STATUSES.includes(status) ||
                    (mayRecordVerdict && VERDICT_STATUSES.includes(status)) ||
                    status === draft.status
                )
                .map((status) => (
                  <SelectItem key={status} value={status}>
                    {SUBMISSION_STATUS_META[status].label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            {level === "scope_item"
              ? "Contributes to the Department’s overall completion status."
              : "Optional. Leaving it Pending does not block completion."}
          </FieldDescription>
        </Field>

        <Field data-invalid={progressInvalid || undefined}>
          <FieldLabel htmlFor={`${fieldId}-progress`}>
            Progress %
            <span className="text-xs font-normal text-muted-foreground">
              Optional
            </span>
          </FieldLabel>
          <Input
            id={`${fieldId}-progress`}
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            disabled={saving}
            aria-invalid={progressInvalid || undefined}
            value={draft.progressPercent}
            onChange={(event) => set("progressPercent", event.target.value)}
          />
          {progressInvalid && (
            <FieldDescription className="text-destructive">
              Enter a value between 0 and 100.
            </FieldDescription>
          )}
        </Field>
      </div>

      {/*
        Responsible Person and Target Date belong to the scope item, which is
        where the work is. Both columns already held data — `target_date` was
        populated on live rows — but no editor wrote them, so a value could be
        read and never corrected.
      */}
      {level === "scope_item" && items && names && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${fieldId}-responsible`}>
              Responsible Person
              <span className="text-xs font-normal text-muted-foreground">
                Optional
              </span>
            </FieldLabel>
            {/*
              Candidates are the people who hold THIS scope item, then everyone
              else the project assigned to the department. `department` used to
              be hardwired to `[]`, so any item without its own named assignee
              showed an empty picker even when the department was fully staffed
              — the "unexplained empty selector" this fixes.
            */}
            <ScopedPersonSelect
              value={draft.responsibleContactId}
              onChange={(id) => set("responsibleContactId", id)}
              responsible={responsible}
              department={items.departmentPeople}
              names={names}
              disabled={saving}
              label="Responsible person"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-target`}>
              Target Date
              <span className="text-xs font-normal text-muted-foreground">
                Optional
              </span>
            </FieldLabel>
            <Input
              id={`${fieldId}-target`}
              type="date"
              disabled={saving}
              value={draft.targetDate}
              onChange={(event) => set("targetDate", event.target.value)}
            />
            {/* Relevance travels with STATUS: a target matters while work is
                open, and is never demanded once it has been handed over. The
                field stays editable in every state so an old date can still be
                corrected — only the expectation changes, not the ability. */}
            <FieldDescription>
              {draft.status === "submitted" || draft.status === "approved"
                ? "Not needed once submitted or approved."
                : "When should this scope reach its next state?"}
            </FieldDescription>
          </Field>
        </div>
      )}

      {items && (
        <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.025] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h5 className="text-xs font-semibold tracking-wide text-primary uppercase">
                Weekly Comments / Updates
              </h5>
              <p className="text-xs text-muted-foreground">
                Independent authored comments. Monthly selection belongs to
                each comment.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-primary">
                {markedForMonthly} selected for Monthly
              </span>
              <Button
                type="button"
                size="sm"
                disabled={commentSaving !== null}
                onClick={addRow}
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add Comment
              </Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No comments yet. Use + Add Comment to record the first one.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((row, index) => (
                <WeeklyUpdateFields
                  key={row.key}
                  row={row}
                  number={index + 1}
                  responsible={items.responsible}
                  departmentPeople={items.departmentPeople}
                  names={items.names}
                  canEdit={
                    !row.source ||
                    items.canManageComments ||
                    row.source.createdByContactId === items.viewerContactId
                  }
                  saving={commentSaving === row.key}
                  onChange={(change) => patchRow(row.key, change)}
                  onMonthlyChange={(checked) =>
                    setMonthly(row.key, checked)
                  }
                  onRemove={() => removeRow(row.key)}
                  onSave={() => saveComment(row.key)}
                />
              ))}
            </div>
          )}
          {commentError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {commentError}
            </p>
          )}
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-3">
        {savedAt !== null && !dirty && (
          <span className="text-xs text-success" role="status">
            Saved
          </span>
        )}
        {dirty && !saving && (
          <span className="text-xs text-muted-foreground">
            Unsaved summary changes
          </span>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => save()}
          disabled={saving || !dirty || blocked}
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
          {saving
            ? "Saving…"
            : level === "scope_item"
              ? "Save Scope Summary"
              : "Save Department Summary"}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------- Read-only item list -------------------------- */

/** Compact authored comments for a viewer who may not change them. */
function ReadOnlyItems({
  entries,
  names,
}: {
  entries: WeeklyEntry[];
  names: WeeklyNameLookup;
}) {
  if (entries.length === 0) return null;
  const marked = entries.filter((entry) => entry.includeInMonthly).length;

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-semibold tracking-wide text-primary uppercase">
          Weekly Comments / Updates
        </h5>
        <span className="text-xs text-muted-foreground">
          {marked} selected for Monthly
        </span>
      </div>
      <ul className="space-y-2">
        {entries.map((entry, index) => (
          <li key={entry.id} className="rounded-md border p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-primary">
                Comment {index + 1}
              </span>
              <StatusBadge tone={ENTRY_STATUS_META[entry.status].tone}>
                {weeklyCommentLabel(entry)}
              </StatusBadge>
              {entry.includeInMonthly && (
                <span className="text-xs font-semibold text-primary">
                  ★ Monthly
                </span>
              )}
            </div>
            <p className="mt-1 text-sm whitespace-pre-wrap text-pretty">
              {entry.description}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Added by: {names.person(entry.createdByContactId)?.name ?? "Recorded user"}
              {entry.ownerContactId &&
                ` · Responsible: ${names.person(entry.ownerContactId)?.name ?? "Assigned person"}`}
              {` · Created: ${formatDateTime(entry.createdAt)}`}
              {entry.updatedByContactId &&
                entry.updatedByContactId !== entry.createdByContactId &&
                ` · Last edited by: ${names.person(entry.updatedByContactId)?.name ?? "Recorded user"}`}
              {entry.updatedAt !== entry.createdAt &&
                ` · Last edited: ${formatDateTime(entry.updatedAt)}`}
              {entry.dueDate && ` · Target: ${entry.dueDate}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------- Scope items ------------------------------ */

interface ScopeItemCardProps {
  reportId: string;
  departmentId: string;
  row: ScopeItemRow;
  names: WeeklyNameLookup;
  canEdit: boolean;
  canManageComments: boolean;
  /** Department-wide assignees, offered after the item's own holders. */
  departmentPeople: ScopeItemResponsibility[];
  viewerContactId?: string;
  onSaved: (submission: WeeklySubmission) => void;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
}

/**
 * One Program & Study / Discipline under a department.
 *
 * Collapsed by default, and the collapsed row is the executive scan: item,
 * code, System, who holds it and in what capacity, progress and status. A
 * department with a dozen scope items reads as a checklist of what is still
 * outstanding rather than a dozen open forms.
 */
function ScopeItemCard({
  reportId,
  departmentId,
  row,
  names,
  canEdit,
  canManageComments,
  departmentPeople,
  viewerContactId,
  onSaved,
  onEntrySaved,
  onEntryDeleted,
}: ScopeItemCardProps) {
  const [open, setOpen] = React.useState(false);
  const item = names.scopeItem(row.scopeItemId);
  const system = names.system(row.systemId);
  const submission = row.submission;
  // A detached item is history: its scope has left the project, so the row is
  // shown for the record and never re-opened for editing.
  const editable = canEdit && !row.detached;
  const lead = row.responsible[0];
  const leadName = lead ? names.person(lead.contactId)?.name : undefined;
  const monthlyCount = row.entries.filter(
    (entry) => entry.includeInMonthly
  ).length;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border bg-background"
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-1.5 text-left",
          "hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
          open && "rounded-b-none border-b"
        )}
      >
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {item?.name ?? "Unnamed item"}
          {item?.code && (
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {item.code}
            </span>
          )}
          {/* Dropped on the narrowest widths so the item's own name and code
              are never the part the truncation eats. */}
          {system && (
            <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
              · {system.name}
            </span>
          )}
        </span>

        {/* Responsibility, at the density the width allows. Role is the first
            thing dropped, then the name — never the unassigned warning. */}
        {leadName ? (
          <span className="hidden max-w-56 truncate text-xs text-muted-foreground lg:inline">
            {leadName}
            {row.responsible.length > 1 && ` +${row.responsible.length - 1}`}
            <span className="hidden xl:inline">
              {" · "}
              {ASSIGNMENT_ROLE_META[lead.assignmentRole].label}
            </span>
          </span>
        ) : (
          !row.detached && (
            <span className="inline-flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              Unassigned
            </span>
          )
        )}

        {monthlyCount > 0 && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {monthlyCount} in Monthly
          </span>
        )}
        {row.detached && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Unlink className="size-3.5" aria-hidden="true" />
            No longer in project scope
          </span>
        )}
        {typeof submission?.progressPercent === "number" && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {submission.progressPercent}%
          </span>
        )}
        {row.reported && submission ? (
          <StatusBadge tone={SUBMISSION_STATUS_META[submission.status].tone}>
            {SUBMISSION_STATUS_META[submission.status].label}
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Not reported</StatusBadge>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 px-3 py-3">
        <ResponsibilityLine responsible={row.responsible} names={names} />

        {editable ? (
          <UpdateEditor
            reportId={reportId}
            departmentId={departmentId}
            level="scope_item"
            existing={submission}
            responsible={row.responsible}
            names={names}
            onSaved={onSaved}
            items={{
              disciplineId: row.scopeItemId,
              systemId: row.systemId,
              entries: row.entries,
              responsible: row.responsible,
              departmentPeople,
              canManageComments,
              names,
              onEntrySaved,
              onEntryDeleted,
              viewerContactId,
            }}
          />
        ) : (
          <>
            <ReadOnlyUpdate submission={submission} level="scope_item" names={names} />
            <ReadOnlyItems entries={row.entries} names={names} />
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ScopeItemsBlockProps {
  reportId: string;
  section: DepartmentSection;
  scopeItemLabel: string;
  scopeItemLabelPlural: string;
  names: WeeklyNameLookup;
  canEdit: boolean;
  viewerContactId?: string;
  onSaved: (submission: WeeklySubmission) => void;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
}

/**
 * The level below the department: every scope item the project put in this
 * department that the viewer may reach, reported or not.
 *
 * The list is the project's scope, not the submissions — an item nobody has
 * filled in is exactly what Project Control is chasing, and a list built from
 * submissions would be silent about it.
 */
function ScopeItemsBlock({
  reportId,
  section,
  scopeItemLabel,
  scopeItemLabelPlural,
  names,
  canEdit,
  viewerContactId,
  onSaved,
  onEntrySaved,
  onEntryDeleted,
}: ScopeItemsBlockProps) {
  /*
   * Grouped by SYSTEM, because that is the reporting hierarchy the business
   * reads: Department → System → Program & Study / Discipline. The previous
   * flat alphabetical list interleaved items from different Systems and left
   * the System as a caption inside each row — a dozen items read as one
   * undifferentiated pile, which is exactly the "flat/confusing list" problem.
   *
   * Within a System: still-in-scope items first, then alphabetical. Items with
   * no System land in a trailing "No System assigned" group rather than being
   * silently mixed in.
   */
  const groups = React.useMemo(() => {
    const label = (row: ScopeItemRow) =>
      names.scopeItem(row.scopeItemId)?.name ?? "";
    const sorted = [...section.scopeItems].sort(
      (a, b) =>
        Number(a.detached) - Number(b.detached) ||
        label(a).localeCompare(label(b))
    );
    const bySystem = new Map<string, ScopeItemRow[]>();
    for (const row of sorted) {
      const key = row.systemId ?? "";
      const list = bySystem.get(key);
      if (list) list.push(row);
      else bySystem.set(key, [row]);
    }
    return [...bySystem.entries()]
      .map(([systemId, rows]) => ({
        systemId,
        system: names.system(systemId || undefined),
        rows,
      }))
      .sort((a, b) => {
        // The unassigned group always trails; named Systems alphabetical.
        if (!a.systemId) return 1;
        if (!b.systemId) return -1;
        return (a.system?.name ?? "").localeCompare(b.system?.name ?? "");
      });
  }, [section.scopeItems, names]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{scopeItemLabelPlural}</h4>
        {section.scopeItemsExpected > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {section.scopeItemsReported}/{section.scopeItemsExpected} reported
          </span>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {section.seesWholeDepartment
            ? `No ${scopeItemLabelPlural.toLowerCase()} are assigned to this department in this project. Add them in Project Setup.`
            : `You hold no ${scopeItemLabel.toLowerCase()} assignments in this department.`}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.systemId || "no-system"} className="space-y-1.5">
              <div className="flex items-baseline gap-2 border-l-2 border-primary/40 pl-2">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.system?.name ?? "No System assigned"}
                </span>
                {group.system?.code && (
                  <span className="font-mono text-[0.65rem] text-muted-foreground/70">
                    {group.system.code}
                  </span>
                )}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {group.rows.filter((row) => row.reported).length}/{group.rows.length} reported
                </span>
              </div>
              {group.rows.map((row) => (
                <ScopeItemCard
                  key={row.scopeItemId}
                  reportId={reportId}
                  departmentId={section.departmentId}
                  row={row}
                  names={names}
                  canEdit={canEdit}
                  canManageComments={section.seesWholeDepartment}
                  departmentPeople={section.eligiblePeople}
                  viewerContactId={viewerContactId}
                  onSaved={onSaved}
                  onEntrySaved={onEntrySaved}
                  onEntryDeleted={onEntryDeleted}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------- Department Overall Update (optional) ---------------- */

/** A one-line trace of what the overall update says, for the collapsed row. */
function overallPreview(submission: WeeklySubmission | undefined): string {
  const text =
    submission?.summary?.trim() ||
    submission?.keyAchievement?.trim() ||
    submission?.delayConstraint?.trim() ||
    submission?.nextWeekPlan?.trim();
  return text ? text.replace(/\s+/g, " ") : "";
}

interface OverallUpdateBlockProps {
  reportId: string;
  section: DepartmentSection;
  names: WeeklyNameLookup;
  canEdit: boolean;
  viewerContactId?: string;
  onSaved: (submission: WeeklySubmission) => void;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
}

/**
 * The Department Overall Update — what applies to the department as a whole
 * and belongs to no single scope item below it.
 *
 * Optional, and collapsed until asked for. It is stored as the submission row
 * with a NULL scope item, unchanged, and it is deliberately not part of the
 * department's completion test: `deriveDepartmentState` reads the rows that
 * exist, so a department whose scope items are all in can be Complete with
 * nothing written here. Open by default it took most of a screen and pushed
 * the scope items — the actual weekly content — below the fold.
 */
function OverallUpdateBlock({
  reportId,
  section,
  names,
  canEdit,
  viewerContactId,
  onSaved,
  onEntrySaved,
  onEntryDeleted,
}: OverallUpdateBlockProps) {
  const [open, setOpen] = React.useState(false);
  const submission = section.overallUpdate;
  const preview = overallPreview(submission);

  // Nothing written and nothing to write with: one quiet line, not a card.
  if (!canEdit && !preview && section.overallComments.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
        Department Overall Update — not reported. Optional; it does not affect
        completion.
      </p>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border bg-background"
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-1.5 text-left",
          "hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
          open && "rounded-b-none border-b"
        )}
      >
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
        <span className="text-sm font-medium">Department Overall Update</span>
        <span className="rounded-full border px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
          Optional
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {preview ||
            (section.overallComments.length > 0
              ? `${section.overallComments.length} department comment${section.overallComments.length === 1 ? "" : "s"}`
              : "Not reported")}
        </span>
        {typeof submission?.progressPercent === "number" && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {submission.progressPercent}%
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 px-3 py-3">
        <p className="text-xs text-muted-foreground">
          For what applies to the department as a whole. Anything belonging to
          one item below belongs on that item, not here.
        </p>
        {canEdit ? (
          <UpdateEditor
            /*
             * Re-seed when the canonical row's status changes underneath us.
             * The editor deliberately does not sync its draft from props — that
             * is what stops a background reload clobbering typing — but the
             * status is now also set from the workflow bar above. Without this
             * key the editor would keep the status it mounted with and a later
             * "Save Department Summary" would quietly write an approval back to
             * Pending.
             */
            key={`${submission?.id ?? "new"}:${submission?.status ?? "pending"}`}
            reportId={reportId}
            departmentId={section.departmentId}
            level="department"
            existing={submission}
            names={names}
            onSaved={onSaved}
            items={{
              entries: section.overallComments,
              responsible: [],
              departmentPeople: section.eligiblePeople,
              canManageComments: section.seesWholeDepartment,
              names,
              onEntrySaved,
              onEntryDeleted,
              viewerContactId,
            }}
          />
        ) : (
          <>
            <ReadOnlyUpdate submission={submission} level="department" names={names} />
            <ReadOnlyItems entries={section.overallComments} names={names} />
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/* -------------------------- Department workflow bar ------------------------ */

interface DepartmentWorkflowBarProps {
  reportId: string;
  section: DepartmentSection;
  /** Department input is open to this viewer — the same flag the editors use. */
  canEdit: boolean;
  onSaved: (submission: WeeklySubmission) => void;
}

/**
 * The department's own step in the Weekly cycle: Submit, then the Manager's
 * verdict — on the department's CANONICAL submission (scope item NULL).
 *
 * WHY THIS EXISTS AT ALL. Both actions used to live only inside the
 * department-level `UpdateEditor`, which mounts only inside the "Department
 * Overall Update" disclosure. That disclosure is optional narrative and starts
 * closed, and a closed Collapsible mounts nothing — so a Department Manager
 * signed in on a Weekly he owned had no Approve control anywhere on the page,
 * and the department had no Submit control either. The canonical row is the one
 * row `weekly_transition_blockers()` and `departmentApproval()` read, so the
 * step the lifecycle REQUIRES was the step the UI hid behind an affordance
 * labelled Optional. This bar is that step, rendered where it belongs.
 *
 * WHAT IT DOES NOT CHANGE.
 *
 *   Authority. `mayRecordVerdict` is the same pair as before —
 *   `canConsolidate` (Project Control / Report Coordinator / admin) or an
 *   assigned Department Manager of THIS department, read from the same context.
 *   Platform role is never consulted, here or anywhere below it.
 *
 *   The boundary. `weekly_submissions_update` still decides. A Team Member
 *   reaches the contributor statuses only; the verdict pair belongs to the
 *   manager branch, which additionally requires `discipline_id is null`. This
 *   decides what to OFFER and nothing more.
 *
 *   The row. Every stored field is sent back exactly as it was read, so a
 *   status transition can never blank a summary, a progress figure or an owner.
 *   `healthStatus` is deliberately not sent: the service leaves a column it is
 *   not given untouched.
 *
 *   The lifecycle. `canEdit` already carries `isEditableStatus("weekly", …)`
 *   for anyone who is not Project Control — the same draft/collecting/returned
 *   set as `weekly_report_accepts_department_input()`. Outside that window the
 *   bar is not offered, which is what the database would enforce anyway.
 */
function DepartmentWorkflowBar({
  reportId,
  section,
  canEdit,
  onSaved,
}: DepartmentWorkflowBarProps) {
  const verdictAuthority = React.useContext(SubmissionVerdictAuthorityContext);
  const [saving, setSaving] = React.useState<SubmissionStatus | null>(null);

  const existing = section.overallUpdate;
  const status: SubmissionStatus = existing?.status ?? "pending";

  const mayRecordVerdict =
    verdictAuthority.canConsolidate ||
    verdictAuthority.managedDepartmentIds.includes(section.departmentId);

  // Submitting is the department reporting on itself, so it follows department
  // input rights rather than the verdict pair. Already submitted or already
  // ruled on, there is nothing to submit.
  const maySubmit = status === "pending" || status === "in_progress" || status === "returned";

  /*
   * A verdict answers a submission. `03_REPORTING_ARCHITECTURE.md` §4.5 states
   * the department cycle as Not started -> In progress -> Submitted -> Accepted,
   * so approving a department that has never submitted would skip a step the
   * specification requires — the mirror of "a department's submission cannot
   * skip the Lead" (`05` §1.2). `approved` and `returned` both imply a prior
   * submission, so they count as answerable too.
   *
   * `canConsolidate` keeps its override: Project Control / an administrator
   * unblocking a stuck report is the documented exception, and taking it away
   * here would be a new restriction, not a fix. A Department Manager gets the
   * buttons either way — DISABLED with the reason stated, never absent, because
   * `03` §5 transition rule 6 requires the next required action to be visible.
   */
  const answerable =
    status === "submitted" || status === "approved" || status === "returned";
  const verdictBlocked = !answerable && !verdictAuthority.canConsolidate;

  if (!canEdit) return null;
  if (!maySubmit && !mayRecordVerdict) return null;

  const record = async (next: SubmissionStatus) => {
    setSaving(next);
    try {
      const saved = await weeklyReportService.saveDepartmentUpdate(reportId, {
        id: existing?.id,
        departmentId: section.departmentId,
        // Omitted, not null: the canonical department row is the one whose
        // scope item is absent, and the save matches it with `is null`.
        status: next,
        progressPercent: existing?.progressPercent,
        summary: existing?.summary,
        keyAchievement: existing?.keyAchievement,
        delayConstraint: existing?.delayConstraint,
        nextWeekPlan: existing?.nextWeekPlan,
        responsibleContactId: existing?.responsibleContactId,
        targetDate: existing?.targetDate,
      });
      onSaved(saved);
      toast.success(
        next === "approved"
          ? "Department submission approved"
          : next === "returned"
            ? "Department submission returned for revision"
            : "Department input submitted for review"
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Could not record this department decision."
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
      <div className="mr-auto min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          {mayRecordVerdict ? "Department Review" : "Department Submission"}
          <StatusBadge tone={SUBMISSION_STATUS_META[status].tone}>
            {SUBMISSION_STATUS_META[status].label}
          </StatusBadge>
        </p>
        <p className="text-xs text-muted-foreground">
          {status === "approved"
            ? "Approved. Project Control can now include this department in the Weekly review."
            : status === "returned"
              ? "Returned to the department for revision."
              : status === "submitted"
                ? mayRecordVerdict
                  ? "Submitted by the department and awaiting your decision."
                  : "Submitted. Awaiting the Department Manager’s decision."
                : mayRecordVerdict
                  ? verdictBlocked
                    ? "The department has not submitted this Weekly yet. Submit it, or wait for the department to, before recording a decision."
                    : "The department has not submitted this Weekly yet."
                  : "Submit once this department’s input is complete."}
        </p>
      </div>

      {maySubmit && (
        <Button
          type="button"
          size="sm"
          variant={mayRecordVerdict ? "outline" : "default"}
          onClick={() => record("submitted")}
          disabled={saving !== null}
        >
          {saving === "submitted" ? (
            <Loader2
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Send data-icon="inline-start" aria-hidden="true" />
          )}
          Submit Department Input
        </Button>
      )}

      {mayRecordVerdict && (
        <>
          <Button
            type="button"
            size="sm"
            onClick={() => record("approved")}
            disabled={saving !== null || status === "approved" || verdictBlocked}
          >
            {saving === "approved" ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Check data-icon="inline-start" aria-hidden="true" />
            )}
            Approve Department Submission
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => record("returned")}
            disabled={saving !== null || status === "returned" || verdictBlocked}
          >
            <Undo2 data-icon="inline-start" aria-hidden="true" />
            Return for Revision
          </Button>
        </>
      )}
    </div>
  );
}

/* ---------------------------- Department section --------------------------- */

export interface WeeklyDepartmentSectionProps {
  reportId: string;
  section: DepartmentSection;
  /** Wording for the level below the department, from the project type. */
  scopeItemLabel: string;
  scopeItemLabelPlural: string;
  /** Master-data names, resolved once for the whole panel. */
  names: WeeklyNameLookup;
  /**
   * Whether to render controls. The REASON it may be false is shown once, at
   * page level — repeating it against every department turned one explanation
   * into three identical sentences on the same screen.
   */
  canEdit: boolean;
  viewerContactId?: string;
  defaultOpen?: boolean;
  onSaved: (submission: WeeklySubmission) => void;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
}

/**
 * One department's Weekly input.
 *
 * Collapsible because a Project Control user opens a report covering every
 * department and needs the completion picture before the detail. The header
 * row is that picture: department and code, manager, how much has arrived out
 * of how much is owed, what is still outstanding, and the completion state —
 * so nothing has to be expanded to know where the week stands.
 */
export function WeeklyDepartmentSection({
  reportId,
  section,
  scopeItemLabel,
  scopeItemLabelPlural,
  names,
  canEdit,
  viewerContactId,
  defaultOpen = false,
  onSaved,
  onEntrySaved,
  onEntryDeleted,
}: WeeklyDepartmentSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const department = names.department(section.departmentId);
  const name = department?.name ?? "Unknown department";
  const managerName = names.person(section.managerContactId)?.name;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border bg-card"
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2 text-left",
          "hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
          open && "rounded-b-none border-b"
        )}
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {name}
          {department?.code && (
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
              {department.code}
            </span>
          )}
        </span>

        {/*
          Read from the project's own scoped assignments — the same source
          that decides who holds Department Manager AUTHORITY in Weekly. The
          master-data department's default lead is deliberately not used as a
          fallback: naming someone the manager of a project that never
          assigned them would put a name on the report that the permission
          model does not recognise.
        */}
        <span className="hidden max-w-48 truncate text-xs text-muted-foreground lg:inline">
          {managerName
            ? `Manager: ${managerName}`
            : "No manager assigned"}
        </span>
        {section.scopeItemsExpected > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {section.scopeItemsReported}/{section.scopeItemsExpected} reported
          </span>
        )}
        {section.missingInput ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            No input yet
          </span>
        ) : (
          section.scopeItemsOutstanding > 0 && (
            <span className="text-xs text-muted-foreground">
              {section.scopeItemsOutstanding} outstanding
            </span>
          )
        )}
        <StatusBadge tone={STATE_TONE[section.state]}>
          {section.stateLabel}
        </StatusBadge>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 px-3 py-3">
        {!section.seesWholeDepartment && (
          <p className="text-xs text-muted-foreground">
            Showing your assigned scope only.
          </p>
        )}

        {/*
          First, not buried: this is the department's step in the Weekly cycle
          and the row the lifecycle guard reads. It renders nothing at all for
          a viewer who may neither submit nor rule, so nobody gains an
          affordance they did not already have.
        */}
        <DepartmentWorkflowBar
          reportId={reportId}
          section={section}
          canEdit={canEdit}
          onSaved={onSaved}
        />

        <OverallUpdateBlock
          reportId={reportId}
          section={section}
          names={names}
          canEdit={canEdit}
          viewerContactId={viewerContactId}
          onSaved={onSaved}
          onEntrySaved={onEntrySaved}
          onEntryDeleted={onEntryDeleted}
        />

        <ScopeItemsBlock
          reportId={reportId}
          section={section}
          scopeItemLabel={scopeItemLabel}
          scopeItemLabelPlural={scopeItemLabelPlural}
          names={names}
          canEdit={canEdit}
          viewerContactId={viewerContactId}
          onSaved={onSaved}
          onEntrySaved={onEntrySaved}
          onEntryDeleted={onEntryDeleted}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
