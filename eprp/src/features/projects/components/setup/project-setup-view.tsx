"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, FolderX, Loader2, Lock, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
} from "@/components/shared";
import {
  getProjectWorkflowStep,
  nextStepId,
  projectStepIndex,
  projectWorkflowHref,
  projectWorkflowSteps,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";
import { projectService } from "@/services/project-service";
import {
  emptyProjectFormValues,
  formValuesToProjectInput,
  projectToFormValues,
  type ProjectFormValues,
} from "../../schemas/project-form";
import { useProjectWorkflow } from "../../use-project-workflow";
import { ProjectForm } from "../project-form";
import { ProjectWorkflowNav } from "../project-workflow-nav";
import { SetupChecklist } from "./setup-checklist";
import { SetupStepContacts } from "./setup-step-contacts";
import { SetupStepDepartments } from "./setup-step-departments";
import { SetupStepDisciplines } from "./setup-step-disciplines";
import { SetupStepReview } from "./setup-step-review";
import { SetupStepSystems } from "./setup-step-systems";
import type { Project } from "@/types";
import type { ProjectLinkContext } from "../../project-link-context";

export interface ProjectSetupViewProps {
  /** Absent on /projects/new — the project is created by the first step. */
  projectId?: string;
  step: ProjectWorkflowStepId;
}

/**
 * The guided project setup wizard.
 *
 * Each step saves before it advances, and the project id created by step 1
 * is carried in the URL for every step after it, so the wizard can be left
 * and resumed at any point.
 */
export function ProjectSetupView({ projectId, step }: ProjectSetupViewProps) {
  const [project, setProject] = React.useState<Project | null | undefined>(
    projectId ? undefined : null
  );
  const [usedCodes, setUsedCodes] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    projectService.getUsedCodes(projectId).then(setUsedCodes);
    if (projectId) projectService.getProjectById(projectId).then(setProject);
  }, [projectId]);

  if (usedCodes === null || project === undefined) {
    return <LoadingState variant="page" label="Loading project setup…" />;
  }

  if (projectId && project === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Project not found"
        description={`No project exists with id “${projectId}”.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/projects">Back to Projects</Link>
          </Button>
        }
      />
    );
  }

  return (
    <SetupShell
      key={project?.id ?? "new"}
      project={project}
      usedCodes={usedCodes}
      step={step}
    />
  );
}

/** Split out so the workflow hooks only run once loading has settled. */
function SetupShell({
  project,
  usedCodes,
  step,
}: {
  project: Project | null;
  usedCodes: string[];
  step: ProjectWorkflowStepId;
}) {
  const router = useRouter();
  // Edits accumulate here and are written on save, so a half-finished step
  // never lands in the database.
  const [draft, setDraft] = React.useState<Project | null>(project);
  const [saving, setSaving] = React.useState(false);

  const current = draft ?? project;
  const definition = getProjectWorkflowStep(step);
  const index = projectStepIndex(step);
  const next = nextStepId(step);
  const previous = projectWorkflowSteps[index - 1];

  // The trail handed to every linked record on this step. Steps that add a
  // child record narrow `sourceType`/`parentId` further before using it.
  const context: ProjectLinkContext = {
    projectId: project?.id,
    sourceType: "project",
    parentId: project?.id,
    currentStep: step,
    returnTo: projectWorkflowHref(project?.id, step),
  };
  const dirty = draft !== project && draft !== null;

  const applyDraft = (patch: Partial<Project>) =>
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  const header = (
    <PageHeader
      eyebrow={
        project
          ? `${project.code} · Step ${index + 1} of ${projectWorkflowSteps.length}`
          : `Step ${index + 1} of ${projectWorkflowSteps.length}`
      }
      title={definition.label}
      description={definition.description}
      actions={
        <Button variant="outline" asChild>
          <Link href={project ? `/projects/${project.id}` : "/projects"}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            {project ? "Back to Project" : "Back to Projects"}
          </Link>
        </Button>
      }
    />
  );

  /* ------------------------- Step 1: create or edit ------------------------ */

  if (step === "info") {
    const handleSubmit = async (values: ProjectFormValues) => {
      const input = formValuesToProjectInput(values);
      if (project) {
        await projectService.updateProject(project.id, input);
        toast.success("Project info saved");
        router.push(projectWorkflowHref(project.id, "departments"));
      } else {
        const created = await projectService.createProject(input);
        toast.success(`${created.code} created`);
        router.push(projectWorkflowHref(created.id, "departments"));
      }
    };

    const handleSaveDraft = async (values: ProjectFormValues) => {
      const input = formValuesToProjectInput(values, { asDraft: !project });
      if (project) {
        await projectService.updateProject(project.id, input);
        toast.success("Draft saved");
      } else {
        const created = await projectService.createProject(input);
        toast.success("Draft saved");
        // Keep editing the stored draft so the id carries forward.
        router.replace(projectWorkflowHref(created.id, "info"));
      }
    };

    return (
      <div className="space-y-6">
        {header}
        {project && <ProjectWorkflowNav project={project} activeStep={step} />}
        <ProjectForm
          projectId={project?.id}
        project={project}
          initialValues={
            project ? projectToFormValues(project) : emptyProjectFormValues()
          }
          usedCodes={usedCodes}
          submitLabel={
            project ? "Save & Continue" : "Create & Continue"
          }
          onSubmit={handleSubmit}
          onSaveDraft={handleSaveDraft}
          onCancel={() =>
            router.push(project ? `/projects/${project.id}` : "/projects")
          }
        />
      </div>
    );
  }

  /* --------------------- Steps 2-6 need a saved project -------------------- */

  if (!project || !current) {
    return (
      <div className="space-y-6">
        {header}
        <SectionCard title="Start with Project Info">
          <EmptyState
            icon={Lock}
            title="No project yet"
            description="Create the project on the first step; the remaining steps attach to it."
            action={
              <Button asChild>
                <Link href="/projects/new">Go to Project Info</Link>
              </Button>
            }
            className="py-8"
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <LoadedSteps
      project={project}
      current={current}
      step={step}
      dirty={dirty}
      saving={saving}
      setSaving={setSaving}
      setDraft={setDraft}
      applyDraft={applyDraft}
      context={context}
      header={header}
      previousStep={previous?.id}
      nextStep={next}
    />
  );
}

function LoadedSteps({
  project,
  current,
  step,
  dirty,
  saving,
  setSaving,
  setDraft,
  applyDraft,
  context,
  header,
  previousStep,
  nextStep,
}: {
  project: Project;
  current: Project;
  step: ProjectWorkflowStepId;
  dirty: boolean;
  saving: boolean;
  setSaving: (value: boolean) => void;
  setDraft: React.Dispatch<React.SetStateAction<Project | null>>;
  applyDraft: (patch: Partial<Project>) => void;
  context: ProjectLinkContext;
  header: React.ReactNode;
  previousStep?: ProjectWorkflowStepId;
  nextStep?: ProjectWorkflowStepId;
}) {
  const router = useRouter();
  // Progress is measured against the draft, so the checklist and the stepper
  // react as the user edits rather than only after a save.
  const workflow = useProjectWorkflow(current);
  const status = workflow.byId[step];

  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      const saved = await projectService.updateProject(project.id, {
        departments: current.departments,
        disciplines: current.disciplines ?? [],
        team: current.team ?? [],
      });
      setDraft(saved);
      toast.success(`${getProjectWorkflowStep(step).label} saved`);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save this step"
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndContinue = async () => {
    if (!(await save())) return;
    if (nextStep) router.push(projectWorkflowHref(project.id, nextStep));
  };

  const finish = async () => {
    if (!(await save())) return;
    router.push(`/projects/${project.id}`);
  };

  // A locked step is unreachable until everything before it is done.
  if (!status.unlocked) {
    const blocker = getProjectWorkflowStep(status.blockedBy ?? "info");
    return (
      <div className="space-y-6">
        {header}
        <ProjectWorkflowNav project={current} activeStep={step} />
        <SectionCard title="Step locked">
          <EmptyState
            icon={Lock}
            title={`Complete ${blocker.label} first`}
            description={`${
              getProjectWorkflowStep(step).label
            } unlocks once every earlier step is finished.`}
            action={
              <Button asChild>
                <Link href={projectWorkflowHref(project.id, blocker.id)}>
                  Go to {blocker.label}
                </Link>
              </Button>
            }
            className="py-8"
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <ProjectWorkflowNav project={current} activeStep={step} />

      {step === "departments" && (
        <SetupStepDepartments
          project={current}
          context={context}
          departmentName={workflow.departmentName}
          onDraftChange={applyDraft}
        />
      )}
      {step === "systems" && (
        <SetupStepSystems
          project={current}
          context={context}
          systems={workflow.systems}
          departmentName={workflow.departmentName}
          onDraftChange={applyDraft}
        />
      )}
      {step === "disciplines" && (
        <SetupStepDisciplines
          project={current}
          context={context}
          disciplines={workflow.disciplines}
          departmentName={workflow.departmentName}
          onDraftChange={applyDraft}
        />
      )}
      {step === "contacts" && (
        <SetupStepContacts
          project={current}
          context={context}
          contacts={workflow.contacts}
          disciplines={workflow.disciplines}
          departmentName={workflow.departmentName}
          onDraftChange={applyDraft}
        />
      )}
      {step === "review" && (
        <SetupStepReview
          project={current}
          statuses={workflow.statuses}
          percent={workflow.percent}
          contacts={workflow.contacts}
          disciplines={workflow.disciplines}
          departmentName={workflow.departmentName}
        />
      )}

      {step !== "review" && <SetupChecklist status={status} />}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
        {dirty && (
          <p className="text-xs text-muted-foreground">Unsaved changes</p>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {previousStep && (
            <Button variant="outline" asChild disabled={saving}>
              <Link href={projectWorkflowHref(project.id, previousStep)}>
                <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                Back
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={save} disabled={saving || !dirty}>
            <Save data-icon="inline-start" aria-hidden="true" />
            Save
          </Button>
          {step === "review" ? (
            <Button onClick={finish} disabled={saving}>
              {saving ? (
                <Loader2
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : null}
              Finish setup
            </Button>
          ) : (
            <Button
              onClick={saveAndContinue}
              disabled={saving || !status.complete}
              title={
                status.complete
                  ? undefined
                  : `${status.missing.length} requirement(s) outstanding`
              }
            >
              {saving ? (
                <Loader2
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : status.complete ? null : (
                <Lock data-icon="inline-start" aria-hidden="true" />
              )}
              Save &amp; Continue
              {!status.complete && ` · ${status.passedCount}/${status.total}`}
              {status.complete && (
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
