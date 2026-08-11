"use client";

import * as React from "react";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Plus,
  Save,
  Trash2,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, type StatusTone } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import {
  ASSIGNMENT_ROLE_META,
  ENTRY_STATUS_META,
  PRIORITY_META,
  SUBMISSION_STATUS_META,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { weeklyReportService } from "@/services/weekly-report-service";
import type {
  EntryStatus,
  MasterRecordBase,
  Priority,
  SubmissionStatus,
  WeeklyEntry,
  WeeklySubmission,
} from "@/types";
import type {
  DepartmentSection,
  DepartmentState,
  ScopeItemResponsibility,
  ScopeItemRow,
} from "../workspace";
import { ScopedPersonSelect } from "./scoped-person-select";

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
  };
}

type NarrativeField =
  | "summary"
  | "keyAchievement"
  | "delayConstraint"
  | "nextWeekPlan";

const NARRATIVE_FIELDS: NarrativeField[] = [
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

interface LevelCopy {
  labels: Record<NarrativeField, string>;
  placeholders: Record<NarrativeField, string>;
  statusDescription: string;
}

const LEVEL_COPY: Record<UpdateLevel, LevelCopy> = {
  department: {
    labels: {
      summary: "Overall Update",
      keyAchievement: "Key Achievement",
      delayConstraint: "Delay / Constraint",
      nextWeekPlan: "Next Week Plan",
    },
    placeholders: {
      summary:
        "What applies to this department as a whole, and to no single item below.",
      keyAchievement: "The main department-wide win this week.",
      delayConstraint: "Anything holding the whole department back.",
      nextWeekPlan: "What the department plans next week.",
    },
    statusDescription: "Optional. Leaving it Pending does not block completion.",
  },
  scope_item: {
    labels: {
      summary: "Weekly Update / Current Progress",
      keyAchievement: "Key Achievement",
      delayConstraint: "Delay / Constraint",
      nextWeekPlan: "Next Week Plan",
    },
    placeholders: {
      summary:
        "Briefly describe progress and key developments for this scope item during the reporting week.",
      keyAchievement: "The main win for this scope item this week.",
      delayConstraint: "Anything holding this scope item back.",
      nextWeekPlan: "What is planned for this scope item next week.",
    },
    statusDescription:
      "Contributes to the Department’s overall completion status.",
  },
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
function ReadOnlyUpdate({
  submission,
  level,
}: {
  submission: WeeklySubmission | undefined;
  level: UpdateLevel;
}) {
  const status = submission?.status ?? "pending";
  const { labels } = LEVEL_COPY[level];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
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
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {NARRATIVE_FIELDS.map((key) => (
          <ReadOnlyText
            key={key}
            label={labels[key]}
            value={submission?.[key] ?? ""}
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------- Required action / support ---------------------- */

/**
 * One editable Required Action / Support row.
 *
 * Backed by `weekly_entries`, which already carries description, owner, due
 * date, status, priority and the Include in Monthly flag — so nothing new is
 * stored and Monthly compilation can later read these rows unchanged.
 */
interface ActionDraft {
  /** Stable across renders, including before the row has an id. */
  key: string;
  id?: string;
  description: string;
  priority: Priority;
  status: EntryStatus;
  ownerContactId: string;
  dueDate: string;
  includeInMonthly: boolean;
}

function toActionDraft(entry: WeeklyEntry): ActionDraft {
  return {
    key: entry.id,
    id: entry.id,
    description: entry.description,
    priority: entry.priority,
    status: entry.status,
    ownerContactId: entry.ownerContactId ?? "",
    dueDate: entry.dueDate ?? "",
    includeInMonthly: entry.includeInMonthly,
  };
}

/**
 * The kind and classification every row created here carries.
 *
 * Fixed rather than chosen: this block is one purpose — the support or action
 * a scope item needs — and offering the full entry taxonomy would turn a
 * lightweight list into the action-management surface this is explicitly not.
 * It also keeps these rows out of the project-level Critical Issues and
 * Decisions lists, which select on `entryType` and on the `escalation`
 * category, so nothing is reported twice. The report-level form still writes
 * every type.
 */
const ACTION_ENTRY_TYPE = "action" as const;
const ACTION_ENTRY_CATEGORY = "general" as const;

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

interface ActionsConfig {
  disciplineId: string;
  systemId?: string;
  entries: WeeklyEntry[];
  /** Who holds this scope item. Offered first in the owner picker. */
  responsible: ScopeItemResponsibility[];
  /** Everyone else the project assigned to this department. */
  departmentPeople: ScopeItemResponsibility[];
  names: WeeklyNameLookup;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
}

interface UpdateEditorProps {
  reportId: string;
  departmentId: string;
  /** Chooses the wording. The stored row is the same either way. */
  level: UpdateLevel;
  existing: WeeklySubmission | undefined;
  onSaved: (submission: WeeklySubmission) => void;
  /**
   * Present only at the scope-item level. When given, the Required Action /
   * Support list is edited here too and committed by the same button.
   */
  actions?: ActionsConfig;
}

/**
 * One department-owned Weekly update, and — at the scope-item level — the
 * Required Action / Support rows that belong with it, behind ONE Save.
 *
 * The two used to be separate forms with separate buttons, which read as two
 * unrelated obligations on a screen where they are plainly one. They are still
 * two writes to two tables, because that is what they are: `saveDepartmentUpdate`
 * updates the single row identified by (report, department, scope item), and
 * each action row is a `weekly_entries` upsert. Nothing about that changed —
 * only that one press performs both, and each part is skipped when it is not
 * dirty, so pressing Save never rewrites what the user did not touch.
 *
 * Ids are folded back the moment a row returns, one row at a time. That is
 * what makes a retry after a mid-way failure update the rows that already
 * landed instead of inserting twins of them.
 *
 * State is deliberately not synchronised from props: this component keeps the
 * identity of what it has saved, so a background reload cannot clobber typing.
 */
function UpdateEditor({
  reportId,
  departmentId,
  level,
  existing,
  onSaved,
  actions,
}: UpdateEditorProps) {
  const copy = LEVEL_COPY[level];
  const [submissionId, setSubmissionId] = React.useState(existing?.id);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(existing));
  const [pristine, setPristine] = React.useState<Draft>(() => toDraft(existing));

  const [rows, setRows] = React.useState<ActionDraft[]>(() =>
    (actions?.entries ?? []).map(toActionDraft)
  );
  const [rowsPristine, setRowsPristine] = React.useState(() =>
    JSON.stringify((actions?.entries ?? []).map(toActionDraft))
  );
  const [removed, setRemoved] = React.useState<string[]>([]);

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const nextKey = React.useRef(0);

  const updateDirty = React.useMemo(
    () =>
      (Object.keys(pristine) as (keyof Draft)[]).some(
        (key) => draft[key] !== pristine[key]
      ),
    [draft, pristine]
  );
  const actionsDirty =
    JSON.stringify(rows) !== rowsPristine || removed.length > 0;
  const dirty = updateDirty || actionsDirty;

  const progress =
    draft.progressPercent === "" ? undefined : Number(draft.progressPercent);
  const progressInvalid =
    progress !== undefined &&
    (!Number.isFinite(progress) || progress < 0 || progress > 100);
  const actionIncomplete = rows.some((row) => !row.description.trim());
  const blocked = progressInvalid || actionIncomplete;

  const markedForMonthly = rows.filter((row) => row.includeInMonthly).length;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSavedAt(null);
  };

  const patchRow = (key: string, change: Partial<ActionDraft>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row))
    );
    setSavedAt(null);
  };

  const addRow = () => {
    nextKey.current += 1;
    setRows((current) => [
      ...current,
      {
        key: `new-${nextKey.current}`,
        description: "",
        priority: "medium",
        status: "open",
        ownerContactId: "",
        dueDate: "",
        includeInMonthly: false,
      },
    ]);
    setSavedAt(null);
  };

  const removeRow = (key: string) => {
    const row = rows.find((candidate) => candidate.key === key);
    // Only a persisted row needs deleting; one added and dropped in the same
    // sitting never reached the database.
    if (row?.id) setRemoved((current) => [...current, row.id!]);
    setRows((current) => current.filter((candidate) => candidate.key !== key));
    setSavedAt(null);
  };

  const save = async () => {
    if (blocked || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      if (updateDirty) {
        const saved = await weeklyReportService.saveDepartmentUpdate(reportId, {
          id: submissionId,
          departmentId,
          disciplineId: actions?.disciplineId,
          status: draft.status,
          progressPercent: progress,
          summary: draft.summary,
          keyAchievement: draft.keyAchievement,
          delayConstraint: draft.delayConstraint,
          nextWeekPlan: draft.nextWeekPlan,
        });
        setSubmissionId(saved.id);
        setPristine(draft);
        onSaved(saved);
      }

      if (actions && actionsDirty) {
        for (const entryId of removed) {
          await weeklyReportService.deleteEntry(reportId, entryId);
          actions.onEntryDeleted(entryId);
          // Dropped from the pending list as it lands, so a retry after a
          // later failure does not delete it a second time.
          setRemoved((current) => current.filter((id) => id !== entryId));
        }

        const saved: ActionDraft[] = [];
        for (const row of rows) {
          const entry = await weeklyReportService.saveEntry(reportId, {
            id: row.id,
            entryType: ACTION_ENTRY_TYPE,
            category: ACTION_ENTRY_CATEGORY,
            description: row.description.trim(),
            priority: row.priority,
            status: row.status,
            ownerContactId: row.ownerContactId || undefined,
            dueDate: row.dueDate || undefined,
            departmentId,
            systemId: actions.systemId,
            disciplineId: actions.disciplineId,
            includeInMonthly: row.includeInMonthly,
          });
          actions.onEntrySaved(entry);
          const next = { ...toActionDraft(entry), key: row.key };
          saved.push(next);
          // Keep the row's identity as soon as it exists, so a second save
          // updates rather than inserts.
          setRows((current) =>
            current.map((candidate) =>
              candidate.key === row.key ? next : candidate
            )
          );
        }
        setRowsPristine(JSON.stringify(saved));
      }

      setSavedAt(Date.now());
      toast.success("Update saved");
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
              {(Object.keys(SUBMISSION_STATUS_META) as SubmissionStatus[]).map(
                (status) => (
                  <SelectItem key={status} value={status}>
                    {SUBMISSION_STATUS_META[status].label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          <FieldDescription>{copy.statusDescription}</FieldDescription>
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

      <Field>
        <FieldLabel htmlFor={`${fieldId}-summary`}>
          {copy.labels.summary}
        </FieldLabel>
        <Textarea
          id={`${fieldId}-summary`}
          rows={3}
          disabled={saving}
          placeholder={copy.placeholders.summary}
          value={draft.summary}
          onChange={(event) => set("summary", event.target.value)}
        />
      </Field>

      {/* Two-up: three short narratives that used to stack full width. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {(["keyAchievement", "delayConstraint", "nextWeekPlan"] as const).map(
          (key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`${fieldId}-${key}`}>
                {copy.labels[key]}
              </FieldLabel>
              <Textarea
                id={`${fieldId}-${key}`}
                rows={2}
                disabled={saving}
                placeholder={copy.placeholders[key]}
                value={draft[key]}
                onChange={(event) => set(key, event.target.value)}
              />
            </Field>
          )
        )}
      </div>

      {actions && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-xs font-semibold">Required Action / Support</h5>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {markedForMonthly > 0
                  ? `${markedForMonthly} marked for Monthly`
                  : "None marked for Monthly"}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={addRow}
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add
              </Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing raised for this scope item this week.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.key} className="space-y-2 rounded-md border p-2.5">
                  <Textarea
                    rows={2}
                    disabled={saving}
                    aria-label="Required action or support needed"
                    placeholder="What is needed, and from whom."
                    value={row.description}
                    onChange={(event) =>
                      patchRow(row.key, { description: event.target.value })
                    }
                  />

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Select
                      value={row.priority}
                      onValueChange={(value) =>
                        patchRow(row.key, { priority: value as Priority })
                      }
                    >
                      <SelectTrigger
                        className="w-full"
                        disabled={saving}
                        aria-label="Priority"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
                          <SelectItem key={p} value={p}>
                            {PRIORITY_META[p].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={row.status}
                      onValueChange={(value) =>
                        patchRow(row.key, { status: value as EntryStatus })
                      }
                    >
                      <SelectTrigger
                        className="w-full"
                        disabled={saving}
                        aria-label="Action status"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ENTRY_STATUS_META) as EntryStatus[]).map(
                          (s) => (
                            <SelectItem key={s} value={s}>
                              {ENTRY_STATUS_META[s].label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>

                    {/*
                      Scoped to the project's own assignments — see
                      ScopedPersonSelect. An owner here is someone accountable
                      on this project, not any contact in master data.
                    */}
                    <ScopedPersonSelect
                      value={row.ownerContactId}
                      onChange={(id) => patchRow(row.key, { ownerContactId: id })}
                      responsible={actions.responsible}
                      department={actions.departmentPeople}
                      names={actions.names}
                      disabled={saving}
                    />

                    <Input
                      type="date"
                      disabled={saving}
                      aria-label="Target date"
                      value={row.dueDate}
                      onChange={(event) =>
                        patchRow(row.key, { dueDate: event.target.value })
                      }
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="flex items-center gap-2 text-xs font-normal">
                      <Checkbox
                        checked={row.includeInMonthly}
                        disabled={saving}
                        onCheckedChange={(checked) =>
                          patchRow(row.key, { includeInMonthly: checked === true })
                        }
                      />
                      Include in Monthly report
                    </Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => removeRow(row.key)}
                    >
                      <Trash2 data-icon="inline-start" aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
        {actionIncomplete && (
          <span className="text-xs text-destructive">
            Every action row needs a description.
          </span>
        )}
        {savedAt !== null && !dirty && (
          <span className="text-xs text-success" role="status">
            Saved
          </span>
        )}
        {dirty && !saving && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
        <Button
          type="button"
          size="sm"
          onClick={save}
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
            : actions
              ? "Save update and actions"
              : "Save overall update"}
        </Button>
      </div>
      {/* Named so the single button's reach is never in doubt. */}
      {actions && (
        <p className="text-right text-xs text-muted-foreground">
          Saves the weekly update and the Required Action / Support rows
          together.
        </p>
      )}
    </div>
  );
}

/* --------------------------- Read-only action list ------------------------- */

/** The Required Action / Support rows, for a viewer who may not change them. */
function ReadOnlyActions({
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
        <h5 className="text-xs font-semibold">Required Action / Support</h5>
        <span className="text-xs text-muted-foreground">
          {marked > 0 ? `${marked} marked for Monthly` : "None marked for Monthly"}
        </span>
      </div>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-md border p-2.5">
            <p className="text-sm whitespace-pre-wrap text-pretty">
              {entry.description}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {PRIORITY_META[entry.priority].label} ·{" "}
              {ENTRY_STATUS_META[entry.status].label}
              {entry.ownerContactId &&
                ` · ${names.person(entry.ownerContactId)?.name ?? "Owner"}`}
              {entry.dueDate && ` · due ${entry.dueDate}`}
              {entry.includeInMonthly && " · In Monthly"}
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
  /** The department's assigned people, for owner selection. */
  eligiblePeople: ScopeItemResponsibility[];
  names: WeeklyNameLookup;
  canEdit: boolean;
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
  eligiblePeople,
  names,
  canEdit,
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
            onSaved={onSaved}
            actions={{
              disciplineId: row.scopeItemId,
              systemId: row.systemId,
              entries: row.entries,
              responsible: row.responsible,
              departmentPeople: eligiblePeople,
              names,
              onEntrySaved,
              onEntryDeleted,
            }}
          />
        ) : (
          <>
            <ReadOnlyUpdate submission={submission} level="scope_item" />
            <ReadOnlyActions entries={row.entries} names={names} />
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
  onSaved,
  onEntrySaved,
  onEntryDeleted,
}: ScopeItemsBlockProps) {
  const rows = React.useMemo(() => {
    const label = (row: ScopeItemRow) =>
      names.scopeItem(row.scopeItemId)?.name ?? "";
    // Still-in-scope items first; alphabetical within each group, which is how
    // someone looks one up. The derivation keeps no meaningful order of its own.
    return [...section.scopeItems].sort(
      (a, b) =>
        Number(a.detached) - Number(b.detached) ||
        label(a).localeCompare(label(b))
    );
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

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {section.seesWholeDepartment
            ? `No ${scopeItemLabelPlural.toLowerCase()} are assigned to this department in this project. Add them in Project Setup.`
            : `You hold no ${scopeItemLabel.toLowerCase()} assignments in this department.`}
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <ScopeItemCard
              key={row.scopeItemId}
              reportId={reportId}
              departmentId={section.departmentId}
              row={row}
              eligiblePeople={section.eligiblePeople}
              names={names}
              canEdit={canEdit}
              onSaved={onSaved}
              onEntrySaved={onEntrySaved}
              onEntryDeleted={onEntryDeleted}
            />
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
  canEdit: boolean;
  onSaved: (submission: WeeklySubmission) => void;
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
  canEdit,
  onSaved,
}: OverallUpdateBlockProps) {
  const [open, setOpen] = React.useState(false);
  const submission = section.overallUpdate;
  const preview = overallPreview(submission);

  // Nothing written and nothing to write with: one quiet line, not a card.
  if (!canEdit && !preview) {
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
          {preview || "Not reported"}
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
            reportId={reportId}
            departmentId={section.departmentId}
            level="department"
            existing={submission}
            onSaved={onSaved}
          />
        ) : (
          <ReadOnlyUpdate submission={submission} level="department" />
        )}
      </CollapsibleContent>
    </Collapsible>
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

        <OverallUpdateBlock
          reportId={reportId}
          section={section}
          canEdit={canEdit}
          onSaved={onSaved}
        />

        <ScopeItemsBlock
          reportId={reportId}
          section={section}
          scopeItemLabel={scopeItemLabel}
          scopeItemLabelPlural={scopeItemLabelPlural}
          names={names}
          canEdit={canEdit}
          onSaved={onSaved}
          onEntrySaved={onEntrySaved}
          onEntryDeleted={onEntryDeleted}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
