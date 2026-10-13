"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, TriangleAlert, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, SectionCard } from "@/components/shared";
import { projectWorkflowHref } from "@/config/project-workflow";
import { useMasterData } from "@/features/master-data";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { Client, Contact, JobTitle, Project } from "@/types";
import { buildPeopleChart, peopleChartManagers } from "@/features/projects/people-chart";
import { useProjectAuthority } from "@/features/projects/use-project-authority";
import { PEOPLE_PARTY_META } from "./people-chart-card";
import { PeopleChartOutline, PeopleChartTree } from "./people-chart-tree";

type ChartViewMode = "chart" | "outline";

/**
 * People Organization Chart (Phase 2C.3F): the project's active Project Team
 * arranged by project Reports To. A VIEW — Reports To is edited on the
 * Project Team only, and the chart grants nothing. The one action it offers,
 * a link to the Project Team, follows the Project Team's own edit authority
 * (never on an archived project).
 */
export function PeopleOrgChart({ project }: { project: Project }) {
  const authority = useProjectAuthority(project);
  const { records: contactRecords } = useMasterData("contact");
  const { records: jobTitleRecords } = useMasterData("jobTitle");
  const { records: clientRecords } = useMasterData("client");
  const clientName = (clientRecords as Client[]).find((client) => client.id === project.clientId)?.name;

  const chart = React.useMemo(() => {
    const titles = jobTitleRecords as JobTitle[];
    return buildPeopleChart(project, {
      contacts: contactRecords as Contact[],
      clientName,
      jobTitleName: (id) => titles.find((title) => title.id === id)?.name,
    });
  }, [project, contactRecords, jobTitleRecords, clientName]);
  const managers = React.useMemo(() => peopleChartManagers(chart), [chart]);

  // Outline by default on a narrow screen; the reader can switch either way.
  const isMobile = useIsMobile();
  const [chosenView, setChosenView] = React.useState<ChartViewMode | null>(null);
  const view = chosenView ?? (isMobile ? "outline" : "chart");
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggle = React.useCallback((memberId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(memberId)) next.add(memberId);
      return next;
    });
  }, []);

  const archived = project.status === "archived";
  const teamHref = projectWorkflowHref(project.id, "contacts");

  if (!project.members) {
    return (
      <SectionCard title="People Organization Chart">
        <EmptyState
          icon={Users}
          title="Project team membership is not available yet"
          description="The project team needs a database update. Contact your administrator."
          className="py-8"
        />
      </SectionCard>
    );
  }

  const Tree = view === "chart" ? PeopleChartTree : PeopleChartOutline;

  return (
    <SectionCard
      title="People Organization Chart"
      description="Who reports to whom on this project, from the Project Team. Reporting lines describe the team; they grant no access."
      data-people-org-chart
      action={
        authority.canManageOperations ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={teamHref}>Edit on Project Team</Link>
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Chart layout" className="inline-flex rounded-lg bg-muted p-[3px]">
            {(["chart", "outline"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                onClick={() => setChosenView(mode)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  view === mode ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {mode === "chart" ? "Chart" : "Outline"}
              </button>
            ))}
          </div>
          {managers.length > 0 && (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}
                disabled={collapsed.size === 0}>
                Expand all
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCollapsed(new Set(managers))}
                disabled={collapsed.size === managers.length}>
                Collapse all
              </Button>
            </>
          )}
          <ul className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Party legend">
            {(["eprom", "client", "subcontractor"] as const).map((key) => {
              const meta = PEOPLE_PARTY_META[key];
              const Icon = meta.icon;
              return (
                <li key={key} className="inline-flex items-center gap-1">
                  <Icon className={cn("size-3", meta.text)} aria-hidden="true" />
                  {meta.legend}
                </li>
              );
            })}
          </ul>
        </div>

        {archived && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-people-chart-archived>
            <Lock className="size-3.5 shrink-0" aria-hidden="true" />
            This project is archived. The chart is read-only.
          </p>
        )}

        {chart.warnings.length > 0 && (
          <div
            role="note"
            data-people-chart-quality
            className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.04] px-3 py-2"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0 text-xs">
              <p className="text-sm font-medium leading-5">Reporting data to complete</p>
              <p className="text-pretty text-muted-foreground">
                {chart.warnings.join(" · ")}. Anyone without a valid Reports To is shown at the top level
                {archived ? "." : " until it is completed on the Project Team."}
              </p>
            </div>
          </div>
        )}

        <Tree chart={chart} project={project} collapsed={collapsed} onToggle={toggle} />
        {chart.memberCount === 0 && (
          <EmptyState
            icon={Users}
            title="No one is on the Project Team yet"
            description="The chart follows the Project Team: add people there and set who they report to."
            className="py-6"
          />
        )}

        {chart.endedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {chart.endedCount === 1 ? "1 former member is" : `${chart.endedCount} former members are`} not shown.
            Ended memberships are kept as history on the Project Team.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
