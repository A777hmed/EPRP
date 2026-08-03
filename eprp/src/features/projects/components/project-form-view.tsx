"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";
import { projectService } from "@/services/project-service";
import type { Project } from "@/types";
import {
  emptyProjectFormValues,
  formValuesToProjectInfoUpdate,
  formValuesToProjectInput,
  projectToFormValues,
  type ProjectFormValues,
} from "@/features/projects/schemas/project-form";
import { ProjectForm } from "./project-form";

export interface ProjectFormViewProps {
  /** When set, the view loads that project and saves edits to it. */
  projectId?: string;
}

/**
 * Shared screen for /projects/new and /projects/[projectId]/edit — one
 * ProjectForm instance in both modes, no duplicated form code.
 */
export function ProjectFormView({ projectId }: ProjectFormViewProps) {
  const router = useRouter();
  const isEdit = projectId !== undefined;

  const [project, setProject] = React.useState<Project | null | undefined>(
    isEdit ? undefined : null
  );
  const [usedCodes, setUsedCodes] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    projectService.getUsedCodes(projectId).then(setUsedCodes);
    if (projectId) {
      projectService.getProjectById(projectId).then(setProject);
    }
  }, [projectId]);

  if (usedCodes === null || (isEdit && project === undefined)) {
    return <LoadingState variant="page" label="Loading project form…" />;
  }

  if (isEdit && project === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Project not found"
        description={`No project exists with id “${projectId}”. It may have been removed.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/projects">Back to Projects</Link>
          </Button>
        }
      />
    );
  }

  const handleSubmit = async (values: ProjectFormValues) => {
    if (isEdit && project) {
      // Project Info payload only — `ProjectInfoUpdate` excludes departments,
      // disciplines, and team at the type level, so this save can never
      // replace project scope owned by the setup wizard steps.
      await projectService.updateProject(
        project.id,
        formValuesToProjectInfoUpdate(values)
      );
      router.push(`/projects/${project.id}`);
    } else {
      const created = await projectService.createProject(
        formValuesToProjectInput(values)
      );
      router.push(`/projects/${created.id}`);
    }
  };

  const handleSaveDraft = async (values: ProjectFormValues) => {
    if (isEdit && project) {
      // Keep the chosen status when the project already exists.
      await projectService.updateProject(
        project.id,
        formValuesToProjectInfoUpdate(values)
      );
    } else {
      const created = await projectService.createProject(
        formValuesToProjectInput(values, { asDraft: true })
      );
      // Continue editing the stored draft so later saves update it.
      router.replace(`/projects/${created.id}/edit`);
    }
  };

  const handleCancel = () => {
    router.push(isEdit && project ? `/projects/${project.id}` : "/projects");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Projects"
        title={isEdit ? `Edit ${project?.shortName ?? project?.name}` : "New Project"}
        description={
          isEdit
            ? "Update the project master data. Changes apply to future reports."
            : "Register a new project with its reporting configuration and scope."
        }
      />
      <ProjectForm
        projectId={project?.id}
        project={project}
        initialValues={
          isEdit && project
            ? projectToFormValues(project)
            : emptyProjectFormValues()
        }
        usedCodes={usedCodes}
        submitLabel={isEdit ? "Save Changes" : "Create Project"}
        onSubmit={handleSubmit}
        onSaveDraft={handleSaveDraft}
        onCancel={handleCancel}
      />
    </div>
  );
}
