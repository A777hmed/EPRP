"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, FolderX, Loader2, Lock, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { BackdropRegion } from "@/components/backdrop";
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
  NEXT_PHASE_MESSAGE,
  type ProjectStepStatus,
  type ProjectWorkflowStep,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";
import { projectService } from "@/services/project-service";
import { saveProjectSetupRelation } from "@/services/project-setup-save";
import {
  isSetupDraftDirty,
  PROJECT_SETUP_ARCHIVED_MESSAGE,
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
  teamMembershipIssues,
  validateAssignments,
} from "../../assignment-rules";
import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { canEditPeopleMaster } from "@/features/auth/people-master-authority";
import { useMasterData } from "@/features/master-data";
import { useHierarchyTerms } from "../../use-hierarchy-terms";
import { useProjectAuthority } from "../../use-project-authority";
import { useProjectWorkflow } from "../../use-project-workflow";
import {
  useProjectStructure,
  type ProjectStructureState,
} from "../../use-project-structure";
import { ProjectForm, type ProjectFormGovernance } from "../project-form";
import { useSetupGovernance, type SetupGovernanceState } from "../../use-setup-governance";
import { pendingAmendmentsByField, type AmendmentViewer } from "../../setup-amendments";
import { PsmScopeGovernancePanel, type PsmScopeRequest } from "../governance/psm-scope-governance-panel";
import { departmentTarget, pendingStructureTargets } from "../../structure-amendments";
import { ControlledSetupBanner } from "../governance/setup-governance-ui";
import { SetupAmendmentsPanel } from "../governance/setup-amendments-panel";
import type {
  ClassifyProjectInput,
  CorrectProjectTypeTarget,
} from "../project-classification";
import { canCorrectProjectType } from "../../classification";
import { DraftWorkflowNav, ProjectWorkflowNav } from "../project-workflow-nav";
import { ProjectInfoWorkspace } from "./project-info-workspace";
import { ArchivedSetupNotice } from "./archived-setup-notice";
import { OtherProjectResponsibilities } from "./other-project-responsibilities";
import { SetupChecklist } from "./setup-checklist";
import { SetupStepContacts } from "./setup-step-contacts";
import { SetupStepDepartments } from "./setup-step-departments";
import { SetupStepDisciplines } from "./setup-step-disciplines";
import { SetupStepReview } from "./setup-step-review";
import { SetupStepTeam } from "./setup-step-team";
import { SetupStepSystems } from "./setup-step-systems";
import { ProjectTeamWorkspace } from "./project-team-workspace";
import { ProjectStructureStep } from "./structure/project-structure-step";
import type { Client, Project } from "@/types";
import type { ProjectLinkContext } from "../../project-link-context";

export interface ProjectSetupViewProps {
  /** Absent on /projects/new — the project is created by the first step. */
  projectId?: string;
  step: ProjectWorkflowStepId;
  /** Scope item to restore when returning from Add/Edit Contact. */
  initialDisciplineId?: string;
  /** A Project Setup amendment to focus (from a notification). */
  focusAmendmentId?: string;
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
  focusAmendmentId,
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
   *
   * 2C.3E: an ARCHIVED project is managed by nobody, yet its setup managers
   * still see the wizard — read-only (`readOnly` below), never refused as if
   * they had no authority, and never with live controls.
   */
  if (projectId && authority.resolved && !authority.holdsOperations) {
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
      focusAmendmentId={focusAmendmentId}
      onInfoSaved={handleInfoSaved}
      canManage={authority.resolved && authority.canManageOperations}
      readOnly={authority.resolved && authority.archived}
    />
  );
}

