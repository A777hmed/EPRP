"use client";

import * as React from "react";
import { Loader2, PencilLine, ShieldCheck } from "lucide-react";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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
import { ContextHelp, StatusBadge } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { setupGovernanceService, type SetupControlState } from "@/services/setup-governance-service";
import { CONFIRMATION_TOAST_DURATION_MS, showCompactToast } from "@/features/notifications/compact-toast";
import { compactAmendmentToast } from "../../amendment-toast";
import type { Client, ProjectType } from "@/types";
import { isOtherProjectCategory } from "../../project-category";
import {
  amendableField,
  fieldPresentation,
  formatSetupValue,
  proposedColumnValue,
  sameColumnValue,
  type SetupAmendment,
  type SetupValueLookups,
} from "../../setup-amendments";

/* ------------------------------ form context ------------------------------ */

/**
 * What the Project Setup form needs to present field classes once Setup is
 * Controlled. Absent (or `controlled: false`) means every field behaves
 * exactly as before 13.9B.
 */
export interface SetupFormGovernance {
  controlled: boolean;
  /** The current user may request amendments here (Project Setup authority, not archived). */
  canAmend: boolean;
  /** Pending request per field key. */
  pending: ReadonlyMap<string, SetupAmendment>;
  onAmend: (fieldKey: string) => void;
  /** 13.12: the original baseline (BL0) is approved, so Planned Start / Finish are superseded. */
  supersededByBl0?: boolean;
  /** Planning Entry: the derived control state and the Finalise action (no-formal-schedule). */
  finalise?: SetupFinaliseContext;
}

export interface SetupFinaliseContext {
  control: SetupControlState;
  /** System Administrator, Project Control Admin or assigned Project Control, project not archived. */
  canFinalise: boolean;
  onFinalised: () => void;
}

const GovernanceContext = React.createContext<SetupFormGovernance | null>(null);

export function SetupGovernanceProvider({
  value,
  children,
}: {
  value: SetupFormGovernance | null | undefined;
  children: React.ReactNode;
}) {
  return <GovernanceContext.Provider value={value ?? null}>{children}</GovernanceContext.Provider>;
}

export function useSetupFormGovernance(): SetupFormGovernance | null {
  return React.useContext(GovernanceContext);
}

/**
 * One Project Setup field, presented by its class (`02` §26.24.2). Before
 * Controlled — or for a free / logged field — the field renders exactly as
 * before. A lightweight or governed field shows its saved value (the control
 * is inert, so the ordinary Save can never carry a change to it) and offers
 * "Amend" / "Request amendment" instead.
 */
