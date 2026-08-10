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
import { ManagedPersonSelect, useMasterData } from "@/features/master-data";
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

/* ------------------------------- Update form ------------------------------ */

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
      summary: "Summary",
      keyAchievement: "Key Achievement",
      delayConstraint: "Delay / Constraint",
      nextWeekPlan: "Next Week Plan",
    },
    placeholders: {
      summary: "What this department did this week.",
      keyAchievement: "The main win this week.",
      delayConstraint: "Anything holding the work back.",
      nextWeekPlan: "What is planned for next week.",
    },
    statusDescription: "Drives this department’s completion state above.",
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
    <div className="space-y-1">
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
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Status</p>
          <StatusBadge tone={SUBMISSION_STATUS_META[status].tone}>
            {SUBMISSION_STATUS_META[status].label}
          </StatusBadge>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Progress %</p>
          <p className="text-sm font-medium tabular-nums">
            {typeof submission?.progressPercent === "number"
              ? `${submission.progressPercent}%`
              : "Not reported"}
          </p>
        </div>
      </div>
      {NARRATIVE_FIELDS.map((key) => (
        <ReadOnlyText
          key={key}
          label={labels[key]}
          value={submission?.[key] ?? ""}
        />
      ))}
    </div>
  );
}

interface UpdateFormProps {
  reportId: string;
  departmentId: string;
  /**
   * The scope item this update belongs to, or undefined for the General
   * Department Update. Passed straight through to the save, which identifies
   * the row by (report, department, scope item).
   */
  disciplineId?: string;
  /** Chooses the wording. The stored row is the same either way. */
  level: UpdateLevel;
  existing: WeeklySubmission | undefined;
  onSaved: (submission: WeeklySubmission) => void;
}

/**
 * One department-owned Weekly update — the department-level input, or one
 * scope item's.
 *
 * Saved through `saveDepartmentUpdate`, which updates that one row in place.
 * That is the whole reason this form does not reuse the report's replace-all
 * save: a manager saving their department must not be able to delete another
 * department's input, and pressing Save twice must not leave two updates
 * behind. The two levels share this form rather than each having their own,
 * because they are the same record with a different scope.
 */