/** Split out so the workflow hooks only run once loading has settled. */
function SetupShell({
  project,
  usedCodes,
  step,
  initialDisciplineId,
  focusAmendmentId,
  onInfoSaved,
  canManage,
  readOnly,
}: {
  project: Project | null;
  usedCodes: string[];
  step: ProjectWorkflowStepId;
  initialDisciplineId?: string;
  focusAmendmentId?: string;
  onInfoSaved: (updated: Project) => void;
  /** Project Setup authority, already resolved by the page. */
  canManage: boolean;
  /**
   * 2C.3E: an archived project — every step stays visible, nothing is saved.
   * Controls are disabled (a disabled fieldset) or not offered; the services
   * and the database refuse any write that gets through regardless.
   */
  readOnly: boolean;
}) {
  const router = useRouter();
  // Presentation only: who may be offered "Correct Project Type".
  const identity = useCurrentIdentity();
  // 13.9B: the database-derived control state and this project's amendments.
  const governanceState = useSetupGovernance(project?.id);
  // Bumped after every amendment decision so the form re-reads what is stored.
  const [decisionRevision, setDecisionRevision] = React.useState(0);
  const pendingByField = React.useMemo(
    () => pendingAmendmentsByField(governanceState.amendments),
    [governanceState.amendments]
  );
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

  // An Other project's structure (2C.1c), loaded ONCE here for every view of
  // this page: the stepper, the Project Structure step and Review. Keyed by
  // the project (this shell is remounted per project), never loaded for PSM
  // or legacy projects.
  const isOther = setupFlowFor({ structureFamily, saved }) === "other";
  const structureState = useProjectStructure(isOther && project ? project.id : undefined);

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

  // A structure write advanced the shared project version: take the fresh
  // project as the baseline (unsaved edits elsewhere are reconciled, not lost).
  const acceptLatest = React.useRef(acceptInfoSaved);
  React.useEffect(() => {
    acceptLatest.current = acceptInfoSaved;
  });
  const projectId = project?.id;
  const reloadProject = React.useCallback(() => {
    if (!projectId) return;
    projectService
      .getProjectById(projectId)
      .then((fresh) => {
        if (fresh) acceptLatest.current(fresh);
      })
      .catch(() => {
        // The stepper reads the structure itself; the project catches up on
        // the next load. Nothing is shown half-updated.
      });
  }, [projectId]);

  // 13.11 UAT: an amendment decided elsewhere (another tab, another person)
  // arrives with the governance re-read on return; the stored project and the
  // planning approach are then re-read too, exactly as after a local decision.
  const amendmentStates = `${projectId ?? ""}#${governanceState.amendments
    .map((amendment) => `${amendment.id}:${amendment.status}`)
    .join("|")}`;
  const seenAmendmentStates = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!projectId || governanceState.loadedFor !== projectId) return;
    const previous = seenAmendmentStates.current;
    seenAmendmentStates.current = amendmentStates;
    // The first read for a project is its baseline, not a change.
    if (previous === null || !previous.startsWith(`${projectId}#`) || previous === amendmentStates) return;
    reloadProject();
    setDecisionRevision((revision) => revision + 1);
  }, [amendmentStates, governanceState.loadedFor, projectId, reloadProject]);

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

  // 2C.3E: every Project Information save handler refuses on an archived
  // project, whatever the screen offers.
  const assertWritable = () => {
    if (readOnly) throw new Error(PROJECT_SETUP_ARCHIVED_MESSAGE);
  };

  // The header is the only Setup region with a backdrop — never the step's
  // forms, trees or editors below it.
  const header = (
    <BackdropRegion variant="planning" strength="subtle">
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
    </BackdropRegion>
  );

  /* ------------------------- Step 1: create or edit ------------------------ */

  if (step === "info") {
    const handleSubmit = async (values: ProjectFormValues) => {
      assertWritable();
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
        // legacy, Project Structure for Other.
        router.push(projectWorkflowHref(project.id, next ?? "info"));
        return updated;
      } else {
        const created = await projectService.createProject(
          formValuesToProjectInput(values)
        );
        toast.success(`${created.code} created`);
        // Replace, not push: Back must never return to an empty
        // /projects/new now that the project exists.
        router.replace(firstSaveHref(created.id, values.structureFamily, "create"));
        return created;
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
      assertWritable();
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
      assertWritable();
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
      assertWritable();
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
      assertWritable();
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
        return updated;
      } else {
        const created = await projectService.createProject(
          formValuesToProjectInput(values, { asDraft: true })
        );
        // Keep editing the stored draft so the id carries forward; replace so
        // Back never returns to an empty /projects/new.
        router.replace(firstSaveHref(created.id, values.structureFamily, "draft"));
        return created;
      }
    };

    /*
     * 13.9B. The form is held until the control state is known, so a
     * lightweight or governed field never appears editable for a moment on a
     * Controlled project. An unreadable state is shown as an error with Retry,
     * never as "not controlled".
     */
    if (project && governanceState.status === "loading") {
      return (
        <div className="space-y-6">
          {header}
          <LoadingState variant="page" label="Checking Project Setup control…" />
        </div>
      );
    }
    if (project && governanceState.status === "error") {
      return (
        <div className="space-y-6">
          {header}
          <ErrorState
            title="Project Setup control could not be checked"
            description="EPRP could not read whether this project's setup is controlled, so it is not shown for editing. Retry in a moment."
            onRetry={governanceState.reload}
          />
        </div>
      );
    }
    const controlled = Boolean(project) && governanceState.controlled;
    const controlState = governanceState.control;
    const formGovernance: ProjectFormGovernance | undefined = project
      ? {
          controlled,
          canAmend: canManage && !readOnly,
          pending: pendingByField,
          decisionRevision,
          finalise: {
            control: controlState,
            canFinalise: canManage && !readOnly,
            onFinalised: () => {
              governanceState.reload();
              reloadProject();
            },
          },
          onAmendmentSubmitted: async (amendment) => {
            governanceState.reload();
            if (amendment.status !== "applied") return null;
            const fresh = await projectService.getProjectById(project.id);
            if (!fresh) return null;
            acceptInfoSaved(fresh);
            return fresh;
          },
        }
      : undefined;
    // 13.9B (owner closure 2026-10-17): a Controlled legacy project is
    // classified once by a System Administrator through the correction path.
    const legacyBootstrap =
      Boolean(savedBaseline) && !savedBaseline?.structureFamily && controlled && identity.isAdmin && !readOnly;

    return (
      <div className="space-y-6">
        {header}
        {project && (
          <ProjectWorkflowNav project={project} activeStep={step} structure={structureState} />
        )}
        {readOnly && <ArchivedSetupNotice />}
        {project && controlled && controlState.controlledSince && (
          <ControlledSetupBanner
            controlledSince={controlState.controlledSince}
            anchor={
              controlState.finalisation && controlState.finalisation.finalisedAt === controlState.controlledSince
                ? "finalisation"
                : "snapshot"
            }
            pendingCount={pendingByField.size}
          />
        )}
        {project && governanceState.amendments.length > 0 && (
          <SetupAmendmentsPanel
            projectCode={project.code}
            amendments={governanceState.amendments}
            viewer={{ profileId: identity.profileId, isGlobalAuthority: identity.isGlobalAuthority }}
            projectArchived={readOnly}
            focusAmendmentId={focusAmendmentId}
            onChanged={() => {
              governanceState.reload();
              reloadProject();
              setDecisionRevision((revision) => revision + 1);
            }}
          />
        )}
        {/* 2C.3E: a disabled fieldset disables every control inside the form —
            fields, pickers, Save, Save Draft — while the values stay legible. */}
        <SetupEditScope readOnly={readOnly}>
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
          onSavePositions={project && !readOnly ? handleSavePositions : undefined}
          onClassify={
            // Before Controlled only: afterwards the bootstrap below applies.
            savedBaseline && !savedBaseline.structureFamily && !readOnly && !controlled ? handleClassify : undefined
          }
          onCorrectProjectType={
            canCorrectProjectType(identity, savedBaseline) ? handleCorrectProjectType : undefined
          }
          onClassifyLegacy={legacyBootstrap ? handleCorrectProjectType : undefined}
          governance={formGovernance}
          onCancel={() =>
            router.push(project ? `/projects/${project.id}` : "/projects")
          }
        />
        </SetupEditScope>
        {/* Preserve the editor across saves; it reconciles the new baseline
            while retaining unrelated and in-flight edits. Not for an Other
            project: its structure is not Departments → Systems; it has its
            own Project Structure step. Not on an archived project (2C.3E):
            it is a second editor for Departments, Systems, Programs & Studies
            and Contacts, which stay visible read-only on their own steps.
            13.9B Step 4: not once Setup is Controlled either — its Departments,
            Systems and Programs & Studies are governed and proposed on their
            own steps; it has no governed mode of its own. */}
        {project && !readOnly && !controlled && setupFlowFor({ structureFamily, saved }) !== "other" && (
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
        <ProjectWorkflowNav project={current} structure={structureState} />
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
      isOther={isOther}
      structureState={structureState}
      canManageStructure={canManage && savedBaseline.status !== "archived"}
      canManageTeam={canManage && savedBaseline.status !== "archived"}
      canEditPeople={canEditPeopleMaster(identity) && !readOnly}
      onProjectChanged={reloadProject}
      readOnly={readOnly}
      governance={governanceState}
      viewer={{ profileId: identity.profileId, isGlobalAuthority: identity.isGlobalAuthority }}
      canPropose={canManage && !readOnly}
    />
  );
}

/** The line that explains why a Controlled step offers requests instead of edits. */
function GovernedStepNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-info/25 bg-info/[0.06] p-2.5 text-xs text-muted-foreground text-pretty">
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Omit that keeps each member of a union (a plain Omit collapses it). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

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
  isOther,
  structureState,
  canManageStructure,
  canManageTeam,
  canEditPeople,
  onProjectChanged,
  readOnly,
  governance,
  viewer,
  canPropose,
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
  /** An Other project (2C.1c): no departments, its own structure step. */
  isOther: boolean;
  /** The Other project's structure, loaded once by the shell. */
  structureState: ProjectStructureState;
  canManageStructure: boolean;
  /** Project Responsibility authority (2C.3C membership), not archived. */
  canManageTeam: boolean;
  /** May edit the global People master — hides Edit / Add Person otherwise. */
  canEditPeople: boolean;
  onProjectChanged: () => void;
  /** 2C.3E: archived — every step visible, nothing saved. */
  readOnly: boolean;
  /** 13.9B: the control state and this project's amendments (Step 4: structure governance). */
  governance: SetupGovernanceState;
  viewer: AmendmentViewer;
  /** May propose structure changes: Project Setup authority, not archived. */
  canPropose: boolean;
}) {
  const router = useRouter();
  // 13.9B Step 4: a request started from a row of the read-only Departments step.
  const [scopeRequest, setScopeRequest] = React.useState<PsmScopeRequest | undefined>();
  const requestScope = (request: DistributiveOmit<PsmScopeRequest, "seq">) =>
    setScopeRequest((previous) => ({ ...request, seq: (previous?.seq ?? 0) + 1 }));
  const { records: clientRecords } = useMasterData("client");
  const clientName = (clientRecords as Client[]).find((client) => client.id === project.clientId)?.name;
  // Progress is measured against the draft, so the checklist and the stepper
  // react as the user edits rather than only after a save.
  const workflow = useProjectWorkflow(current, { structure: structureState });
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
   * added separately on the un-edited path. 2C.3D Wave 2: a new or edited
   * department assignment also needs an active project member; unchanged
   * legacy rows are never reported.
   */
  const assignmentIssues = teamEdited
    ? [...validateAssignments(current), ...teamMembershipIssues({ team: current.team, members: project.members }, project)]
    : duplicateManagerIssues(current);

  const save = async (): Promise<boolean> => {
    if (readOnly) {
      toast.error(PROJECT_SETUP_ARCHIVED_MESSAGE);
      return false;
    }
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

  // A step whose capability arrives in a later setup phase: shown in the
  // workflow, nothing to edit or save. (No current step uses this.)
  if (!status.available) {
    return (
      <div className="space-y-6">
        {header}
        <ProjectWorkflowNav project={current} activeStep={step} structure={structureState} />
        <SectionCard title={stepLabel(step)}>
          <EmptyState
            icon={Lock}
            title="Not available yet"
            description={NEXT_PHASE_MESSAGE}
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
  // An archived project's setup is history: every step stays viewable, even
  // one its incomplete setup would otherwise keep locked (2C.3E).
  if (!status.unlocked && !readOnly) {
    const blockerId = status.blockedBy ?? "info";
    const blockerAvailable = workflow.byId[blockerId]?.available !== false;
    return (
      <div className="space-y-6">
        {header}
        <ProjectWorkflowNav project={current} activeStep={step} structure={structureState} />
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
                : `${stepLabel(step)} unlocks after ${stepLabel(blockerId)}. ${NEXT_PHASE_MESSAGE}`
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

  /*
   * 13.9B Step 4: the structure steps are governed once Setup is Controlled.
   * They wait for the control state (never editable for a moment on a
   * Controlled project, never "not controlled" when it cannot be read); then
   * the editors stay visible read-only and governed changes are proposed in
   * the panels below them.
   */
  const structureStep = step === "structure" || step === "departments" || step === "systems" || step === "disciplines";
  if (structureStep && governance.status !== "ready") {
    return (
      <div className="space-y-6">
        {header}
        <ProjectWorkflowNav project={current} activeStep={step} structure={structureState} />
        {governance.status === "loading" ? (
          <LoadingState variant="card" label="Checking Project Setup control…" />
        ) : (
          <ErrorState
            title="Project Setup control could not be checked"
            description="EPRP could not read whether this project's setup is controlled, so its structure is not shown for editing. Retry in a moment."
            onRetry={governance.reload}
          />
        )}
      </div>
    );
  }
  const governed = structureStep && governance.controlled;
  const afterGovernanceChange = () => {
    governance.reload();
    onProjectChanged();
  };
  const saveDepartmentNotes = async (
    departmentId: string,
    notes: { leadName?: string; projectDescription?: string }
  ) => {
    // Free / logged attributes only: every governed value is sent unchanged.
    const departments = project.departments.map((assignment) =>
      assignment.departmentId === departmentId ? { ...assignment, ...notes } : assignment
    );
    await saveProjectSetupRelation(project, "departments", departments);
    onProjectChanged();
  };
  const psmPanel = (focus: "departments" | "disciplines") => (
    <PsmScopeGovernancePanel
      project={project}
      focus={focus}
      departments={workflow.departments}
      systems={workflow.systems}
      disciplines={workflow.disciplines}
      amendments={governance.amendments}
      viewer={viewer}
      canPropose={canPropose}
      projectArchived={readOnly}
      onSaveDepartmentNotes={saveDepartmentNotes}
      onChanged={afterGovernanceChange}
      request={scopeRequest}
      terms={workflow.terms}
      hrefs={{
        disciplines: projectWorkflowHref(project.id, "disciplines"),
        systems: projectWorkflowHref(project.id, "systems"),
      }}
    />
  );
  const pendingDepartmentIds = new Set(
    [...pendingStructureTargets(governance.amendments).keys()]
      .filter((target) => target.startsWith(departmentTarget("")))
      .map((target) => target.slice(departmentTarget("").length))
  );

  return (
    <div className="space-y-6">
      {header}
      <ProjectWorkflowNav project={current} activeStep={step} structure={structureState} />
      {readOnly && <ArchivedSetupNotice />}

      {step === "structure" && (
        <ProjectStructureStep
          project={project}
          structureState={structureState}
          canManage={canManageStructure}
          onProjectChanged={onProjectChanged}
          contacts={workflow.contacts}
          clientName={clientName}
          governance={
            governed
              ? {
                  amendments: governance.amendments,
                  viewer,
                  canPropose,
                  projectArchived: readOnly,
                  onChanged: afterGovernanceChange,
                }
              : undefined
          }
        />
      )}
      {step === "departments" && (
        // The Departments step presents its own governed mode (a labelled
        // "Request removal", never an inert X); an archived project is still a
        // disabled fieldset.
        <SetupEditScope readOnly={readOnly}>
          <SetupStepDepartments
            project={current}
            context={context}
            departments={workflow.departments}
            departmentName={workflow.departmentName}
            onDraftChange={applyDraft}
            readOnly={readOnly}
            governed={
              governed
                ? {
                    pendingIds: pendingDepartmentIds,
                    canRequest: canPropose,
                    onRequestAdd: () => requestScope({ action: "add_department" }),
                    onRequestRemoval: (departmentId) => requestScope({ action: "remove_department", departmentId }),
                  }
                : undefined
            }
          />
        </SetupEditScope>
      )}
      {step === "departments" && governed && psmPanel("departments")}
      {step === "systems" && governed && (
        <GovernedStepNote>
          Controlled project: a department&apos;s systems are changed with <b>Request scope change</b> below. Nothing is removed
          from here, and nothing changes until another Project Control Admin or System Administrator approves.
        </GovernedStepNote>
      )}
      {step === "systems" && (
        <SetupEditScope readOnly={readOnly || governed}>
          <SetupStepSystems
            project={current}
            context={context}
            systems={workflow.systems}
            departmentName={workflow.departmentName}
            onDraftChange={applyDraft}
            locked={governed}
          />
        </SetupEditScope>
      )}
      {step === "systems" && governed && psmPanel("departments")}
      {step === "disciplines" && governed && (
        <GovernedStepNote>
          Controlled project: use <b>Request Program &amp; Study</b>, <b>Request move</b> or <b>Request removal</b> below. Nothing
          is removed from here, and nothing changes until another Project Control Admin or System Administrator approves.
        </GovernedStepNote>
      )}
      {step === "disciplines" && (
        <SetupEditScope readOnly={readOnly || governed}>
          <SetupStepDisciplines
            project={current}
            context={context}
            disciplines={workflow.disciplines}
            departmentName={workflow.departmentName}
            onDraftChange={applyDraft}
            terms={workflow.terms}
            locked={governed}
          />
        </SetupEditScope>
      )}
      {step === "disciplines" && governed && psmPanel("disciplines")}
      {/* Project Team (2C.3C): the same membership model for PSM, Other and
          legacy projects. Saved immediately against the saved project. */}
      {step === "contacts" && (
        <ProjectTeamWorkspace
          project={project}
          contacts={workflow.contacts}
          clientName={clientName}
          canManage={canManageTeam}
          canEditPeople={canEditPeople}
          onProjectChanged={onProjectChanged}
          structure={isOther && structureState.structure?.projectId === project.id ? structureState.structure : undefined}
        />
      )}
      {/* PSM / legacy department scope assignments stay as they are. */}
      {step === "contacts" && !isOther && (
        <SetupEditScope readOnly={readOnly}>
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
            canEditPeople={canEditPeople}
            clientName={clientName}
          />
        </SetupEditScope>
      )}
      {step === "team" && isOther && (
        <OtherProjectResponsibilities
          project={current}
          savedProject={project}
          contacts={workflow.contacts}
          clientName={clientName}
          title="Project-level responsibilities"
          structureState={structureState}
          canManage={canManageTeam}
          onProjectChanged={onProjectChanged}
        />
      )}
      {step === "team" && !isOther && (
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
          structure={
            isOther && structureState.structure?.projectId === project.id
              ? structureState.structure
              : isOther
                ? null
                : undefined
          }
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
          {readOnly ? (
            // 2C.3E: archived — navigation only; nothing to save or finish.
            nextStep ? (
              <Button asChild>
                <Link href={projectWorkflowHref(project.id, nextStep)}>
                  Next
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link href={`/projects/${project.id}`}>Back to Project</Link>
              </Button>
            )
          ) : (
          <>
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
          </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 2C.3E: the PSM / legacy setup editors (Project Information, Departments,
 * Systems, Programs & Studies, department assignments) have no read-only mode
 * of their own. On an archived project a disabled fieldset disables every
 * control inside them — inputs, pickers, buttons, dialog triggers — while the
 * values stay legible. Other-project editors use their own `canManage`.
 */
function SetupEditScope({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  return (
    <fieldset
      disabled={readOnly}
      data-archived-setup={readOnly ? "read-only" : undefined}
      className="min-w-0"
    >
      {children}
    </fieldset>
  );
}