export function GovernedField({
  fieldKey,
  children,
  className,
}: {
  fieldKey: string;
  children: React.ReactNode;
  className?: string;
}) {
  const governance = useSetupFormGovernance();
  const presentation = fieldPresentation(fieldKey, Boolean(governance?.controlled), Boolean(governance?.supersededByBl0));
  if (!governance || presentation === "editable") return <>{children}</>;
  if (presentation === "superseded") {
    return (
      <div className={cn("min-w-0 space-y-1.5", className)} data-governed="superseded">
        <fieldset disabled className="m-0 min-w-0 border-0 p-0 [&_input]:bg-muted/30">
          {children}
        </fieldset>
        <p className="text-xs text-muted-foreground text-pretty">
          Superseded by the approved original baseline (BL0) · dates change only through the Working Plan and a
          re-baseline.
        </p>
      </div>
    );
  }

  const pending = governance.pending.get(fieldKey);
  const amendable = Boolean(amendableField(fieldKey));
  const governed = presentation === "request";

  return (
    <div className={cn("min-w-0 space-y-1.5", className)} data-governed={presentation}>
      <fieldset disabled className="m-0 min-w-0 border-0 p-0 [&_input]:bg-muted/30">
        {children}
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {pending ? (
          <StatusBadge tone="warning">Amendment pending approval</StatusBadge>
        ) : (
          <span>{governed ? "Controlled · changes need approval" : "Controlled · change with a reason"}</span>
        )}
        <SetupChangeHelp governed={governed} />
        {amendable && governance.canAmend && !pending && (
          <button
            type="button"
            onClick={() => governance.onAmend(fieldKey)}
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
          >
            <PencilLine className="size-3" aria-hidden="true" />
            {governed ? "Request amendment" : "Amend"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 13.11 UAT: what "Request amendment" and "Amend" mean on a controlled field.
 * Wording only — the database decides who may approve.
 */
export function SetupChangeHelp({ governed }: { governed: boolean }) {
  return governed ? (
    <ContextHelp topic="governed fields">
      <p>
        Governed field — even administrators require independent approval after
        Project Setup is controlled.
      </p>
      <p>
        <strong>Request amendment</strong> records the change with a reason and
        its impact. It applies only when a different Project Control Admin or a
        System Administrator approves it; nobody approves their own request.
      </p>
    </ContextHelp>
  ) : (
    <ContextHelp topic="controlled fields">
      <p>
        <strong>Amend</strong> is a lighter controlled change: it applies at
        once, and the reason is kept in the change history.
      </p>
    </ContextHelp>
  );
}

/* --------------------------------- banner --------------------------------- */

export function ControlledSetupBanner({
  controlledSince,
  anchor,
  pendingCount,
}: {
  controlledSince: string;
  anchor: "snapshot" | "finalisation";
  pendingCount: number;
}) {
  return (
    <section
      aria-label="Project Setup control"
      className="flex flex-wrap items-start gap-3 rounded-xl border border-info/25 bg-info/[0.06] px-4 py-3"
    >
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold">Project Setup is controlled.</p>
        <p className="text-xs text-muted-foreground text-pretty">
          Core configuration changes require an amendment. Team, contacts, location,
          branding and lifecycle fields still save directly and are recorded in
          Project History. Controlled since {formatDate(controlledSince)} —{" "}
          {anchor === "snapshot" ? "the first Published Planning Snapshot" : "Setup Finalisation"}.
        </p>
      </div>
      {pendingCount > 0 && (
        <StatusBadge tone="warning">
          {pendingCount} amendment{pendingCount === 1 ? "" : "s"} pending
        </StatusBadge>
      )}
    </section>
  );
}

/* ------------------------------ amend dialog ------------------------------ */

export function useSetupValueLookups(): SetupValueLookups {
  const { records: clients } = useMasterData("client");
  const { records: categories } = useMasterData("projectType");
  return React.useMemo(
    () => ({
      clientName: (id: string) => (clients as Client[]).find((client) => client.id === id)?.name,
      categoryName: (id: string) => (categories as ProjectType[]).find((category) => category.id === id)?.name,
      formatDate,
    }),
    [clients, categories]
  );
}

/**
 * The one Amend / Request amendment dialog (`07` §10.12). It reads the
 * authoritative current value when it opens and sends that back as the base,
 * so a change made meanwhile is refused instead of overwritten.
 */
export function AmendSetupDialog({
  projectId,
  projectCode,
  fieldKey,
  onClose,
  onSubmitted,
}: {
  projectId: string;
  /** For the confirmation toast ("code · subject"). */
  projectCode?: string;
  /** The field to amend; null closes the dialog. */
  fieldKey: string | null;
  onClose: () => void;
  /** Called with the stored amendment (applied for lightweight, pending for governed). */
  onSubmitted: (amendment: SetupAmendment) => void;
}) {
  return (
    <Dialog open={fieldKey !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {fieldKey && (
          <AmendSetupBody projectId={projectId} projectCode={projectCode} fieldKey={fieldKey} onClose={onClose} onSubmitted={onSubmitted} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AmendSetupBody({
  projectId,
  projectCode,
  fieldKey,
  onClose,
  onSubmitted,
}: {
  projectId: string;
  projectCode?: string;
  fieldKey: string;
  onClose: () => void;
  onSubmitted: (amendment: SetupAmendment) => void;
}) {
  const field = amendableField(fieldKey);
  const lookups = useSetupValueLookups();
  const { records: clientRecords } = useMasterData("client");
  const { records: categoryRecords } = useMasterData("projectType");
  const [current, setCurrent] = React.useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const reasonId = React.useId();
  const valueId = React.useId();

  React.useEffect(() => {
    let cancelled = false;
    setupGovernanceService
      .getFieldValue(projectId, fieldKey)
      .then((value) => {
        if (cancelled) return;
        setCurrent(value);
        setDraft(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "The current value could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, fieldKey]);

  if (!field) return null;
  const { entry, ui } = field;
  const governed = entry.fieldClass === "governed";
  const categories = (categoryRecords as ProjectType[]).filter((category) => category.active && isOtherProjectCategory(category));
  const allowsCustomName = (id: string) =>
    Boolean((categoryRecords as ProjectType[]).find((category) => category.id === id)?.allowsCustomName);
  const proposed = proposedColumnValue(fieldKey, draft, { categoryAllowsCustomName: allowsCustomName });
  const unchanged = current ? sameColumnValue(proposed, current) : true;
  const column = entry.targetColumns[0];
  const set = (key: string, value: unknown) => setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = async () => {
    if (!current || unchanged || !reason.trim()) return;
    setSaving(true);
    try {
      const amendment = await setupGovernanceService.requestAmendment({
        projectId,
        fieldKey,
        expectedValue: current,
        proposedValue: proposed,
        reason: reason.trim(),
      });
      // 13.11 UAT: the one compact toast; the record carries the detail.
      const { title, context, tone } = compactAmendmentToast(
        amendment.status === "applied" ? "applied" : "submitted",
        { projectCode, amendment }
      );
      showCompactToast({ title, context, tone, duration: CONFIRMATION_TOAST_DURATION_MS });
      onSubmitted(amendment);
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The amendment could not be submitted.");
    } finally {
      setSaving(false);
    }
  };

  const valueInput = (() => {
    switch (ui.input.kind) {
      case "text":
        return (
          <Input id={valueId} value={String(draft[column] ?? "")} maxLength={ui.input.maxLength}
            onChange={(event) => set(column, event.target.value)} />
        );
      case "date":
        return (
          <Input id={valueId} type="date" className="max-w-48" value={String(draft[column] ?? "")}
            onChange={(event) => set(column, event.target.value)} />
        );
      case "number":
        return (
          <Input id={valueId} type="number" className="max-w-32" min={ui.input.min} max={ui.input.max}
            value={draft[column] === null || draft[column] === undefined ? "" : String(draft[column])}
            onChange={(event) => set(column, event.target.value === "" ? null : Number(event.target.value))} />
        );
      case "switch":
        return (
          <div className="flex items-center gap-2">
            <Switch id={valueId} checked={draft[column] === true} onCheckedChange={(checked) => set(column, checked)} />
            <span className="text-sm">{draft[column] === true ? "Enabled" : "Disabled"}</span>
          </div>
        );
      case "select":
        return (
          <Select value={String(draft[column] ?? "")} onValueChange={(value) => set(column, value)}>
            <SelectTrigger id={valueId} className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>
              {ui.input.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "client":
        return (
          <Select value={String(draft[column] ?? "")} onValueChange={(value) => set(column, value)}>
            <SelectTrigger id={valueId} className="w-full"><SelectValue placeholder="Choose a client…" /></SelectTrigger>
            <SelectContent>
              {(clientRecords as Client[]).filter((client) => client.active || client.id === current?.[column]).map((client) => (
                <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "category": {
        const categoryId = String(draft.project_type_id ?? "");
        return (
          <div className="space-y-2">
            <Select value={categoryId} onValueChange={(value) => set("project_type_id", value)}>
              <SelectTrigger id={valueId} className="w-full"><SelectValue placeholder="Choose a Project Category…" /></SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categoryId && allowsCustomName(categoryId) && (
              <Input aria-label="Category name" placeholder="Specify the category name"
                value={String(draft.project_category_detail ?? "")}
                onChange={(event) => set("project_category_detail", event.target.value)} />
            )}
          </div>
        );
      }
    }
  })();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{governed ? "Request amendment" : "Amend Project Setup"}</DialogTitle>
        <DialogDescription>
          {governed
            ? "This field is governed. Your request is reviewed by another Project Control Admin or System Administrator; nothing changes until it is approved."
            : "Project Setup is controlled. This change applies immediately and is recorded with your reason."}
        </DialogDescription>
      </DialogHeader>

      {loadError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {loadError}
        </p>
      ) : !current ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Reading the current value…
        </p>
      ) : (
        <div className="space-y-4">
          <dl className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Field</dt>
            <dd className="font-medium">{entry.label}</dd>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current value</dt>
            <dd>{formatSetupValue(fieldKey, current, lookups)}</dd>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Class</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={governed ? "warning" : "info"}>{governed ? "Governed" : "Lightweight"}</StatusBadge>
              <span className="text-xs text-muted-foreground">{governed ? "Requires approval" : "Applies immediately"}</span>
            </dd>
          </dl>

          <Field>
            <FieldLabel htmlFor={valueId}>Proposed value</FieldLabel>
            {valueInput}
            {unchanged && <FieldDescription>Change the value to continue.</FieldDescription>}
          </Field>

          <Field>
            <FieldLabel htmlFor={reasonId}>
              Reason <span className="text-destructive" aria-hidden="true">*</span>
            </FieldLabel>
            <Textarea id={reasonId} aria-required rows={3} maxLength={1000} value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this change is needed" />
          </Field>

          <div className="rounded-lg border border-warning/30 bg-warning/[0.07] p-3 text-xs text-pretty">
            <p className="font-medium text-foreground">Impact</p>
            <p className="mt-0.5 text-muted-foreground">{entry.impactWarning}</p>
            {governed && (
              <p className="mt-1.5 text-muted-foreground">
                You cannot approve your own request. Another Project Control Admin or System Administrator decides it.
              </p>
            )}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="button" onClick={() => void submit()}
          disabled={saving || !current || unchanged || !reason.trim()}>
          {saving && <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {governed ? "Submit for approval" : "Apply amendment"}
        </Button>
      </DialogFooter>
    </>
  );
}