function UpdateForm({
  reportId,
  departmentId,
  disciplineId,
  level,
  existing,
  onSaved,
}: UpdateFormProps) {
  const copy = LEVEL_COPY[level];
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(existing));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  /*
   * What was last saved, so "Unsaved changes" means what it says. Seeded once
   * and advanced by a successful save; the caller remounts this form when the
   * row it edits changes identity, which is why nothing here synchronises the
   * prop back into state. Typing is never clobbered by a background reload.
   */
  const [pristine, setPristine] = React.useState<Draft>(() => toDraft(existing));

  const dirty = React.useMemo(
    () =>
      (Object.keys(pristine) as (keyof Draft)[]).some(
        (key) => draft[key] !== pristine[key]
      ),
    [draft, pristine]
  );

  const progress =
    draft.progressPercent === "" ? undefined : Number(draft.progressPercent);
  const progressInvalid =
    progress !== undefined &&
    (!Number.isFinite(progress) || progress < 0 || progress > 100);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSavedAt(null);
  };

  const save = async () => {
    if (progressInvalid) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await weeklyReportService.saveDepartmentUpdate(reportId, {
        id: existing?.id,
        departmentId,
        disciplineId,
        status: draft.status,
        progressPercent: progress,
        summary: draft.summary,
        keyAchievement: draft.keyAchievement,
        delayConstraint: draft.delayConstraint,
        nextWeekPlan: draft.nextWeekPlan,
      });
      setPristine(draft);
      setSavedAt(Date.now());
      toast.success("Update saved");
      onSaved(saved);
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
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
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
              {(
                Object.keys(SUBMISSION_STATUS_META) as SubmissionStatus[]
              ).map((status) => (
                <SelectItem key={status} value={status}>
                  {SUBMISSION_STATUS_META[status].label}
                </SelectItem>
              ))}
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

      {NARRATIVE_FIELDS.map((key) => (
        <Field key={key}>
          <FieldLabel htmlFor={`${fieldId}-${key}`}>
            {copy.labels[key]}
          </FieldLabel>
          <Textarea
            id={`${fieldId}-${key}`}
            rows={key === "summary" ? 3 : 2}
            disabled={saving}
            placeholder={copy.placeholders[key]}
            value={draft[key]}
            onChange={(event) => set(key, event.target.value)}
          />
        </Field>
      ))}

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
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={saving || !dirty || progressInvalid}
        >
          {saving ? (
            <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : (
            <Save data-icon="inline-start" aria-hidden="true" />
          )}
          {saving ? "Saving…" : "Save Update"}
        </Button>
      </div>
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
      <p className="text-xs text-muted-foreground">
        No one is assigned to this scope item on this project. Assign someone in
        Project Setup.
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
 * The report-level form still writes every type.
 */
const ACTION_ENTRY_TYPE = "action" as const;
const ACTION_ENTRY_CATEGORY = "general" as const;

interface RequiredActionsProps {
  reportId: string;
  departmentId: string;
  disciplineId: string;
  systemId?: string;
  entries: WeeklyEntry[];
  names: WeeklyNameLookup;
  canEdit: boolean;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
}

function RequiredActions({
  reportId,
  departmentId,
  disciplineId,
  systemId,
  entries,
  names,
  canEdit,
  onEntrySaved,
  onEntryDeleted,
}: RequiredActionsProps) {
  const [rows, setRows] = React.useState<ActionDraft[]>(() =>
    entries.map(toActionDraft)
  );
  const [pristine, setPristine] = React.useState(() =>
    JSON.stringify(entries.map(toActionDraft))
  );
  const [removed, setRemoved] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const nextKey = React.useRef(0);

  const dirty = JSON.stringify(rows) !== pristine || removed.length > 0;
  const incomplete = rows.some((row) => !row.description.trim());
  const markedForMonthly = rows.filter((row) => row.includeInMonthly).length;

  const patch = (key: string, change: Partial<ActionDraft>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row))
    );
  };

  const add = () => {
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
  };

  const remove = (key: string) => {
    const row = rows.find((candidate) => candidate.key === key);
    // Only a persisted row needs deleting; one added and dropped in the same
    // sitting never reached the database.
    if (row?.id) setRemoved((current) => [...current, row.id!]);
    setRows((current) => current.filter((candidate) => candidate.key !== key));
  };

  const save = async () => {
    if (incomplete) return;
    setSaving(true);
    setError(null);
    try {
      for (const entryId of removed) {
        await weeklyReportService.deleteEntry(reportId, entryId);
        onEntryDeleted(entryId);
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
          systemId,
          disciplineId,
          includeInMonthly: row.includeInMonthly,
        });
        onEntrySaved(entry);
        // Keep the row's identity so a second save updates rather than inserts.
        saved.push({ ...toActionDraft(entry), key: row.key });
      }

      setRows(saved);
      setPristine(JSON.stringify(saved));
      setRemoved([]);
      toast.success("Required action / support saved");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not save these rows.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit && rows.length === 0) return null;

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-semibold">Required Action / Support</h5>
        <span className="text-xs text-muted-foreground">
          {markedForMonthly > 0
            ? `${markedForMonthly} marked for Monthly`
            : "None marked for Monthly"}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing raised for this scope item this week.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="space-y-2 rounded-md border p-2.5">
              {canEdit ? (
                <Textarea
                  rows={2}
                  disabled={saving}
                  aria-label="Required action or support needed"
                  placeholder="What is needed, and from whom."
                  value={row.description}
                  onChange={(event) =>
                    patch(row.key, { description: event.target.value })
                  }
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap text-pretty">
                  {row.description}
                </p>
              )}

              {canEdit ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Select
                    value={row.priority}
                    onValueChange={(value) =>
                      patch(row.key, { priority: value as Priority })
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
                      patch(row.key, { status: value as EntryStatus })
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

                  <ManagedPersonSelect
                    value={row.ownerContactId}
                    onChange={(id) => patch(row.key, { ownerContactId: id })}
                    allowClear
                    disabled={saving}
                    placeholder="Owner…"
                    clearLabel="Clear owner"
                  />

                  <Input
                    type="date"
                    disabled={saving}
                    aria-label="Target date"
                    value={row.dueDate}
                    onChange={(event) =>
                      patch(row.key, { dueDate: event.target.value })
                    }
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {PRIORITY_META[row.priority].label} ·{" "}
                  {ENTRY_STATUS_META[row.status].label}
                  {row.ownerContactId &&
                    ` · ${names.person(row.ownerContactId)?.name ?? "Owner"}`}
                  {row.dueDate && ` · due ${row.dueDate}`}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="flex items-center gap-2 text-xs font-normal">
                  <Checkbox
                    checked={row.includeInMonthly}
                    disabled={!canEdit || saving}
                    onCheckedChange={(checked) =>
                      patch(row.key, { includeInMonthly: checked === true })
                    }
                  />
                  Include in Monthly
                </Label>
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => remove(row.key)}
                  >
                    <Trash2 data-icon="inline-start" aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
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

      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {incomplete && (
            <span className="text-xs text-destructive">
              Every row needs a description.
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={add}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving || !dirty || incomplete}
            onClick={save}
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
            {saving ? "Saving…" : "Save Actions"}
          </Button>
        </div>
      )}
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
  onSaved: (submission: WeeklySubmission) => void;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
}

