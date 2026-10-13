"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, FolderX, Lock } from "lucide-react";

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
import { useProjectAuthority } from "@/features/projects/use-project-authority";
import { ProjectForm } from "./project-form";
import type {
  ClassifyProjectInput,
  CorrectProjectTypeTarget,
} from "./project-classification";
import { canCorrectProjectType } from "../classification";
import { useCurrentIdentity } from "@/features/auth/use-current-identity";

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
  // Unconditional — hooks cannot sit behind the early returns below.
  const authority = useProjectAuthority(project ?? null);
  const identity = useCurrentIdentity();

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

  /*
   * Editing an existing project is `can_manage_project_setup()`, which the
   * database defines as `can_manage_project_operations()` — Project Control on
   * this project, or a global authority. Deliberately NOT the consolidator
   * pair: a Report Coordinator consolidates reports and holds no project
   * operations authority, and `isProjectControlPlanning` is the predicate that
   * says so.
   *
   * The Edit Project buttons were gated in the previous wave, but the ROUTE
   * was not: typing /projects/[id]/edit still rendered a live form whose save
   * RLS would refuse. Refused here instead, pointing at the read-only Overview.
   *
   * `/projects/new` (no `projectId`) is a different policy — `can_create_project`
   * — and is left alone.
   */
  // 2C.3E: an archived project is read-only for everyone — say so, rather
  // than that the viewer does not manage it.
  if (isEdit && authority.resolved && authority.archived) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={project?.code}
          title={project?.name ?? "Project"}
          description="Archived projects are read-only."
        />
        <EmptyState
          icon={Archive}
          title="This project is archived"
          description="Its details and setup can be viewed but not changed. Review it from the Project Overview."
          action={
            <Button variant="outline" asChild>
              <Link href={`/projects/${projectId}`}>Project Overview</Link>
            </Button>
          }
          className="py-8"
        />
      </div>
    );
  }
  if (isEdit && authority.resolved && !authority.canManageOperations) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={project?.code}
          title={project?.name ?? "Project"}
          description="Project details are managed by Project Control."
        />
        <EmptyState
          icon={Lock}
          title="You do not manage this project"
          description="Editing a project's details is limited to Project Control and platform administrators. You can still review this project in full from its Overview."
          action={
            <Button variant="outline" asChild>
              <Link href={`/projects/${projectId}`}>Project Overview</Link>
            </Button>
          }
          className="py-8"
        />
      </div>
    );
  }

  const handleSubmit = async (values: ProjectFormValues) => {
    if (isEdit && project) {
      // Project Info payload only — `ProjectInfoUpdate` excludes departments,
      // disciplines, and team at the type level, so this save can never
      // replace project scope owned by the setup wizard steps.
      const updated = await projectService.updateProject(
        project.id,
        formValuesToProjectInfoUpdate(values), project.updatedAt
      );
      router.push(`/projects/${project.id}`);
      return updated;
    } else {
      const created = await projectService.createProject(
        formValuesToProjectInput(values)
      );
      // Replace: Back must not return to an empty create form (2C.1b).
      router.replace(`/projects/${created.id}`);
      return created;
    }
  };

  const handleSaveDraft = async (values: ProjectFormValues) => {
    if (isEdit && project) {
      // Keep the chosen status when the project already exists.
      const updated = await projectService.updateProject(
        project.id,
        formValuesToProjectInfoUpdate(values), project.updatedAt
      );
      setProject(updated);
      return updated;
    } else {
      const created = await projectService.createProject(
        formValuesToProjectInput(values, { asDraft: true })
      );
      // Continue editing the stored draft so later saves update it.
      router.replace(`/projects/${created.id}/edit`);
      return created;
    }
  };

  /*
   * Positions-only save. `updateProject` acts on the keys it is given, so this
   * replaces project_positions and leaves every other Project Info column and
   * all project scope untouched.
   */
  const handleSavePositions = async (
    positions: ProjectFormValues["additionalPositions"]
  ): Promise<ProjectFormValues["additionalPositions"]> => {
    if (!project) return positions;
    const updated = await projectService.updateProject(project.id, {
      positions: positions
        .filter((position) => position.jobTitleId && position.contactId)
        .map((position, index) => ({
          id: position.id || undefined,
          jobTitleId: position.jobTitleId ?? "",
          contactId: position.contactId ?? "",
          notes: position.notes?.trim() || undefined,
          sortOrder: index,
        })),
    }, project.updatedAt);
    setProject(updated);
    // Hand back the stored rows so the form adopts their ids.
    return (updated.positions ?? []).map((position) => ({
      id: position.id ?? "",
      jobTitleId: position.jobTitleId,
      contactId: position.contactId,
      notes: position.notes ?? "",
    }));
  };

  /*
   * One-time classification of a legacy project (Phase 2C.1), saved on its
   * own; the database locks the family from then on.
   */
  const handleClassify = async (input: ClassifyProjectInput) => {
    if (!project) throw new Error("The project must exist before it is classified.");
    const updated = await projectService.updateProject(project.id, input, project.updatedAt);
    setProject(updated);
    return updated;
  };

  /*
   * System Admin only: the exceptional, audited Project Type correction.
   * Goes through the correction RPC alone — never a project update.
   */
  const handleCorrectProjectType = async (target: CorrectProjectTypeTarget) => {
    if (!project) throw new Error("The project must exist before it is corrected.");
    const corrected = await projectService.correctProjectType({
      projectId: project.id,
      expectedUpdatedAt: project.updatedAt,
      ...target,
    });
    setProject(corrected);
    return corrected;
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
        onSavePositions={project ? handleSavePositions : undefined}
        onClassify={
          isEdit && project && !project.structureFamily ? handleClassify : undefined
        }
        onCorrectProjectType={
          isEdit && canCorrectProjectType(identity, project)
            ? handleCorrectProjectType
            : undefined
        }
        onCancel={handleCancel}
      />
    </div>
  );
}
