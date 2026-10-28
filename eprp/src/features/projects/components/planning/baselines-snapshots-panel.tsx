"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, CheckCircle2, History, Rocket, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ConfirmDialog, EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { useNotificationsIfAvailable } from "@/features/notifications/provider";
import {
  setupGovernanceService,
  type SetupControlState,
} from "@/services/setup-governance-service";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { getContactById, useMasterData } from "@/features/master-data";
import { planningService } from "@/services/planning-service";
import type {
  PlanningBaseline,
  PlanningOpeningPosition,
  PlanningSnapshot,
  Project,
  ProjectPlanningSettings,
} from "@/types";
import {
  preparePlanningPublish,
  publishPlanningSnapshotV2,
  requestPlanningBaseline,
} from "../../planning-publish/actions";
import { isStalePublishRefusal, type PublishContext } from "../../planning-publish/publish-context";
import type { PublishProblem } from "../../planning-publish/publish-plan";
import { SCHEDULE_CONDITION_NOT_EVALUATED, snapshotCalculationLabel } from "../../planning-experience";
import { OpeningPositionDialog } from "./opening-position-dialog";
import { useReturnRefresh } from "../../use-return-refresh";

const NONE = "none";

function activityCountOf(snapshot: PlanningSnapshot): number | undefined {
  const data = snapshot.snapshotData;
  if (data && typeof data === "object" && "activities" in data) {
    const activities = (data as { activities?: unknown }).activities;
    if (Array.isArray(activities)) return activities.length;
  }
  return undefined;
}

/** 13.9B: the first-anchor confirmation, word for word (`07` §10.12). */
export const FIRST_ANCHOR_CONFIRMATION =
  "Publishing the first governed Planning Snapshot will make Project Setup Controlled. " +
  "Core Project Setup configuration will require amendments afterward.";

/** 13.12: approving the original baseline is a governance anchor too. */
export const BL0_ANCHOR_CONFIRMATION =
  "Approving the original baseline (BL0) will make Project Setup Controlled. " +
  "Core Project Setup configuration will require amendments afterward.";

