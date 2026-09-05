"use client";

import * as React from "react";
import {
  FileSpreadsheet,
  LayoutTemplate,
  Loader2,
  Network,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, SectionCard } from "@/components/shared";
import { useProjectAuthority } from "@/features/projects/use-project-authority";
import { organizationChartService } from "@/services/organization-chart-service";
import type { OrganizationChart, Project } from "@/types";
import { OrgChartWorkspace } from "./org-chart-workspace";
import { TemplateSelectorDialog } from "./template-selector-dialog";
import { ImportWizardDialog } from "./import-wizard-dialog";
import type { ChartTemplate } from "../lib/chart-templates";
import type { PositionTreeInput } from "@/services/organization-chart-service";

async function resolveChart(
  projectId: string
): Promise<OrganizationChart | null> {
  const active = await organizationChartService.getActiveChart(projectId);
  if (active) return active;
  const charts = await organizationChartService.listCharts(projectId);
  return charts[0] ?? null;
}

export interface OrgChartViewProps {
  project: Project;
}

/**
 * The project's organization chart.
 *
 * A chart is looked up by project id: the active one if the project has it,
 * otherwise the most recent draft. Nothing is created implicitly — the chart
 * exists only once someone starts one.
 */
export function OrgChartView({ project }: OrgChartViewProps) {
  /* Chart mutation is `can_manage_project_operations(project_id)` — the same
     predicate as Project Setup and Master Milestones, and the same helper. */
  const authority = useProjectAuthority(project);
  const [chart, setChart] = React.useState<
    OrganizationChart | null | undefined
  >();
  const [creating, setCreating] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [applyingTemplate, setApplyingTemplate] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  React.useEffect(() => {
    // The active chart if there is one, otherwise the newest draft, so work
    // in progress is never stranded.
    resolveChart(project.id).then(setChart);
  }, [project.id]);

  const handleCreateBlank = async () => {
    setCreating(true);
    try {
      const created = await organizationChartService.createChart({
        projectId: project.id,
        name: `${project.shortName ?? project.name} organization chart`,
        source: "blank",
      });
      const activated = await organizationChartService.activateChart(
        created.id
      );
      setChart(activated);
      toast.success("Chart created");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create the chart"
      );
    } finally {
      setCreating(false);
    }
  };

  /**
   * A template or import needs a chart to land in, so the chart is created
   * first and the positions are generated into it. Both start-from-nothing
   * paths run through here, so the chart is only ever created once.
   */
  const createChartFrom = async (
    source: "template" | "excel_import",
    nodes: PositionTreeInput[]
  ): Promise<number> => {
    const created = await organizationChartService.createChart({
      projectId: project.id,
      name: `${project.shortName ?? project.name} organization chart`,
      source,
    });
    const activated = await organizationChartService.activateChart(created.id);
    const positions = await organizationChartService.applyPositionTree(
      activated.id,
      nodes
    );
    setChart(activated);
    return positions.length;
  };

  const handleApplyTemplate = async (template: ChartTemplate) => {
    setApplyingTemplate(true);
    try {
      const count = await createChartFrom("template", template.nodes);
      setTemplateOpen(false);
      toast.success(
        count > 0
          ? `${template.name} loaded — ${count} position${count === 1 ? "" : "s"} created`
          : "Chart created"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load the template"
      );
    } finally {
      setApplyingTemplate(false);
    }
  };

  const handleImport = async (nodes: PositionTreeInput[]) => {
    setImporting(true);
    try {
      const count = await createChartFrom("excel_import", nodes);
      setImportOpen(false);
      toast.success(
        `Imported — ${count} position${count === 1 ? "" : "s"} created`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not import the chart"
      );
    } finally {
      setImporting(false);
    }
  };

  // Hold for the identity too, so the start options never flash for an
  // account that is about to be shown the read-only state instead.
  if (chart === undefined || !authority.resolved) {
    return <LoadingState variant="card" label="Loading organization chart…" />;
  }

  if (chart === null) {
    /*
     * Every way of STARTING a chart — blank, template, Excel import — inserts
     * into `organization_charts` / `organization_positions`, whose INSERT and
     * UPDATE policies are `can_manage_project_operations(project_id)`. None of
     * them was gated, so a Department User with no chart on their project was
     * offered all three and refused by RLS on click.
     *
     * The dialogs are withheld along with the buttons: rendering them left
     * mounted mutation flows reachable by other means.
     */
    if (!authority.canManageOperations) {
      return (
        <SectionCard
          title="Project organization chart"
          description="No chart has been created for this project yet."
        >
          <EmptyState
            icon={Network}
            title="No organization chart yet"
            description="This project's organization chart has not been created. Charts are built by Project Control; once one exists it will appear here."
            className="py-10"
          />
        </SectionCard>
      );
    }

    return (
      <>
        <StartOptions
          creating={creating}
          onCreateBlank={handleCreateBlank}
          onLoadTemplate={() => setTemplateOpen(true)}
          onImport={() => setImportOpen(true)}
        />
        <TemplateSelectorDialog
          open={templateOpen}
          onOpenChange={setTemplateOpen}
          existingPositionCount={0}
          applying={applyingTemplate}
          onApply={handleApplyTemplate}
        />
        <ImportWizardDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          existingPositionCount={0}
          importing={importing}
          onImport={handleImport}
        />
      </>
    );
  }

  return (
    <SectionCard
      title={chart.name}
      description="Drag to pan, scroll to zoom. Reporting lines follow the hierarchy."
      contentClassName="space-y-0"
    >
      <OrgChartWorkspace
        chart={chart}
        canManage={authority.canManageOperations}
        onChartChange={setChart}
        onArchived={() => {
          // The chart just left the project; fall back to whatever remains,
          // or the start screen when nothing does.
          setChart(undefined);
          resolveChart(project.id).then(setChart);
        }}
      />
    </SectionCard>
  );
}

