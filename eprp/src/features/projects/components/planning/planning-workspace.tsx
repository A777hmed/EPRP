"use client";

import * as React from "react";
import { Flag, Gauge, Workflow } from "lucide-react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { EmptyState, LoadingState, StatCard, type StatCardProps } from "@/components/shared";
import { planningService } from "@/services/planning-service";
import type { PlanningSnapshot, Project, ProjectPlanningSettings } from "@/types";
import { BaselinesSnapshotsPanel } from "./baselines-snapshots-panel";
import { MasterPlanPanel } from "./master-plan-panel";
import { PlanningDataPanel } from "./planning-data-panel";

const ONBOARDING_LABEL: Record<ProjectPlanningSettings["onboardingMode"], string> = {
  new_project: "New Project",
  existing_active_project: "Existing Active Project",
  no_formal_schedule: "No Formal Schedule",
};

/**
 * The Planning & Control workspace: Overview, Master Plan, Planning Data,
 * and Baselines & Snapshots are implemented now. Milestones and Performance
 * & Variance are placeholders — Master Milestones already has its own
 * project section, and the S-curve/Dashboard integration is explicitly a
 * later slice, not built here.
 */
export function PlanningWorkspace({
  project,
  canManage,
  hierarchyTerm,
}: {
  project: Project;
  canManage: boolean;
  hierarchyTerm: string;
}) {
  const [settings, setSettings] = React.useState<ProjectPlanningSettings | null | undefined>();
  const [snapshot, setSnapshot] = React.useState<PlanningSnapshot | null | undefined>();

  const load = React.useCallback(() => {
    void planningService.getSettings(project.id).then(setSettings);
    void planningService.getLatestSnapshot(project.id).then(setSnapshot);
  }, [project.id]);

  React.useEffect(() => load(), [load]);

  const loading = settings === undefined || snapshot === undefined;
  const onboardingMode = settings?.onboardingMode ?? "new_project";

  const stats: StatCardProps[] = [
    { label: "Onboarding", value: ONBOARDING_LABEL[onboardingMode], icon: Workflow },
    { label: "Published snapshot", value: snapshot ? `v${snapshot.version}` : "None yet", icon: Flag },
  ];

  return (
    <div className="space-y-4">
      {!loading && (
        <div className="grid gap-3 sm:grid-cols-2">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="master-plan">Master Plan</TabsTrigger>
          <TabsTrigger value="planning-data">Planning Data</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="performance">Performance &amp; Variance</TabsTrigger>
          <TabsTrigger value="baselines">Baselines &amp; Snapshots</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          {loading ? (
            <LoadingState variant="spinner" label="Loading planning data…" />
          ) : snapshot ? (
            <div className="space-y-1.5 text-sm">
              <p>
                Current published snapshot:{" "}
                <span className="font-medium tabular-nums">v{snapshot.version}</span>
                {snapshot.isOpeningSnapshot && " · Opening Planning Snapshot"}
              </p>
              <p className="text-xs text-muted-foreground">
                Published {new Date(snapshot.publishedAt).toLocaleString()}
                {snapshot.label ? ` · ${snapshot.label}` : ""}.
              </p>
            </div>
          ) : (
            <EmptyState
              icon={Workflow}
              title="Planning not yet initialized"
              description="Add work items directly in Master Plan, or import from Planning Data — EPRP Excel, P6, or MS Project — then publish a snapshot. Until then, this project's own planned/actual progress fields remain the fallback."
              className="py-8"
            />
          )}
        </TabsContent>

        <TabsContent value="master-plan" className="pt-4">
          <MasterPlanPanel projectId={project.id} canManage={canManage} hierarchyTerm={hierarchyTerm} />
        </TabsContent>

        <TabsContent value="planning-data" className="pt-4">
          <PlanningDataPanel project={project} canManage={canManage} />
        </TabsContent>

        <TabsContent value="milestones" className="pt-4">
          <EmptyState
            icon={Flag}
            title="Use the project's Milestones section"
            description="Master Milestones is the one governed milestone register — open it from the project sidebar. This tab will surface planning-linked milestones directly in a later slice."
            className="py-10"
          />
        </TabsContent>

        <TabsContent value="performance" className="pt-4">
          <EmptyState
            icon={Gauge}
            title="Not built in this slice"
            description="Performance & Variance (S-curve, SPI) is Dashboard-integration work and is deliberately out of scope until Planning data and reporting linkage are proven."
            className="py-10"
          />
        </TabsContent>

        <TabsContent value="baselines" className="pt-4">
          <BaselinesSnapshotsPanel project={project} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
