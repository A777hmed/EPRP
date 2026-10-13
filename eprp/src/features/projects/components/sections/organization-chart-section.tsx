"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrgChartView } from "@/features/organization";
import type { Project } from "@/types";
import { PeopleOrgChart } from "../people-chart/people-org-chart";

export interface OrganizationChartSectionProps {
  project: Project;
}

/**
 * `/projects/[projectId]/organization-chart`.
 *
 * Opens on the People Organization Chart (2C.3F): the Project Team arranged
 * by project Reports To — the canonical people reporting hierarchy. The
 * Phase 2A position chart stays available, unchanged, as a separate tab: it is
 * its own model of positions and does not define who reports to whom.
 */
export function OrganizationChartSection({
  project,
}: OrganizationChartSectionProps) {
  return (
    <Tabs defaultValue="people">
      <TabsList>
        <TabsTrigger value="people">People</TabsTrigger>
        <TabsTrigger value="positions">Position Chart</TabsTrigger>
      </TabsList>
      <TabsContent value="people" className="pt-2">
        <PeopleOrgChart project={project} />
      </TabsContent>
      <TabsContent value="positions" className="space-y-3 pt-2">
        <p className="text-xs text-muted-foreground" data-position-chart-note>
          A separate model of the project&apos;s positions. It does not define who
          reports to whom — the People chart, from the Project Team, does.
        </p>
        <OrgChartView project={project} />
      </TabsContent>
    </Tabs>
  );
}
