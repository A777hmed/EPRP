"use client";

import * as React from "react";
import { ArrowRight, Check, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog, SectionCard, StatusBadge } from "@/components/shared";
import { formatDateTime } from "@/lib/formatters";
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
  if (amendments.length === 0) return null;

  return (
    <SectionCard
      title="Setup amendments"
      description="Changes to controlled Project Setup fields and structure. Governed requests apply only after another Project Control Admin or System Administrator approves them."
    >
      <Tabs value={tab} onValueChange={setTab}>
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
  const commentId = React.useId();
  const rowRef = React.useRef<HTMLLIElement>(null);
  React.useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);

  const run = async (action: () => Promise<SetupAmendment>, success: (result: SetupAmendment) => string) => {
    try {
      const result = await action();
      toast.success(success(result));
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "That could not be completed.");
      throw cause;
    }
  };

  return (
    <li
      ref={rowRef}
      id={`amendment-${amendment.id}`}
      data-focused={focused ? "true" : undefined}
      className={focused ? "rounded-lg border border-primary bg-primary/5 p-3 text-sm ring-2 ring-primary/40" : "rounded-lg border p-3 text-sm"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="text-xs font-normal text-muted-foreground">{projectCode}</span>
            {label}
            <StatusBadge tone={AMENDMENT_STATUS_TONE[status]}>{AMENDMENT_STATUS_LABEL[status]}</StatusBadge>
            <StatusBadge tone="neutral">
              {structure ? "Structure" : amendment.amendmentClass === "governed" ? "Governed" : "Lightweight"}
            </StatusBadge>
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-pretty">
            <span className="text-muted-foreground">{previous}</span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
            <span className="font-medium">{proposed}</span>
          </p>
          <p className="text-pretty"><span className="text-muted-foreground">Reason: </span>{amendment.reason}</p>
          <p className="text-xs text-muted-foreground text-pretty">Impact: {amendment.impactWarning}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            Requested by {own ? "you" : amendment.requestedByName ?? "a Project Control user"} · {formatDateTime(amendment.requestedAt)}
            {amendment.decidedAt && amendment.status !== "applied" && (
              <>
                {" "}· {AMENDMENT_STATUS_LABEL[amendment.status]}
                {amendment.decidedByName ? ` by ${amendment.decidedByName}` : ""} {formatDateTime(amendment.decidedAt)}
              </>
            )}
          </p>
          {amendment.decisionComment && (
            <p className="text-xs text-pretty"><span className="text-muted-foreground">Decision note: </span>{amendment.decisionComment}</p>
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
        </div>
        {(canDecide || canWithdraw) && (
          <div className="flex flex-wrap gap-2">
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
            result.status === "stale"
              ? `The ${structure ? "structure" : "value"} changed after this request — it was recorded as stale and nothing was applied.`
              : structure
                ? `Approved and applied: ${label}.`
                : `${label} amendment approved and applied.`)
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
          return run(() => setupGovernanceService.rejectAmendment(amendment.id, comment.trim()), () => "Amendment rejected.");
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
        onConfirm={() => run(() => setupGovernanceService.withdrawAmendment(amendment.id), () => "Request withdrawn.")}
      />
    </li>
  );
}