/**
 * One Program & Study / Discipline under a department.
 *
 * Collapsed by default and labelled with what has arrived, so a department
 * with a dozen scope items reads as a checklist of what is still outstanding
 * rather than a dozen open forms.
 */
function ScopeItemCard({
  reportId,
  departmentId,
  row,
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

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border bg-background"
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md px-3 py-2 text-left",
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
          {system && (
            <span className="ml-2 text-xs text-muted-foreground">
              · {system.name}
            </span>
          )}
        </span>

        {/* Last to be given room, first to be dropped when there is none. */}
        {leadName && (
          <span className="hidden max-w-40 truncate text-xs text-muted-foreground lg:inline">
            {leadName}
            {row.responsible.length > 1 && ` +${row.responsible.length - 1}`}
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
          /*
           * Keyed on the row being edited: when the first save turns "no row
           * yet" into a real one, the form remounts onto it and its saved
           * baseline comes from the database rather than from local state.
           */
          <UpdateForm
            key={submission?.id ?? "new"}
            reportId={reportId}
            departmentId={departmentId}
            disciplineId={row.scopeItemId}
            level="scope_item"
            existing={submission}
            onSaved={onSaved}
          />
        ) : (
          <ReadOnlyUpdate submission={submission} level="scope_item" />
        )}

        <RequiredActions
          /*
           * Remounted when the persisted set changes identity, so the list's
           * saved baseline always comes from the database rather than from a
           * stale local copy.
           */
          key={row.entries.map((entry) => entry.id).join("|")}
          reportId={reportId}
          departmentId={departmentId}
          disciplineId={row.scopeItemId}
          systemId={row.systemId}
          entries={row.entries}
          names={names}
          canEdit={editable}
          onEntrySaved={onEntrySaved}
          onEntryDeleted={onEntryDeleted}
        />
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

  const total = rows.filter((row) => !row.detached).length;

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{scopeItemLabelPlural}</h4>
        {total > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {section.scopeItemsReported}/{total} reported
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
        <div className="space-y-2">
          {rows.map((row) => (
            <ScopeItemCard
              key={row.scopeItemId}
              reportId={reportId}
              departmentId={section.departmentId}
              row={row}
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
 * department and needs the completion picture before the detail — the header
 * row carries the state and the missing-input flag, so nothing has to be
 * expanded to see what is outstanding.
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
  const outstanding =
    section.scopeItems.filter((row) => !row.detached && !row.reported).length;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border bg-card"
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-4 py-3 text-left",
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

        {section.missingInput && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            No input yet
          </span>
        )}
        {outstanding > 0 && !section.missingInput && (
          <span className="text-xs text-muted-foreground">
            {outstanding} {scopeItemLabelPlural.toLowerCase()} outstanding
          </span>
        )}
        {typeof section.generalUpdate?.progressPercent === "number" && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {section.generalUpdate.progressPercent}%
          </span>
        )}
        <StatusBadge tone={STATE_TONE[section.state]}>
          {section.stateLabel}
        </StatusBadge>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">General Department Update</h4>
          {!section.seesWholeDepartment && (
            <span className="text-xs text-muted-foreground">
              Showing your assigned scope only
            </span>
          )}
        </div>

        {canEdit ? (
          <UpdateForm
            key={section.generalUpdate?.id ?? "new"}
            reportId={reportId}
            departmentId={section.departmentId}
            level="department"
            existing={section.generalUpdate}
            onSaved={onSaved}
          />
        ) : (
          <ReadOnlyUpdate
            submission={section.generalUpdate}
            level="department"
          />
        )}

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
