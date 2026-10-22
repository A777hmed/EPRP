"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import { formatDate } from "@/lib/formatters";
import { planningService } from "@/services/planning-service";
import type { PlanningConfirmation, PlanningConfirmationAction } from "@/types";
import { History } from "lucide-react";
import { EARNING_METHOD_LABEL } from "../../working-plan";
import { PlanningHelp } from "./planning-help";
import { LabelWithHelp } from "@/components/shared";

const ACTION_LABEL: Record<PlanningConfirmationAction, string> = {
  confirm: "Confirmed from import",
  adjust: "Adjusted",
  edit: "Edited",
  normalise: "Weights normalised",
};

const FIELD_LABEL: Record<string, string> = {
  code: "Code",
  name: "Name",
  parent_work_item_id: "Parent",
  work_item_id: "Planning node",
  local_weight_percent: "Local weight",
  is_control_account: "Control Account",
  earning_method: "Earning method",
  department_id: "Reporting department",
  system_id: "Reporting system",
  discipline_id: "Reporting Program & Study",
  structure_node_id: "Reporting unit",
  active: "Active",
  is_milestone: "Milestone",
  planned_start_date: "Forecast start",
  planned_finish_date: "Forecast finish",
  actual_start_date: "Actual start",
  actual_finish_date: "Actual finish",
  percent_complete_physical: "Physical % complete",
  plannedPercent: "Planned %",
  row: "Imported row",
};

const MODE_LABEL: Record<string, string> = {
  proportional_rescale: "proportional rescale",
  equal_split: "equal split",
  adopt_recorded: "recorded weight adopted",
};

function display(field: string, value: string | undefined, names: Map<string, string>): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field === "earning_method") return EARNING_METHOD_LABEL[value as keyof typeof EARNING_METHOD_LABEL] ?? value;
  if (field === "local_weight_percent") return `${Number(value)}%`;
  if (field === "row") return "as imported";
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  if (/_id$/.test(field)) return names.get(value) ?? "another record";
  return value;
}

/**
 * The append-only Planning Decision log of one node or activity (13.11):
 * every governed Working Plan change, import confirmation and weight
 * decision, with who, when and why. Read-only — history is never edited.
 */
export function PlanningItemHistoryDialog({
  target,
  name,
  nodeNames,
  onClose,
}: {
  target: { kind: "node" | "activity"; id: string };
  name: string;
  /** Node ids → names, to show a moved parent in words. */
  nodeNames: Map<string, string>;
  onClose: () => void;
}) {
  const [entries, setEntries] = React.useState<PlanningConfirmation[] | null | undefined>();
  const { records: contacts } = useMasterData("contact");
  const contactName = React.useMemo(() => new Map(contacts.map((contact) => [contact.id, contact.name])), [contacts]);

  React.useEffect(() => {
    let cancelled = false;
    const load =
      target.kind === "node"
        ? planningService.listConfirmationsForWorkItem(target.id)
        : planningService.listConfirmationsForActivity(target.id);
    load.then(
      (rows) => !cancelled && setEntries(rows),
      () => !cancelled && setEntries(null)
    );
    return () => {
      cancelled = true;
    };
  }, [target.id, target.kind]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>History — {name}</DialogTitle>
          <DialogDescription asChild>
            <div>
              <LabelWithHelp help={<PlanningHelp concept="history" />}>
                Every logged change to this item. Entries are never edited or removed.
              </LabelWithHelp>
            </div>
          </DialogDescription>
        </DialogHeader>
        {entries === undefined ? (
          <LoadingState variant="spinner" label="Loading history…" />
        ) : entries === null ? (
          <p className="text-sm text-muted-foreground">The history could not be loaded. Try again in a moment.</p>
        ) : entries.length === 0 ? (
          <EmptyState icon={History} title="No logged changes yet" description="Changes are logged from Phase 13.11 onwards." className="py-8" />
        ) : (
          <ol className="divide-y rounded-lg border">
            {entries.map((entry) => (
              <li key={entry.id} className="grid gap-0.5 px-3 py-2.5 text-sm">
                <p>
                  <span className="font-medium">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                  {" · "}
                  {FIELD_LABEL[entry.fieldName] ?? entry.fieldName}
                  {entry.fieldName !== "row" && (
                    <span className="text-muted-foreground">
                      {": "}
                      {display(entry.fieldName, entry.previousValue, nodeNames)} →{" "}
                      {display(entry.fieldName, entry.newValue, nodeNames)}
                    </span>
                  )}
                  {entry.decisionMode && (
                    <span className="text-muted-foreground"> ({MODE_LABEL[entry.decisionMode]})</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(entry.confirmedAt)}
                  {entry.confirmedByContactId && ` · ${contactName.get(entry.confirmedByContactId) ?? "a project user"}`}
                  {entry.reason && ` · “${entry.reason}”`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
