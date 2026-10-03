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
  findSetupStep,
  firstSaveHref,
  getProjectWorkflowStep,
  localizeProjectWorkflowStep,
  nextStepId,
  previousStepId,
  projectStepIndex,
  projectWorkflowHref,
  resolveSetupSteps,
  setupFlowFor,
  setupStepLabel,
  STRUCTURE_PLACEHOLDER_MESSAGE,
  type ProjectStepStatus,
  type ProjectWorkflowStep,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";
import { projectService } from "@/services/project-service";
import { saveProjectSetupRelation } from "@/services/project-setup-save";
import {
  isSetupDraftDirty,
  reconcileSetupSave,
  relationForSetupStep,
  type SetupRelation,
} from "../../setup-save";
import {
  emptyProjectFormValues,
  formValuesToProjectInfoUpdate,
  formValuesToProjectInput,
  projectToFormValues,
  type ProjectFormValues,
} from "../../schemas/project-form";
import {
  duplicateManagerIssues,
  validateAssignments,
} from "../../assignment-rules";
import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { useHierarchyTerms } from "../../use-hierarchy-terms";
import { useProjectAuthority } from "../../use-project-authority";
import { useProjectWorkflow } from "../../use-project-workflow";
import { ProjectForm } from "../project-form";
import type {
  ClassifyProjectInput,
  CorrectProjectTypeTarget,
} from "../project-classification";
import { canCorrectProjectType } from "../../classification";
import { DraftWorkflowNav, ProjectWorkflowNav } from "../project-workflow-nav";
import { ProjectInfoWorkspace } from "./project-info-workspace";
import { SetupChecklist } from "./setup-checklist";
import { SetupStepContacts } from "./setup-step-contacts";
import { SetupStepDepartments } from "./setup-step-departments";
import { SetupStepDisciplines } from "./setup-step-disciplines";
import { SetupStepReview } from "./setup-step-review";
import { SetupStepTeam } from "./setup-step-team";
import { SetupStepSystems } from "./setup-step-systems";
import type { Project } from "@/types";
import type { ProjectLinkContext } from "../../project-link-context";

export interface ProjectSetupViewProps {
  /** Absent on /projects/new — the project is created by the first step. */
  projectId?: string;
  step: ProjectWorkflowStepId;
  /** Scope item to restore when returning from Add/Edit Contact. */
  initialDisciplineId?: string;
}

/**
 * The guided project setup wizard.
 *
 * Each step saves before it advances, and the project id created by step 1
 * is carried in the URL for every step after it, so the wizard can be left
 * and resumed at any point.
 */