const REVISION_STATUS: Record<PlanningBaseline["revisionStatus"], { label: string; tone: "info" | "success" | "warning" | "neutral" | "danger" }> = {
  requested: { label: "Awaiting decision", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  legacy: { label: "Legacy capture — not an approved baseline", tone: "neutral" },
};

function contactName(id: string | undefined): string {
  return (id && getContactById(id)?.name) || "Project Control";
}

function figure(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? "N/A" : value.toFixed(digits);
}

/** The latest approved revision is BLn; revision 0 is BL0. Derived, never flagged. */
function approvedBaselines(baselines: readonly PlanningBaseline[]) {
  const approved = baselines
    .filter((baseline) => baseline.revisionStatus === "approved")
    .sort((a, b) => (a.revisionNumber ?? 0) - (b.revisionNumber ?? 0));
  return { bl0: approved.find((baseline) => baseline.revisionNumber === 0), bln: approved.at(-1) };
}

/** 13.12 closure polish: one bordered list with hairline dividers — a ledger, not a stack of cards. */
const LEDGER = "divide-y overflow-hidden rounded-lg border bg-card";
/** The quiet small-caps label used for planning figures across the workspace. */
const FIGURE_LABEL = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

function ProblemList({ problems }: { problems: PublishProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
      {problems.map((problem, index) => (
        <li key={`${problem.code}-${index}`} className="text-pretty">{problem.message}</li>
      ))}
    </ul>
  );
}

/**
 * Baselines & Snapshots — and, since 13.9A, the ONLY place an Opening
 * Position is declared or promoted (Project Setup no longer offers it).
 *
 * 13.12 (`docs/02` §26.25):
 * - **Baseline Revisions.** Project Control requests BL0 or a re-baseline
 *   (captured with its engine-calculated curve); another Project Control
 *   Admin or System Administrator approves or rejects it — never the
 *   requester. BL0 / BLn are derived from the approved revisions.
 * - **Publish is v2.** The Planning Engine runs on the server and the
 *   trusted writer freezes the result; this panel sends only the Data Date
 *   (or import batch), a label and the confirmation. An Opening Position
 *   promotion is unchanged.
 *
 * 13.9B: the FIRST governed anchor (the project is not yet Controlled) asks
 * for explicit confirmation before `confirmSetupControl` is sent; later
 * snapshots do not. A no-formal-schedule project offers neither Publish nor
 * Promote nor a baseline — the database refuses all of them.
 */
export function BaselinesSnapshotsPanel({
  project,
  canManage,
  onChanged,
}: {
  project: Project;
  canManage: boolean;
  /** Told after a publish / baseline / Opening Position change, so the workspace header refreshes. */
  onChanged?: () => void;
}) {
  const identity = useCurrentIdentity();
  const notifications = useNotificationsIfAvailable();
  const [snapshots, setSnapshots] = React.useState<PlanningSnapshot[] | undefined>();
  const [baselines, setBaselines] = React.useState<PlanningBaseline[] | undefined>();
  const [settings, setSettings] = React.useState<ProjectPlanningSettings | null | undefined>();
  const [openingPosition, setOpeningPosition] = React.useState<
    PlanningOpeningPosition | null | undefined
  >();
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [deciding, setDeciding] = React.useState<{ baseline: PlanningBaseline; decision: "approve" | "reject" } | null>(null);
  const [withdrawing, setWithdrawing] = React.useState<PlanningBaseline | null>(null);
  const [openingFormOpen, setOpeningFormOpen] = React.useState(false);
  const [control, setControl] = React.useState<SetupControlState | undefined>();
  const [promoteConfirmOpen, setPromoteConfirmOpen] = React.useState(false);
  useMasterData("contact");
  // 13.12: a notification deep link (?baseline=<id>) focuses that request.
  // Read once; the panel renders its loading state first, so the server and
  // client first renders agree.
  const [focusId] = React.useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("baseline")
  );

  const load = React.useCallback(() => {
    void planningService.listSnapshots(project.id).then(setSnapshots);
    void planningService.listBaselines(project.id).then(setBaselines);
    void planningService.getSettings(project.id).then(setSettings);
    void planningService.getDraftOpeningPosition(project.id).then(setOpeningPosition);
    void setupGovernanceService.getControlState(project.id).then(setControl).catch(() => setControl(undefined));
  }, [project.id]);

  // 13.11 UAT: re-read on return to the tab (a Planning Approach approved elsewhere).
  const returned = useReturnRefresh();
  React.useEffect(() => load(), [load, returned]);

  if (snapshots === undefined || settings === undefined || openingPosition === undefined) {
    return <LoadingState variant="table" label="Loading snapshots…" />;
  }

  const needsOpening =
    settings?.onboardingMode === "existing_active_project" && snapshots.length === 0;
  const noFormalSchedule = settings?.onboardingMode === "no_formal_schedule";
  // Unknown control state is treated as "first anchor": asking once too often
  // is harmless, publishing without the confirmation is refused anyway.
  const firstAnchor = !control?.controlledSince;
  const revisions = baselines ?? [];
  const { bl0, bln } = approvedBaselines(revisions);
  const pending = revisions.find((baseline) => baseline.revisionStatus === "requested");

  const changed = () => {
    load();
    onChanged?.();
    // 13.12: a request / decision / withdrawal changes approvers' and the requester's
    // inbox; refresh this tab's bell now (other tabs catch up on return / focus).
    void notifications?.refresh();
  };

  const promoteOpening = async (confirmed: boolean) => {
    if (!openingPosition) return;
    try {
      const id = await planningService.publishSnapshot({
        projectId: project.id,
        openingPositionId: openingPosition.id,
        confirmSetupControl: confirmed,
      });
      toast.success(`Opening Position promoted as Snapshot V1 (${id.slice(0, 8)}).`);
      changed();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not promote the Opening Position.");
    }
  };

  return (
    <div className="space-y-5">
      {needsOpening && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm font-medium">Opening Position needed</p>
          <p className="text-xs text-muted-foreground text-pretty">
            This project is onboarded mid-execution. Do not invent historical
            S-curve data — declare one honest starting position as of a data
            date instead of a fabricated from-zero history.
          </p>
          {openingPosition ? (
            <div className="mt-2 space-y-2 text-xs">
              <p>
                Draft as of {formatDate(openingPosition.dataDate)} · Planned{" "}
                {openingPosition.plannedProgressPercent ?? "—"}% · Actual{" "}
                {openingPosition.actualProgressPercent ?? "—"}% · Source: {openingPosition.source}
              </p>
              {canManage && (
                <Button size="sm" onClick={() => (firstAnchor ? setPromoteConfirmOpen(true) : void promoteOpening(false))}>
                  <Rocket data-icon="inline-start" aria-hidden="true" />
                  Promote as Snapshot V1
                </Button>
              )}
            </div>
          ) : (
            canManage && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpeningFormOpen(true)}>
                Declare Opening Position
              </Button>
            )
          )}
        </div>
      )}

      {noFormalSchedule && (
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground text-pretty">
          This project is planned without a formal schedule, so it has no baselines, no Planning Snapshot is
          published and no Opening Position is promoted. Its progress is Reported — not planning governed. To bring
          it under planning control, change how it is planned in Project Setup (an approved amendment once Setup is
          controlled).
        </div>
      )}

      {/* ----------------------------- Baselines ----------------------------- */}
      <section className="space-y-2" aria-labelledby="baseline-revisions">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="baseline-revisions" className="text-sm font-semibold">Baselines</h3>
            <p className="text-xs text-muted-foreground text-pretty">
              {bl0
                ? `Original baseline BL0 · current approved baseline BL${bln?.revisionNumber ?? 0}. PV and SPI are measured against BL${bln?.revisionNumber ?? 0}.`
                : "No approved baseline yet. A snapshot is published only against an approved original baseline (BL0)."}
            </p>
          </div>
          {canManage && !noFormalSchedule && !pending && (
            <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}>
              {bl0 ? "Request re-baseline" : "Request BL0"}
            </Button>
          )}
        </div>
        {revisions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No baselines yet.</p>
        ) : (
          <ul className={LEDGER}>
            {revisions.map((baseline) => {
              const status = REVISION_STATUS[baseline.revisionStatus];
              const own = Boolean(identity.profileId) && baseline.requestedByUserId === identity.profileId;
              const canDecide =
                baseline.revisionStatus === "requested" && identity.isGlobalAuthority && !own;
              const canWithdraw = baseline.revisionStatus === "requested" && own;
              return (
                <li
                  key={baseline.id}
                  id={`baseline-${baseline.id}`}
                  data-focused={baseline.id === focusId ? "true" : undefined}
                  ref={baseline.id === focusId ? (node) => node?.scrollIntoView({ block: "center" }) : undefined}
                  className={cn(
                    "space-y-1 px-3 py-2.5 text-xs",
                    baseline.id === focusId && "bg-primary/5 ring-2 ring-inset ring-primary/40"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {baseline.revisionStatus === "approved"
                          ? `BL${baseline.revisionNumber}${baseline.revisionKind === "original" ? " — original" : " — re-baseline"}`
                          : baseline.revisionStatus === "legacy"
                            ? baseline.name
                            : "Baseline request"}
                      </span>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </div>
                    {(canDecide || canWithdraw) && (
                      <div className="flex flex-wrap gap-2">
                        {canDecide && (
                          <>
                            <Button size="sm" onClick={() => setDeciding({ baseline, decision: "approve" })}>
                              <Check data-icon="inline-start" aria-hidden="true" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setDeciding({ baseline, decision: "reject" })}>
                              <X data-icon="inline-start" aria-hidden="true" /> Reject
                            </Button>
                          </>
                        )}
                        {canWithdraw && (
                          <Button size="sm" variant="ghost" onClick={() => setWithdrawing(baseline)}>
                            <Undo2 data-icon="inline-start" aria-hidden="true" /> Withdraw
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {baseline.revisionStatus === "legacy" ? (
                    <p className="text-muted-foreground tabular-nums">Captured {formatDate(baseline.baselineDate)} · before 13.12</p>
                  ) : (
                    <>
                      {baseline.reason && <p className="text-pretty"><span className="text-muted-foreground">Reason: </span>{baseline.reason}</p>}
                      <p className="text-muted-foreground tabular-nums">
                        Requested by {own ? "you" : contactName(baseline.requestedByContactId)}
                        {baseline.requestedAt && ` · ${formatDateTime(baseline.requestedAt)}`}
                        {baseline.capture && ` · ${baseline.capture.activities.length} activities captured`}
                        {baseline.decidedAt && baseline.revisionStatus !== "withdrawn" && (
                          <>
                            {" · "}
                            {status.label} by {contactName(baseline.decidedByContactId)} · {formatDateTime(baseline.decidedAt)}
                          </>
                        )}
                      </p>
                      {baseline.decisionComment && (
                        <p className="text-pretty"><span className="text-muted-foreground">Decision note: </span>{baseline.decisionComment}</p>
                      )}
                      {baseline.revisionStatus === "requested" && own && (
                        <p className="text-muted-foreground">You cannot approve your own baseline request.</p>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ----------------------------- Snapshots ----------------------------- */}
      <section className="space-y-2" aria-labelledby="published-snapshots">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="published-snapshots" className="text-sm font-semibold">Published Snapshots</h3>
          {canManage && !needsOpening && !noFormalSchedule && (
            <Button
              size="sm"
              onClick={() => setPublishOpen(true)}
              disabled={!bl0}
              title={bl0 ? undefined : "Approve the original baseline (BL0) first"}
            >
              <Rocket data-icon="inline-start" aria-hidden="true" />
              Publish Snapshot
            </Button>
          )}
        </div>

        {snapshots.length === 0 ? (
          <EmptyState
            icon={History}
            title="No snapshots published yet"
            description="The Published Planning Snapshot becomes the source of truth Weekly and Monthly report against."
            className="py-8"
          />
        ) : (
          <ul className={LEDGER}>
            {snapshots.map((snapshot) => {
              const calculation = snapshotCalculationLabel(snapshot);
              const v2 = snapshot.v2;
              return (
                <li key={snapshot.id} className="space-y-1.5 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      v{snapshot.version}
                      {snapshot.label ? ` — ${snapshot.label}` : ""}
                    </span>
                    <span title={calculation.hint} className="inline-flex">
                      <StatusBadge tone={calculation.tone}>{calculation.badge}</StatusBadge>
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {snapshot.dataDate ? `Data Date ${formatDate(snapshot.dataDate)} · ` : ""}
                    Published {formatDateTime(snapshot.publishedAt)}
                    {snapshot.publishedByContactId && ` by ${contactName(snapshot.publishedByContactId)}`}
                    {activityCountOf(snapshot) !== undefined && ` · ${activityCountOf(snapshot)} activities`}
                  </p>
                  {v2 && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
                      <div><dt className={FIGURE_LABEL}>PV</dt><dd className="font-medium tabular-nums">{figure(v2.pv, 3)}%</dd></div>
                      <div><dt className={FIGURE_LABEL}>EV</dt><dd className="font-medium tabular-nums">{figure(v2.ev, 3)}%</dd></div>
                      <div><dt className={FIGURE_LABEL}>SV</dt><dd className="font-medium tabular-nums">{figure(v2.sv, 3)} pts</dd></div>
                      <div><dt className={FIGURE_LABEL}>SPI</dt><dd className="font-medium tabular-nums">{figure(v2.spi)}</dd></div>
                      <div>
                        <dt className={FIGURE_LABEL}>Baselines</dt>
                        <dd className="tabular-nums">
                          BL0 · BL{revisions.find((baseline) => baseline.id === v2.blnBaselineId)?.revisionNumber ?? "?"}
                        </dd>
                      </div>
                      <div className="col-span-2 sm:col-span-5">
                        <dt className="sr-only">Schedule condition</dt>
                        <dd className="text-muted-foreground">Schedule condition: {SCHEDULE_CONDITION_NOT_EVALUATED}</dd>
                      </div>
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {openingFormOpen && (
        <OpeningPositionDialog
          projectId={project.id}
          onClose={() => setOpeningFormOpen(false)}
          onSaved={() => {
            setOpeningFormOpen(false);
            changed();
          }}
        />
      )}

      <ConfirmDialog
        open={promoteConfirmOpen}
        onOpenChange={setPromoteConfirmOpen}
        title="Promote the Opening Position as Snapshot V1?"
        description={FIRST_ANCHOR_CONFIRMATION}
        confirmLabel="Promote and control Setup"
        onConfirm={() => promoteOpening(true)}
      />

      {publishOpen && (
        <PublishSnapshotDialog
          project={project}
          firstAnchor={firstAnchor}
          blnNumber={bln?.revisionNumber ?? 0}
          onClose={() => setPublishOpen(false)}
          onPublished={changed}
        />
      )}

      {requestOpen && (
        <RequestBaselineDialog
          projectId={project.id}
          original={!bl0}
          onClose={() => setRequestOpen(false)}
          onRequested={() => {
            setRequestOpen(false);
            changed();
          }}
        />
      )}

      {deciding && (
        <DecideBaselineDialog
          baseline={deciding.baseline}
          decision={deciding.decision}
          firstAnchor={firstAnchor && !bl0}
          onClose={() => setDeciding(null)}
          onDecided={() => {
            setDeciding(null);
            changed();
          }}
        />
      )}

      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(open) => !open && setWithdrawing(null)}
        title="Withdraw this baseline request?"
        description="The request is closed without a decision. Nothing is baselined, and the request stays in the record."
        confirmLabel="Withdraw request"
        onConfirm={async () => {
          if (!withdrawing) return;
          try {
            await planningService.withdrawBaseline(withdrawing.id);
            toast.success("Baseline request withdrawn.");
            setWithdrawing(null);
            changed();
          } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : "The request could not be withdrawn.");
            throw cause;
          }
        }}
      />
    </div>
  );
}

/* ------------------------------ Request baseline --------------------------- */

function RequestBaselineDialog({
  projectId,
  original,
  onClose,
  onRequested,
}: {
  projectId: string;
  /** No approved BL0 yet: this request is for the original baseline. */
  original: boolean;
  onClose: () => void;
  onRequested: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [problems, setProblems] = React.useState<PublishProblem[]>([]);
  const reasonId = React.useId();

  const submit = async () => {
    setSaving(true);
    setProblems([]);
    try {
      const result = await requestPlanningBaseline({ projectId, reason });
      if (!result.ok) {
        setProblems(result.problems);
        return;
      }
      toast.success(original ? "BL0 requested — awaiting approval." : "Re-baseline requested — awaiting approval.");
      onRequested();
    } catch {
      setProblems([{ code: "UNEXPECTED", message: "The baseline could not be requested. Please try again." }]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{original ? "Request the original baseline (BL0)" : "Request a re-baseline"}</DialogTitle>
          <DialogDescription className="text-pretty">
            The current dates and local weights of every active node and activity are captured now, with their
            baseline curve, and never change afterwards. Another Project Control Admin or System Administrator
            approves it — you cannot approve your own request.
            {!original && " A re-baseline never changes a published snapshot; only later snapshots measure against it."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={reasonId}>
            Reason <span className="text-destructive" aria-hidden="true">*</span>
          </Label>
          <Textarea id={reasonId} rows={3} value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder={original ? "e.g. Contract schedule agreed with the client" : "e.g. Approved scope change CR-12"} />
        </div>
        <ProblemList problems={problems} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !reason.trim()}>
            {saving ? "Requesting…" : "Request baseline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Decide baseline ---------------------------- */

function DecideBaselineDialog({
  baseline,
  decision,
  firstAnchor,
  onClose,
  onDecided,
}: {
  baseline: PlanningBaseline;
  decision: "approve" | "reject";
  /** Approving this BL0 creates the project's first governance anchor. */
  firstAnchor: boolean;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [comment, setComment] = React.useState("");
  const [anchorConfirmed, setAnchorConfirmed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const commentId = React.useId();
  const anchorId = React.useId();
  const approve = decision === "approve";

  const submit = async () => {
    setSaving(true);
    try {
      await planningService.decideBaseline({
        baselineId: baseline.id,
        decision,
        comment,
        // Only an explicit confirmation by the approver, only for the first anchor.
        confirmSetupControl: firstAnchor && anchorConfirmed,
      });
      toast.success(approve ? "Baseline approved." : "Baseline request rejected.");
      onDecided();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The decision could not be recorded.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{approve ? "Approve this baseline request?" : "Reject this baseline request?"}</DialogTitle>
          <DialogDescription className="text-pretty">
            {approve
              ? "It becomes the next Baseline Revision (BL0 if none is approved yet) exactly as captured. An approved baseline never changes."
              : "Nothing is baselined. The requester sees your comment."}
          </DialogDescription>
        </DialogHeader>
        {baseline.reason && (
          <p className="text-sm text-pretty"><span className="text-muted-foreground">Reason: </span>{baseline.reason}</p>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor={commentId}>
            Comment{!approve && <span className="text-destructive" aria-hidden="true"> *</span>}
          </Label>
          <Textarea id={commentId} rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
        </div>
        {approve && firstAnchor && (
          <div className="flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/[0.06] p-3">
            <Checkbox
              id={anchorId}
              checked={anchorConfirmed}
              onCheckedChange={(checked) => setAnchorConfirmed(checked === true)}
              className="mt-0.5"
            />
            <label htmlFor={anchorId} className="text-sm leading-snug text-pretty">
              {BL0_ANCHOR_CONFIRMATION}
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant={approve ? "default" : "destructive"}
            onClick={() => void submit()}
            disabled={saving || (!approve && !comment.trim()) || (approve && firstAnchor && !anchorConfirmed)}
          >
            {saving ? "Saving…" : approve ? "Approve baseline" : "Reject request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Publish (v2) ------------------------------- */

function PublishSnapshotDialog({
  project,
  firstAnchor,
  blnNumber,
  onClose,
  onPublished,
}: {
  project: Project;
  /** 13.9B: this publish creates the first governance anchor. */
  firstAnchor: boolean;
  blnNumber: number;
  onClose: () => void;
  onPublished: () => void;
}) {
  // The publish context this dialog is prepared against (13.12 UAT): read
  // once on open; a Publish after the Working Plan moved is refused, and
  // only reopening the dialog prepares against the latest plan.
  const [context, setContext] = React.useState<PublishContext | null>(null);
  const [preparing, setPreparing] = React.useState(true);
  const [stale, setStale] = React.useState(false);
  const [batchId, setBatchId] = React.useState<string>(NONE);
  const [label, setLabel] = React.useState("");
  const [manualDataDate, setManualDataDate] = React.useState("");
  const [publishing, setPublishing] = React.useState(false);
  const [problems, setProblems] = React.useState<PublishProblem[]>([]);
  const [published, setPublished] = React.useState<{ version: number | null; pv: number; ev: number; spi: number | null } | null>(null);
  const [anchorConfirmed, setAnchorConfirmed] = React.useState(false);
  const anchorId = React.useId();

  React.useEffect(() => {
    let cancelled = false;
    void preparePlanningPublish({ projectId: project.id })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setContext(result.value);
        else setProblems(result.problems);
      })
      .catch((cause: unknown) => {
        // The user sees a plain sentence; the real cause goes to the console / dev log.
        console.error("[EPRP publish] preparing the publish failed", cause);
        if (!cancelled) setProblems([{ code: "UNEXPECTED", message: "The Working Plan could not be read. Close this and try again." }]);
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const batches = context?.sources ?? [];
  const isManual = batchId === NONE;
  const selectedBatch = batches.find((b) => b.batchId === batchId);

  const publish = async () => {
    if (!context) return;
    setPublishing(true);
    setProblems([]);
    try {
      const result = await publishPlanningSnapshotV2({
        projectId: project.id,
        context,
        dataDate: isManual ? manualDataDate : null,
        sourceImportBatchId: isManual ? null : batchId,
        label: label.trim() || null,
        // Only an explicit confirmation by the user, only for the first anchor.
        confirmSetupControl: firstAnchor && anchorConfirmed,
      });
      if (!result.ok) {
        setProblems(result.problems);
        setStale(isStalePublishRefusal(result.problems));
        return;
      }
      setPublished({
        version: result.value.version,
        pv: result.value.summary.pv,
        ev: result.value.summary.ev,
        spi: result.value.summary.spi,
      });
      toast.success("Planning Snapshot published.");
      onPublished();
    } catch (cause) {
      console.error("[EPRP publish] publishing failed", cause);
      setProblems([{ code: "UNEXPECTED", message: "The snapshot could not be published. Nothing was changed — please try again." }]);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish Planning Snapshot</DialogTitle>
          <DialogDescription className="text-pretty">
            The Planning Engine calculates PV, EV, SV and SPI from the Working Plan against BL{blnNumber}, once, for
            the Data Date; the result is frozen as one immutable, versioned snapshot. Nothing is typed in.
          </DialogDescription>
        </DialogHeader>

        {published ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-8 text-success" aria-hidden="true" />
            <p className="text-sm font-medium">Snapshot v{published.version ?? "—"} published.</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              PV {published.pv.toFixed(3)}% · EV {published.ev.toFixed(3)}% · SPI {figure(published.spi)}
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pub-batch">Source import batch (optional)</Label>
                <Select value={batchId} onValueChange={setBatchId}>
                  <SelectTrigger id="pub-batch" className="w-full min-w-0">
                    <SelectValue placeholder="Manual / current Master Plan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Manual / current Master Plan</SelectItem>
                    {batches.map((batch) => (
                      <SelectItem key={batch.batchId} value={batch.batchId}>
                        {batch.fileName ?? batch.sourceType} · {batch.rowCount} rows
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isManual && (
                <div className="grid gap-1.5">
                  <Label htmlFor="pub-data-date">
                    Data Date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="pub-data-date"
                    type="date"
                    value={manualDataDate}
                    onChange={(e) => setManualDataDate(e.target.value)}
                    className="max-w-48"
                  />
                  <p className="text-xs text-muted-foreground text-pretty">
                    The schedule position this snapshot reports as of —
                    required when publishing manually. An import batch
                    already carries its own Data Date.
                  </p>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="pub-label">Label (optional)</Label>
                <Input id="pub-label" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1 rounded-lg border bg-muted/20 p-3 text-xs">
              <p className="font-medium">Before you publish</p>
              <p>Source: {selectedBatch ? selectedBatch.sourceType : "Manual / current Master Plan"}</p>
              <p>
                Data Date:{" "}
                {selectedBatch
                  ? (selectedBatch.dataDate ?? "missing — this batch cannot be published")
                  : (manualDataDate || "required — enter one above")}
              </p>
              <p>Measured against: BL{blnNumber} (the current approved baseline)</p>
              <p>
                Project Setup:{" "}
                {firstAnchor
                  ? "not yet controlled — this first governed snapshot makes it controlled"
                  : "controlled"}
              </p>
              <p className="text-muted-foreground">
                Every check runs again on the server: weights, progress, Data Date, the baselines, and that the
                Working Plan has not changed since this dialog opened.
              </p>
            </div>

            {firstAnchor && (
              <div className="flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/[0.06] p-3">
                <Checkbox
                  id={anchorId}
                  checked={anchorConfirmed}
                  onCheckedChange={(checked) => setAnchorConfirmed(checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor={anchorId} className="text-sm leading-snug text-pretty">
                  <span className="font-medium">This is the first governed Planning Snapshot.</span>{" "}
                  {FIRST_ANCHOR_CONFIRMATION}
                </label>
              </div>
            )}

            <ProblemList problems={problems} />
          </>
        )}

        <DialogFooter>
          {published ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={publishing}>
                Cancel
              </Button>
              <Button
                onClick={() => void publish()}
                disabled={
                  publishing ||
                  preparing ||
                  !context ||
                  stale ||
                  (firstAnchor && !anchorConfirmed) ||
                  (isManual ? !manualDataDate : !selectedBatch?.dataDate)
                }
                title={
                  stale
                    ? "Close this and open Publish Snapshot again"
                    : firstAnchor && !anchorConfirmed
                    ? "Confirm that Project Setup becomes controlled first"
                    : isManual && !manualDataDate
                    ? "Enter a Data Date first"
                    : !isManual && !selectedBatch?.dataDate
                      ? "This import batch has no Data Date — re-import or contact Project Control"
                      : undefined
                }
              >
                {publishing ? "Publishing…" : preparing ? "Preparing…" : "Publish Snapshot"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