/* ------------------------------ Start options ----------------------------- */

/** How a chart can be started: blank, from a template, or from a spreadsheet. */
function StartOptions({
  creating,
  onCreateBlank,
  onLoadTemplate,
  onImport,
}: {
  creating: boolean;
  onCreateBlank: () => void;
  onLoadTemplate: () => void;
  onImport: () => void;
}) {
  return (
    <SectionCard
      title="Project organization chart"
      description="No chart has been created for this project yet."
    >
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Network className="size-6" />
        </span>
        <h3 className="text-sm font-semibold">No organization chart yet</h3>
        <p className="max-w-md text-sm text-muted-foreground text-pretty">
          Build the reporting structure for this project — who reports to
          whom, and which department each position belongs to.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SectionCard
          title="Create Blank Chart"
          className="bg-muted/30"
          contentClassName="space-y-3"
        >
          <p className="text-xs text-muted-foreground text-pretty">
            Start from an empty canvas and add positions yourself.
          </p>
          <Button
            size="sm"
            className="w-full"
            onClick={onCreateBlank}
            disabled={creating}
          >
            {creating ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Plus data-icon="inline-start" aria-hidden="true" />
            )}
            Create Blank Chart
          </Button>
        </SectionCard>

        <SectionCard
          title="Load Template"
          className="bg-muted/30"
          contentClassName="space-y-3"
        >
          <p className="text-xs text-muted-foreground text-pretty">
            Begin from a standard EPROM project structure.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onLoadTemplate}
            disabled={creating}
          >
            <LayoutTemplate data-icon="inline-start" aria-hidden="true" />
            Load Template
          </Button>
        </SectionCard>

        <SectionCard
          title="Import Excel"
          className="bg-muted/30"
          contentClassName="space-y-3"
        >
          <p className="text-xs text-muted-foreground text-pretty">
            Bring in an existing chart from a spreadsheet.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onImport}
            disabled={creating}
          >
            <FileSpreadsheet data-icon="inline-start" aria-hidden="true" />
            Import Excel
          </Button>
        </SectionCard>
      </div>
    </SectionCard>
  );
}
