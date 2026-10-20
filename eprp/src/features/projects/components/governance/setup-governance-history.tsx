"use client";

import * as React from "react";
import { ArrowRight, History } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import { PROJECT_LIFECYCLE_META } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { projectService } from "@/services/project-service";
import { setupGovernanceService } from "@/services/setup-governance-service";
import type { Project, ProjectLifecycleStatus, ProjectType } from "@/types";
import { classificationLabel } from "../../classification";
import { formatSetupValue, SETUP_FIELD_UI } from "../../setup-amendments";
import {
  composeSetupHistory,
  SETUP_HISTORY_CATEGORY_LABEL,
  type SetupHistoryCategory,
  type SetupHistoryEvent,
} from "../../setup-history";
import { useSetupValueLookups } from "./setup-governance-ui";

const CONTACT_FIELDS = new Set([
  "project_manager_id",
  "project_control_manager_id",
  "client_representative_id",
  "reporting_coordinator_id",
  "project_sponsor_id",
]);

/**
 * Project History → Setup & governance (`02` §26.24.7). Built from the
 * structured records only; readable by whoever can read the project (the
 * Project Type correction history is visible to its own, narrower audience).
 */
export function SetupGovernanceHistory({ project }: { project: Project }) {
  const lookups = useSetupValueLookups();
  const { records: contacts } = useMasterData("contact");
  const { records: phases } = useMasterData("projectPhase");
  const { records: groups } = useMasterData("portfolioGroup");
  const { records: categories } = useMasterData("projectType");
  const [events, setEvents] = React.useState<SetupHistoryEvent[] | undefined>();
  const [failed, setFailed] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | SetupHistoryCategory>("all");

  const nameIn = React.useCallback(
    (records: readonly { id: string; name: string }[], id: unknown) =>
      typeof id === "string" ? records.find((record) => record.id === id)?.name : undefined,
    []
  );

  const describe = React.useCallback(
    (fieldKey: string, value: Readonly<Record<string, unknown>> | null | undefined): string => {
      if (SETUP_FIELD_UI[fieldKey]) return formatSetupValue(fieldKey, value, lookups);
      const raw = value ? value[Object.keys(value)[0]] : undefined;
      if (raw === null || raw === undefined || raw === "") return "Not set";
      if (CONTACT_FIELDS.has(fieldKey)) return nameIn(contacts, raw) ?? "A project person";
      if (fieldKey === "current_phase_id") return nameIn(phases, raw) ?? "A lifecycle phase";
      if (fieldKey === "portfolio_group_id") return nameIn(groups, raw) ?? "A portfolio group";
      if (fieldKey === "status") return PROJECT_LIFECYCLE_META[raw as ProjectLifecycleStatus]?.label ?? String(raw);
      if (fieldKey.endsWith("_logo_ref")) return "Logo updated";
      if (typeof raw === "boolean") return raw ? "Yes" : "No";
      return String(raw);
    },
    [contacts, phases, groups, lookups, nameIn]
  );

  const version = project.updatedAt;
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      setupGovernanceService.listFieldChanges(project.id),
      setupGovernanceService.listRelationChanges(project.id),
      setupGovernanceService.listProjectAmendments(project.id),
      // Its own read policy (Project Control or a global authority): empty for others.
      projectService.listClassificationCorrections(project.id).catch(() => []),
      setupGovernanceService.getControlState(project.id),
      setupGovernanceService.listReportedProgress(project.id),
    ])
      .then(([fieldChanges, relationChanges, amendments, corrections, control, reportedProgress]) => {
        if (cancelled) return;
        setFailed(false);
        setEvents(
          composeSetupHistory(
            { fieldChanges, relationChanges, amendments, corrections, finalisation: control.finalisation, reportedProgress },
            {
              value: describe,
              classification: (entry, side) => {
                const family = side === "old" ? entry.oldFamily : entry.newFamily;
                if (!family) return "Not classified";
                const typeId = side === "old" ? entry.oldProjectTypeId : entry.newProjectTypeId;
                const snapshot = side === "old" ? entry.oldProjectTypeName : entry.newProjectTypeName;
                const detail = side === "old" ? entry.oldCategoryDetail : entry.newCategoryDetail;
                return classificationLabel(family, snapshot ?? nameIn(categories as ProjectType[], typeId), detail);
              },
              date: formatDate,
            }
          )
        );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, version, describe, categories, nameIn]);

  if (failed) {
    return (
      <EmptyState icon={History} title="Setup history could not be loaded" description="Try again in a moment." className="py-8" />
    );
  }
  if (!events) return <LoadingState variant="table" label="Loading setup history…" />;

  const visible = filter === "all" ? events : events.filter((event) => event.category === filter);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Recorded once Project Setup is controlled: field changes, amendments and decisions, Project Type
          corrections, Setup Finalisation, Contacts / Sites / Parties changes and Reported Progress.
        </p>
        <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
          <SelectTrigger className="w-48" aria-label="Filter history"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {(Object.keys(SETUP_HISTORY_CATEGORY_LABEL) as SetupHistoryCategory[]).map((category) => (
              <SelectItem key={category} value={category}>{SETUP_HISTORY_CATEGORY_LABEL[category]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {visible.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {events.length === 0 ? "No setup or governance events have been recorded yet." : "No events of this kind."}
        </p>
      ) : (
        <ol className="space-y-2">
          {visible.map((event) => (
            <li key={event.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="neutral">{SETUP_HISTORY_CATEGORY_LABEL[event.category]}</StatusBadge>
                <span className="font-medium text-pretty">{event.title}</span>
              </div>
              {(event.previous || event.next) && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-pretty">
                  {event.previous && <span className="text-muted-foreground">{event.previous}</span>}
                  {event.previous && event.next && (
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
                  )}
                  {event.next && <span>{event.next}</span>}
                </p>
              )}
              {event.reason && (
                <p className="mt-1 text-pretty"><span className="text-muted-foreground">Reason: </span>{event.reason}</p>
              )}
              {event.note && <p className="mt-1 text-xs text-muted-foreground text-pretty">{event.note}</p>}
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {event.actor} · {formatDateTime(event.at)} · {project.code}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
