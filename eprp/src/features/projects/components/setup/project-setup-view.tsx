"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, FolderX, Loader2, Lock, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
} from "@/components/shared";
import {
  getLocalizedProjectWorkflowStep,
  getProjectWorkflowStep,
  localizeProjectWorkflowStep,
  nextStepId,
  projectStepIndex,
  projectWorkflowHref,
  projectWorkflowSteps,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";
import { projectService } from "@/services/project-service";
import {
  emptyProjectFormValues,
  formValuesToProjectInfoUpdate,
  formValuesToProjectInput,
  projectToFormValues,
  type ProjectFormValues,
} from "../../schemas/project-form";
import { validateAssignments } from "../../assignment-rules";
import { useHierarchyTerms } from "../../use-hierarchy-terms";
import { useProjectWorkflow } from "../../use-project-workflow";
import { ProjectForm } from "../project-form";
import { ProjectWorkflowNav } from "../project-workflow-nav";
import { ProjectInfoWorkspace } from "./project-info-workspace";
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
  // Step 1 writes straight through this rather than through `draft` below —
  // it saves before any per-step edit state exists, and the workflow stepper
  // (rendered from `project`, not `draft`) must reflect that save immediately
  // instead of waiting for a navigation to refetch.
  const handleInfoSaved = React.useCallback(
    (updated: Project) => setProject(updated),
    []
  );
  const [usedCodes, setUsedCodes] = React.useState<string[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      projectService.getUsedCodes(projectId),
      projectId ? projectService.getProjectById(projectId) : Promise.resolve(null),
    ])
      .then(([codes, loaded]) => {
        if (cancelled) return;
        setLoadError(null);
        setUsedCodes(codes);
        setProject(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A failed or timed-out fetch must not strand the user on a spinner
        // or bounce them to another step — surface it with a Retry and stay
        // exactly where they are.
        setLoadError(
          error instanceof Error ? error.message : "Could not load this project."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  if (loadError !== null) {
    return (
      <ErrorState
        title="Project setup could not be loaded"
        description={`${loadError} Your unsaved edits on this step are kept — retry without leaving the page.`}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    );
  }

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
      onInfoSaved={handleInfoSaved}
    />
  );
}

/** Split out so the workflow hooks only run once loading has settled. */
function SetupShell({
  project,
  usedCodes,
  step,
  onInfoSaved,
}: {
  project: Project | null;
  usedCodes: string[];
  step: ProjectWorkflowStepId;
  onInfoSaved: (updated: Project) => void;
}) {
  const router = useRouter();
  // Edits accumulate here and are written on save, so a half-finished step
  // never lands in the database.
  const [draft, setDraft] = React.useState<Project | null>(project);
  const [saving, setSaving] = React.useState(false);

  const current = draft ?? project;
  const terms = useHierarchyTerms(current);
  const definition = localizeProjectWorkflowStep(
    getProjectWorkflowStep(step),
    terms
  );
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
      if (project) {
        // Project Info payload only — `ProjectInfoUpdate` excludes
        // departments, disciplines, and team at the type level, so this save
        // can never replace scope owned by Steps 2-5.
        const updated = await projectService.updateProject(
          project.id,
          formValuesToProjectInfoUpdate(values)
        );
        onInfoSaved(updated);
        toast.success("Project info saved");
        router.push(projectWorkflowHref(project.id, "departments"));
      } else {
        const created = await projectService.createProject(
          formValuesToProjectInput(values)
        );
        toast.success(`${created.code} created`);
        router.push(projectWorkflowHref(created.id, "departments"));
      }
    };

    const handleSaveDraft = async (values: ProjectFormValues) => {
      if (project) {
        const updated = await projectService.updateProject(
          project.id,
          formValuesToProjectInfoUpdate(values)
        );
        // Refresh the stepper immediately — otherwise it keeps showing the
        // pre-save completion count until the page is left and reopened.
        onInfoSaved(updated);
        // ProjectForm's own handleSaveDraft already toasts "Draft saved" on
        // success; toasting again here just doubled it.
      } else {
        const created = await projectService.createProject(
          formValuesToProjectInput(values, { asDraft: true })
        );
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
        {/* Scope management, available once the project exists. Keyed on
            `updatedAt` so a save re-seeds its draft from the reloaded record
            instead of holding stale rows. */}
        {project && (
          <ProjectInfoWorkspace
            key={project.updatedAt}
            project={project}
            context={context}
            onSaved={onInfoSaved}
          />
        )}
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

  /*
   * Every step's Save writes the whole scope, team included, so the reporting
   * lines are checked here rather than only on the Contacts step.
   *
   * Only an *edited* team is blocked. Data saved before these rules existed can
   * be invalid, and refusing every save would lock the user out of unrelated
   * work on departments or systems — while still never letting a new invalid
   * assignment be written.
   */
  const teamEdited = current.team !== project.team;
  const assignmentIssues = teamEdited ? validateAssignments(current) : [];

  const save = async (): Promise<boolean> => {
    if (assignmentIssues.length > 0) {
      toast.error(
        `Fix ${assignmentIssues.length} assignment problem(s) on the Contacts step before saving.`
      );
      return false;
    }
    setSaving(true);
    try {
      /*
       * NOT LOADED IS NOT EMPTY.
       *
       * This previously sent `team: current.team ?? []`. When the team had not
       * hydrated — or had been read back empty while the assignment columns
       * were still missing — that coerced "unknown" into "empty", and
       * `replaceTeam` deletes every team row before inserting, so an empty
       * array wipes the project's team. That is how PSM-001 lost its members
       * while its five project-responsibility rows survived (the delete is
       * scoped to the team role).
       *
       * `updateProject` uses key-presence semantics, so omitting a key leaves
       * that relation untouched. Only send a relation we actually hold.
       */
      const payload: Parameters<typeof projectService.updateProject>[1] = {
        departments: current.departments,
      };
      if (current.disciplines !== undefined) {
        payload.disciplines = current.disciplines;
      }
      if (current.team !== undefined) payload.team = current.team;
      if (current.delegations !== undefined) {
        payload.delegations = current.delegations;
      }

      const saved = await projectService.updateProject(project.id, payload);
      setDraft(saved);
      toast.success(`${getLocalizedProjectWorkflowStep(step, workflow.terms).label} saved`);
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
    const blocker = getLocalizedProjectWorkflowStep(status.blockedBy ?? "info", workflow.terms);
    return (
      <div className="space-y-6">
        {header}
        <ProjectWorkflowNav project={current} activeStep={step} />
        <SectionCard title="Step locked">
          <EmptyState
            icon={Lock}
            title={`Complete ${blocker.label} first`}
            description={`${
              getLocalizedProjectWorkflowStep(step, workflow.terms).label
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
          terms={workflow.terms}
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
          terms={workflow.terms}
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
          terms={workflow.terms}
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
