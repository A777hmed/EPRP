"use client";

import * as React from "react";
import { ArrowRight, Check, ChevronDown, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog, SectionCard, StatusBadge } from "@/components/shared";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { setupGovernanceService } from "@/services/setup-governance-service";
import {
  AMENDMENT_STATUS_LABEL,
  AMENDMENT_STATUS_TONE,
  amendmentDisplayStatus,
  canDecideAmendment,
  canWithdrawAmendment,
  formatSetupValue,
  isOwnAmendment,
  type AmendmentViewer,
  type SetupAmendment,
} from "../../setup-amendments";
import { amendmentWording, isStructureAmendment } from "../../structure-amendments";
import { useSetupValueLookups } from "./setup-governance-ui";
import { compactAmendmentToast, type AmendmentToastEvent } from "../../amendment-toast";
import { CONFIRMATION_TOAST_DURATION_MS, showCompactToast } from "@/features/notifications/compact-toast";

/**
 * Project Setup amendments for one project (`07` §10.12): the approval queue
 * for eligible deciders, the requester's own pending requests with Withdraw,
 * and the full record. Same pattern as the Milestones / Deliverables
 * "Pending Approvals" tab. Presentation only — the database decides.
 */
export function SetupAmendmentsPanel({
  projectCode,
  amendments,
  viewer,
  projectArchived,
  focusAmendmentId,
  onChanged,
}: {
  projectCode: string;
  amendments: readonly SetupAmendment[];
  viewer: AmendmentViewer;
  projectArchived: boolean;
  /** From a notification: open the tab that holds this request and highlight it. */
  focusAmendmentId?: string;
  onChanged: () => void;
}) {
  const actionable = amendments.filter((amendment) => canDecideAmendment(amendment, viewer, { projectArchived }));
  const ownPending = amendments.filter(
    (amendment) => amendment.status === "pending" && isOwnAmendment(amendment, viewer)
  );
  const focused = focusAmendmentId ? amendments.find((amendment) => amendment.id === focusAmendmentId) : undefined;
  const [tab, setTab] = React.useState(
    focused
      ? actionable.some((amendment) => amendment.id === focused.id) ? "approvals" : "all"
      : actionable.length > 0 ? "approvals" : "all"
  );
  // 13.11 UAT: collapsible. Open when something waits for this viewer (or a
  // notification points at a request); the counts stay visible either way, and
  // the chosen tab survives collapsing.
  const [open, setOpen] = React.useState(actionable.length > 0 || Boolean(focused));
  const contentId = React.useId();
  const awaiting = actionable.length;
  const seenAwaiting = React.useRef(awaiting);
  React.useEffect(() => {
    // A new request for this viewer arrived (e.g. re-read on return): show it.
    if (awaiting > seenAwaiting.current) setOpen(true);
    seenAwaiting.current = awaiting;
  }, [awaiting]);
  if (amendments.length === 0) return null;

  const counts = `Awaiting decision (${actionable.length}) · My requests (${ownPending.length}) · All amendments (${amendments.length})`;
  return (
    <SectionCard
      title="Setup amendments"
      description={
        open
          ? "Changes to controlled Project Setup fields and structure. Governed requests apply only after another Project Control Admin or System Administrator approves them."
          : counts
      }
      action={
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Hide" : "Show"}
          <ChevronDown data-icon="inline-end" aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      }
      contentClassName={open ? undefined : "hidden"}
    >
      <Tabs id={contentId} value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="approvals">
            Awaiting decision{actionable.length > 0 ? ` (${actionable.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="mine">
            My requests{ownPending.length > 0 ? ` (${ownPending.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="all">All amendments ({amendments.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="approvals" className="pt-3">
          <AmendmentList
            items={actionable}
            empty={
              viewer.isGlobalAuthority
                ? "No requests are waiting for your decision."
                : "Amendment requests are decided by a Project Control Admin or System Administrator."
            }
            projectCode={projectCode}
            viewer={viewer}
            projectArchived={projectArchived}
            focusId={focusAmendmentId}
            onChanged={onChanged}
          />
        </TabsContent>
        <TabsContent value="mine" className="pt-3">
          <AmendmentList items={ownPending} empty="You have no pending requests on this project."
            projectCode={projectCode} viewer={viewer} projectArchived={projectArchived} onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="all" className="pt-3">
          <AmendmentList items={amendments} empty="No amendments yet." projectCode={projectCode}
            viewer={viewer} projectArchived={projectArchived} focusId={focusAmendmentId} onChanged={onChanged} />
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}

export function AmendmentList({
  items,
  empty,
  projectCode,
  viewer,
  projectArchived,
  focusId,
  onChanged,
}: {
  items: readonly SetupAmendment[];
  empty: string;
  projectCode: string;
  viewer: AmendmentViewer;
  projectArchived: boolean;
  focusId?: string;
  onChanged: () => void;
}) {
  if (items.length === 0) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((amendment) => (
        <AmendmentRow key={amendment.id} amendment={amendment} projectCode={projectCode} viewer={viewer}
          projectArchived={projectArchived} focused={amendment.id === focusId} onChanged={onChanged} />
      ))}
    </ul>
  );
}

function AmendmentRow({
  amendment,
  projectCode,
  viewer,
  projectArchived,
  focused,
  onChanged,
}: {
  amendment: SetupAmendment;
  projectCode: string;
  viewer: AmendmentViewer;
  projectArchived: boolean;
  /** Opened from a notification: scrolled into view and highlighted. */
  focused: boolean;
  onChanged: () => void;
}) {
  const lookups = useSetupValueLookups();
  const structure = isStructureAmendment(amendment);
  const { subject: label, previous, proposed } = amendmentWording(amendment, (fieldKey, value) =>
    formatSetupValue(fieldKey, value, lookups)
  );
  const status = amendmentDisplayStatus(amendment, { projectArchived });
  const canDecide = canDecideAmendment(amendment, viewer, { projectArchived });
  const canWithdraw = canWithdrawAmendment(amendment, viewer, { projectArchived });
  const own = isOwnAmendment(amendment, viewer);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [withdrawOpen, setWithdrawOpen] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const detailsId = React.useId();
  const commentId = React.useId();
  const rowRef = React.useRef<HTMLLIElement>(null);
  React.useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);

  // 13.11 UAT: the one compact toast — what happened, then project code ·
  // subject. The full record stays in this row, History and the Notification Center.
  const run = async (
    action: () => Promise<SetupAmendment>,
    outcome: (result: SetupAmendment) => AmendmentToastEvent
  ) => {
    try {
      const result = await action();
      const { title, context, tone } = compactAmendmentToast(outcome(result), { projectCode, amendment: result });
      showCompactToast({ title, context, tone, duration: CONFIRMATION_TOAST_DURATION_MS });
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "That could not be completed.");
      throw cause;
    }
  };

  /*
   * 13.11 UAT — one card, five clear bands: header (subject, badges, actions),
   * the change itself (prominent), who / when, the reason (two lines), and the
   * impact behind "View details". Presentation only: the same data, the same
   * permissions, the same actions.
   */
  const decided = Boolean(amendment.decidedAt) && amendment.status !== "applied";
  return (
    <li
      ref={rowRef}
      id={`amendment-${amendment.id}`}
      data-focused={focused ? "true" : undefined}
      className={cn(
        "overflow-hidden rounded-lg border bg-card text-sm",
        focused && "border-primary bg-primary/5 ring-2 ring-primary/40"
      )}
    >
      {/* HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3 pt-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs text-muted-foreground">{projectCode}</p>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium text-pretty">{label}</h4>
            <StatusBadge tone={AMENDMENT_STATUS_TONE[status]}>{AMENDMENT_STATUS_LABEL[status]}</StatusBadge>
            <StatusBadge tone="neutral">
              {structure ? "Structure" : amendment.amendmentClass === "governed" ? "Governed" : "Lightweight"}
            </StatusBadge>
          </div>
        </div>
        {(canDecide || canWithdraw) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {canDecide && (
              <>
                <Button size="sm" onClick={() => setApproveOpen(true)}>
                  <Check data-icon="inline-start" aria-hidden="true" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}>
                  <X data-icon="inline-start" aria-hidden="true" /> Reject
                </Button>
              </>
            )}
            {canWithdraw && (
              <Button size="sm" variant="ghost" onClick={() => setWithdrawOpen(true)}>
                <Undo2 data-icon="inline-start" aria-hidden="true" /> Withdraw
              </Button>
            )}
          </div>
        )}
      </div>

      {/* CHANGE */}
      <div className="mx-3 mt-2.5 grid gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Current</p>
          <p className="text-muted-foreground text-pretty break-words">{previous}</p>
        </div>
        <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-label="to" />
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Proposed</p>
          <p className="font-semibold text-pretty break-words">{proposed}</p>
        </div>
      </div>

      {/* METADATA */}
      <div className="space-y-0.5 px-3 pt-2 text-xs text-muted-foreground tabular-nums">
        <p>Requested by {own ? "you" : amendment.requestedByName ?? "a Project Control user"} · {formatDateTime(amendment.requestedAt)}</p>
        {decided && amendment.decidedAt && (
          <p>
            {AMENDMENT_STATUS_LABEL[amendment.status]}
            {amendment.decidedByName ? ` by ${amendment.decidedByName}` : ""} · {formatDateTime(amendment.decidedAt)}
          </p>
        )}
      </div>

      <div className="mx-3 mt-2.5 space-y-2 border-t py-2.5">
        {/* REASON */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reason</p>
          <p className={cn("text-pretty break-words", !detailsOpen && "line-clamp-2")}>{amendment.reason}</p>
        </div>
        {/* DECISION NOTE */}
        {amendment.decisionComment && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Decision note</p>
            <p className="text-pretty break-words">{amendment.decisionComment}</p>
          </div>
        )}
        {/* IMPACT */}
        {detailsOpen && (
          <div id={detailsId}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Impact</p>
            <p className="text-xs text-muted-foreground text-pretty">{amendment.impactWarning}</p>
          </div>
        )}
        {status === "stale" && (
          <p className="text-xs text-warning">
            {structure
              ? "The structure changed after this request — nothing was applied. Propose it again if it is still needed."
              : "The value changed after this request — nothing was applied."}
          </p>
        )}
        {status === "frozen" && (
          <p className="text-xs text-muted-foreground">The project was archived while this request was pending. It can no longer be decided.</p>
        )}
        {amendment.status === "pending" && own && !projectArchived && (
          <p className="text-xs text-muted-foreground">You cannot approve your own request.</p>
        )}
        <button
          type="button"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen((open) => !open)}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          {detailsOpen ? "Hide details" : "View details"}
        </button>
      </div>

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={structure ? `Approve: ${label}?` : `Approve the ${label} amendment?`}
        description={
          structure
            ? "The structure change is applied now, in one step, if the structure it was based on is unchanged and the change is still valid. Otherwise the request is recorded as stale and nothing changes."
            : "The proposed value is applied now, if the current value is still the one the request was based on. Otherwise the request is recorded as stale and nothing changes."
        }
        confirmLabel="Approve and apply"
        onConfirm={() =>
          run(() => setupGovernanceService.approveAmendment(amendment.id), (result) =>
            result.status === "stale" ? "stale" : "approved")
        }
      />
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setComment("");
        }}
        title={structure ? `Reject: ${label}?` : `Reject the ${label} amendment?`}
        description="Nothing is applied. The requester sees your comment."
        confirmLabel="Reject request"
        destructive
        onConfirm={() => {
          if (!comment.trim()) {
            toast.error("A comment is required to reject a request.");
            return Promise.reject(new Error("comment required"));
          }
          return run(() => setupGovernanceService.rejectAmendment(amendment.id, comment.trim()), () => "rejected");
        }}
      >
        <Field>
          <FieldLabel htmlFor={commentId}>Comment <span className="text-destructive" aria-hidden="true">*</span></FieldLabel>
          <Textarea id={commentId} rows={3} value={comment} onChange={(event) => setComment(event.target.value)}
            placeholder="Why the request is rejected" />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title="Withdraw this request?"
        description="The request is closed without a decision. Nothing is applied, and the request stays in the record."
        confirmLabel="Withdraw request"
        onConfirm={() => run(() => setupGovernanceService.withdrawAmendment(amendment.id), () => "withdrawn")}
      />
    </li>
  );
}