export function ProjectSetupView({
  projectId,
  step,
  initialDisciplineId,
}: ProjectSetupViewProps) {
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
  // Unconditional — hooks cannot run behind the early returns below. Stays
  // unresolved (all false) until both the project and the identity settle, so
  // the wizard is never rendered on an unknown answer.
  const authority = useProjectAuthority(project ?? null);
  // Creation is decided from identity alone — there is no project to scope by.
  const identity = useCurrentIdentity();

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

  /*
   * CREATE mode (`/projects/new`, no `projectId`).
   *
   * The gate below is per-project and cannot answer this case: there is no
   * project yet, so `useProjectAuthority` stays unresolved and every check
   * against it passes by default. That is exactly how a Viewer typing
   * /projects/new still reached a live wizard with Save Draft and
   * Create & Continue.
   *
   * Creation is its own policy — `projects_insert` -> `can_create_project()`
   * -> `has_global_operational_authority()` — so it is answered from identity
   * alone. Held while identity is still loading so no form flashes first.
   */
  if (!projectId && !identity.resolved) {
    return <LoadingState variant="page" label="Loading project setup…" />;
  }

  if (!projectId && !identity.isGlobalAuthority) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Projects"
          title="New Project"
          description="Projects are created by Project Control."
        />
        <SectionCard title="Created by Project Control">
          <EmptyState
            icon={Lock}
            title="You cannot create projects"
            description="Creating a project is limited to Project Control and platform administrators. You can open any project you are assigned to from the Projects list."
            action={
              <Button variant="outline" asChild>
                <Link href="/projects">Back to Projects</Link>
              </Button>
            }
            className="py-8"
          />
        </SectionCard>
      </div>
    );
  }

  /*
   * Project Setup is `can_manage_project_setup()`, which the database defines
   * as `can_manage_project_operations()` — Project Control on this project, or
   * a global authority. Nothing here checked that, so a Department User was
   * shown the whole wizard with live Save controls and got a refusal from RLS
   * on every one of them.
   *
   * Refused as a whole rather than field by field: the wizard has no read-only
   * mode, and its steps mutate a shared draft. The project's scope stays fully
   * readable through the project sections, which is where a non-manager is
   * pointed. `/projects/new` (no `projectId`) is governed by `can_create_project`
   * and is left to the existing create path.
   */
  if (projectId && authority.resolved && !authority.canManageOperations) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={project?.code}
          title="Project Setup"
          description="Guided setup for this project's scope."
        />
        <SectionCard title="Managed by Project Control">
          <EmptyState
            icon={Lock}
            title="You do not manage this project's setup"
            description="Project Setup is limited to Project Control and platform administrators. You can still review this project's departments, systems, scope items, contacts and team from the project sidebar."
            action={
              <Button variant="outline" asChild>
                <Link href={`/projects/${projectId}`}>Back to Project</Link>
              </Button>
            }
            className="py-8"
          />
        </SectionCard>
      </div>
    );
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
      initialDisciplineId={initialDisciplineId}
      onInfoSaved={handleInfoSaved}
    />
  );
}

/** Split out so the workflow hooks only run once loading has settled. */
function SetupShell({
  project,
  usedCodes,
  step,
  initialDisciplineId,
  onInfoSaved,
}: {
  project: Project | null;
  usedCodes: string[];
  step: ProjectWorkflowStepId;
  initialDisciplineId?: string;
  onInfoSaved: (updated: Project) => void;
}) {
  const router = useRouter();
  // Presentation only: who may be offered "Correct Project Type".
  const identity = useCurrentIdentity();
  // Edits accumulate here and are written on save, so a half-finished step
  // never lands in the database.
  const [draft, setDraft] = React.useState<Project | null>(project);
  const [savedBaseline, setSavedBaseline] = React.useState<Project | null>(project);
  const [saving, setSaving] = React.useState(false);

  const current = draft ?? savedBaseline;
  const terms = useHierarchyTerms(current);
  // This project's own setup steps (Phase 2C.1b): PSM, Other or legacy, in
  // the project's wording. A new project's steps follow the type chosen in
  // the form, which the draft tracker resolves from the live values.
  const structureFamily = current?.structureFamily;
  const saved = Boolean(project);
  const steps = React.useMemo(
    () =>
      resolveSetupSteps({ structureFamily, saved }).map((candidate) =>
        localizeProjectWorkflowStep(candidate, terms)
      ),
    [structureFamily, saved, terms]
  );
  const inFlow = projectStepIndex(step, steps) >= 0;
  const definition =
    findSetupStep(steps, step) ??
    localizeProjectWorkflowStep(getProjectWorkflowStep(step), terms);
  const next = nextStepId(step, steps);
  const previous = previousStepId(step, steps);

  // The trail handed to every linked record on this step. Steps that add a
  // child record narrow `sourceType`/`parentId` further before using it.
  const context: ProjectLinkContext = {
    projectId: project?.id,
    sourceType: "project",
    parentId: project?.id,
    currentStep: step,
    returnTo: projectWorkflowHref(project?.id, step),
  };
  const dirty = Boolean(draft && savedBaseline && isSetupDraftDirty(draft, savedBaseline));

  const acceptInfoSaved = (updated: Project) => {
    const previousBaseline = savedBaseline;
    setSavedBaseline(updated);
    setDraft((latest) =>
      latest && previousBaseline
        ? reconcileSetupSave(previousBaseline, previousBaseline, latest, updated, [])
        : updated
    );
    onInfoSaved(updated);
  };

  const acceptStepSaved = (
    submitted: Project,
    saved: Project,
    relation: SetupRelation
  ) => {
    if (!savedBaseline) return;
    const previousBaseline = savedBaseline;
    setSavedBaseline(saved);
    setDraft((latest) =>
      latest ? reconcileSetupSave(previousBaseline, submitted, latest, saved, relation) : saved
    );
    onInfoSaved(saved);
  };

  const applyDraft = (patch: Partial<Project>) =>
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  const header = (
    <PageHeader
      // Progress lives in the workflow tracker below, not in a step counter.
      eyebrow={project ? project.code : "New Project · Not saved yet"}
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
          formValuesToProjectInfoUpdate(values), savedBaseline?.updatedAt ?? project.updatedAt
        );
        acceptInfoSaved(updated);
        toast.success("Project info saved");
        // The next step of THIS project's setup — Departments for PSM and
        // legacy, the Structure placeholder for Other.
        router.push(projectWorkflowHref(project.id, next ?? "info"));
      } else {
        const created = await projectService.createProject(
          formValuesToProjectInput(values)
        );
        toast.success(`${created.code} created`);
        // Replace, not push: Back must never return to an empty
        // /projects/new now that the project exists.
        router.replace(firstSaveHref(created.id, values.structureFamily, "create"));
      }
    };

    /*
     * Positions-only save. `updateProject` acts on the keys it is given, so
     * Steps 2-6 scope and the rest of Project Info are untouched. `onInfoSaved`
     * refreshes the stepper; ProjectForm keeps its own state, so unsaved edits
     * elsewhere on the form survive.
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
      }, savedBaseline?.updatedAt ?? project.updatedAt);
      acceptInfoSaved(updated);
      // Hand back the stored rows so the form adopts their ids.
      return (updated.positions ?? []).map((position) => ({
        id: position.id ?? "",
        jobTitleId: position.jobTitleId,
        contactId: position.contactId,
        notes: position.notes ?? "",
      }));
    };

    /*
     * One-time classification of a legacy project (Phase 2C.1). Saved on its
     * own, so nothing else on the form is submitted with it; the database
     * locks the family from then on.
     */
    const handleClassify = async (input: ClassifyProjectInput) => {
      if (!project) throw new Error("The project must exist before it is classified.");
      const updated = await projectService.updateProject(
        project.id,
        input,
        savedBaseline?.updatedAt ?? project.updatedAt
      );
      acceptInfoSaved(updated);
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
        expectedUpdatedAt: savedBaseline?.updatedAt ?? project.updatedAt,
        ...target,
      });
      acceptInfoSaved(corrected);
      return corrected;
    };

    const handleSaveDraft = async (values: ProjectFormValues) => {
      if (project) {
        const updated = await projectService.updateProject(
          project.id,
          formValuesToProjectInfoUpdate(values), savedBaseline?.updatedAt ?? project.updatedAt
        );
        // Refresh the stepper immediately — otherwise it keeps showing the
        // pre-save completion count until the page is left and reopened.
        acceptInfoSaved(updated);
        // ProjectForm's own handleSaveDraft already toasts "Draft saved" on
        // success; toasting again here just doubled it.
      } else {
        const created = await projectService.createProject(
          formValuesToProjectInput(values, { asDraft: true })
        );
        // Keep editing the stored draft so the id carries forward; replace so
        // Back never returns to an empty /projects/new.
        router.replace(firstSaveHref(created.id, values.structureFamily, "draft"));
      }
    };

    return (
      <div className="space-y-6">
        {header}
        {project && <ProjectWorkflowNav project={project} activeStep={step} />}
        <ProjectForm
          // New project: the tracker is driven by the live form values and
          // stays visible on the Project Type screen as well.
          renderHeader={
            project
              ? undefined
              : (values) => <DraftWorkflowNav draft={formValuesToProjectInput(values)} />
          }
          projectId={project?.id}
          project={project}
          // The wizard's own step trail, so Linked Scope returns here rather
          // than to the generic Project Edit page.
          linkContext={context}
          initialValues={
            project ? projectToFormValues(project) : emptyProjectFormValues()
          }
          usedCodes={usedCodes}
          submitLabel={
            project ? "Save & Continue" : "Create & Continue"
          }
          onSubmit={handleSubmit}
          onSaveDraft={handleSaveDraft}
          onSavePositions={project ? handleSavePositions : undefined}
          onClassify={
            savedBaseline && !savedBaseline.structureFamily ? handleClassify : undefined
          }
          onCorrectProjectType={
            canCorrectProjectType(identity, savedBaseline) ? handleCorrectProjectType : undefined
          }
          onCancel={() =>
            router.push(project ? `/projects/${project.id}` : "/projects")
          }
        />
        {/* Preserve the editor across saves; it reconciles the new baseline
            while retaining unrelated and in-flight edits. Not for an Other
            project: its structure is not Departments → Systems, and is
            configured in the next setup phase. */}
        {project && setupFlowFor({ structureFamily, saved }) !== "other" && (
          <ProjectInfoWorkspace
            key={project.id}
            project={project}
            context={context}
            onSaved={acceptInfoSaved}
          />
        )}
      </div>
    );
  }

  /* --------------------- Steps 2-6 need a saved project -------------------- */

  if (!savedBaseline || !current) {
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

  // A step this project's setup does not have — e.g. /setup/systems on an
  // Other project, which never uses the Departments → Systems structure.
  if (!inFlow) {
    const first = steps[0];
    return (
      <div className="space-y-6">
        {header}
        <ProjectWorkflowNav project={current} />
        <SectionCard title="Not part of this project's setup">
          <EmptyState
            icon={Lock}
            title={`${definition.label} is not used by this project`}
            description="This project's Project Type has its own setup steps. Continue from the workflow above."
            action={
              <Button asChild>
                <Link href={projectWorkflowHref(savedBaseline.id, first.id)}>
                  Go to {first.label}
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
    <LoadedSteps
      project={savedBaseline}
      current={current}
      steps={steps}
      step={step}
      initialDisciplineId={initialDisciplineId}
      dirty={dirty}
      saving={saving}
      setSaving={setSaving}
      onSaved={acceptStepSaved}
      applyDraft={applyDraft}
      context={context}
      header={header}
      previousStep={previous}
      nextStep={next}
    />
  );
}

function LoadedSteps({
  project,
  current,
  steps,
  step,
  initialDisciplineId,
  dirty,
  saving,
  setSaving,
  onSaved,
  applyDraft,
  context,
  header,
  previousStep,
  nextStep,
}: {
  project: Project;
  current: Project;
  /** This project's resolved setup steps, in its wording. */
  steps: ProjectWorkflowStep[];
  step: ProjectWorkflowStepId;
  initialDisciplineId?: string;
  dirty: boolean;
  saving: boolean;
  setSaving: (value: boolean) => void;
  onSaved: (submitted: Project, saved: Project, relation: SetupRelation) => void;
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
  // Present for every step the caller routes here: unknown steps are
  // refused before LoadedSteps is reached (see `inFlow`).
  const status = workflow.byId[step] as ProjectStepStatus;
  const stepLabel = (id: ProjectWorkflowStepId) => setupStepLabel(steps, id);
  const latestDraft = React.useRef(current);
  React.useEffect(() => { latestDraft.current = current; }, [current]);

  /* Only an edited team is validated here; older saved assignments may be
   * imperfect without blocking an unrelated setup step. */
  const teamEdited = current.team !== project.team;
  /*
   * Two Department Managers in one department blocks EVERY save, edited team
   * or not. It is a hard integrity rule with a one-click fix in the Department
   * Manager selector, so unlike the rest it is not something the user can be
   * left sitting on. `validateAssignments` already reports it, so it is only
   * added separately on the un-edited path.
   */
  const assignmentIssues = teamEdited
    ? validateAssignments(current)
    : duplicateManagerIssues(current);

  const save = async (): Promise<boolean> => {
    const relation = relationForSetupStep(step);
    if (!relation) {
      if (dirty) toast.error("Save edits on their own setup step before continuing.");
      return !dirty;
    }
    if (JSON.stringify(current[relation]) === JSON.stringify(project[relation])) {
      if (dirty) toast.error("Save edits on their own setup step before continuing.");
      return !dirty;
    }
    if (assignmentIssues.length > 0) {
      // Name the department and say what is actually wrong. The old message
      // gave a count and left the user to find the problem themselves.
      const [first, ...rest] = assignmentIssues;
      toast.error(
        `${workflow.departmentName(first.departmentId)}: ${first.message}`,
        rest.length > 0
          ? {
              description: `${rest.length} further assignment problem(s) to fix on the Contacts step.`,
            }
          : undefined
      );
      return false;
    }
    setSaving(true);
    try {
      const saved = await saveProjectSetupRelation(project, relation, current[relation]);
      onSaved(current, saved, relation);
      toast.success(`${stepLabel(step)} saved`);
      // Stay on the editor if unrelated edits or edits during this save remain.
      return !isSetupDraftDirty(
        reconcileSetupSave(project, current, latestDraft.current, saved, relation), saved
      );
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

  // The Other "Project Structure" placeholder: shown in the workflow, but its
  // capability arrives in the next setup phase — nothing to edit or save.
  if (!status.available) {
    return (
      <div className="space-y-6">
        {header}
        <ProjectWorkflowNav project={current} activeStep={step} />
        <SectionCard title={stepLabel(step)}>
          <EmptyState
            icon={Lock}
            title="Not available yet"
            description={STRUCTURE_PLACEHOLDER_MESSAGE}
            action={
              previousStep ? (
                <Button variant="outline" asChild>
                  <Link href={projectWorkflowHref(project.id, previousStep)}>
                    <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                    Back to {stepLabel(previousStep)}
                  </Link>
                </Button>
              ) : undefined
            }
            className="py-8"
          />
        </SectionCard>
      </div>
    );
  }

  // A locked step is unreachable until everything before it is done.
  if (!status.unlocked) {
    const blockerId = status.blockedBy ?? "info";
    const blockerAvailable = workflow.byId[blockerId]?.available !== false;
    return (
      <div className="space-y-6">
        {header}
        <ProjectWorkflowNav project={current} activeStep={step} />
        <SectionCard title="Step locked">
          <EmptyState
            icon={Lock}
            title={
              blockerAvailable
                ? `Complete ${stepLabel(blockerId)} first`
                : `${stepLabel(blockerId)} comes first`
            }
            description={
              blockerAvailable
                ? `${stepLabel(step)} unlocks once every earlier step is finished.`
                : `${stepLabel(step)} unlocks after ${stepLabel(blockerId)}. ${STRUCTURE_PLACEHOLDER_MESSAGE}`
            }
            action={
              <Button asChild>
                <Link href={projectWorkflowHref(project.id, blockerId)}>
                  Go to {stepLabel(blockerId)}
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
          departments={workflow.departments}
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
          savedProject={project}
          context={context}
          contacts={workflow.contacts}
          disciplines={workflow.disciplines}
          departmentName={workflow.departmentName}
          onDraftChange={applyDraft}
          terms={workflow.terms}
          initialDisciplineId={initialDisciplineId}
        />
      )}
      {step === "team" && (
        <SetupStepTeam
          project={current}
          contacts={workflow.contacts}
          disciplines={workflow.disciplines}
          departmentName={workflow.departmentName}
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
          steps={steps}
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
