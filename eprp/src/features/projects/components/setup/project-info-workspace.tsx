"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SectionCard, StatusBadge } from "@/components/shared";
import { ASSIGNMENT_ROLE_META } from "@/lib/constants";
import { projectWorkflowHref } from "@/config/project-workflow";
import { projectService, type AssignmentSupport } from "@/services/project-service";
import type { Project } from "@/types";
import {
  activeDelegations,
  delegationStatus,
  departmentAssignments,
  validateAssignments,
} from "../../assignment-rules";
import {
  withProjectContext,
  type ProjectLinkContext,
} from "../../project-link-context";
import { useProjectWorkflow } from "../../use-project-workflow";
import { SetupStepContacts } from "./setup-step-contacts";
import { SetupStepDepartments } from "./setup-step-departments";
import { SetupStepDisciplines } from "./setup-step-disciplines";
import { SetupStepSystems } from "./setup-step-systems";

type SectionId = "departments" | "systems" | "disciplines" | "contacts";

/** Where each section's "Add" action creates a new master record. */
const ADD_PATH: Record<SectionId, string> = {
  departments: "/departments/new",
  systems: "/systems/new",
  disciplines: "/disciplines/new",
  contacts: "/contacts/new",
};

export interface ProjectInfoWorkspaceProps {
  project: Project;
  context: ProjectLinkContext;
  onSaved: (updated: Project) => void;
}

/**
 * Scope management surfaced on Project Info.
 *
 * Every editor is the **same** component its dedicated step uses, over the
 * same record and service — no duplicate form, CRUD path, route, or model, so
 * the two surfaces stay in sync by construction.
 *
 * Two separate saves on purpose:
 *  - structure (departments / systems / disciplines) always saves;
 *  - team + delegations save only when the additive assignment migration is
 *    applied, so assignment data is never silently dropped.
 *
 * Project Info's own scalar fields travel through `ProjectInfoUpdate` from the
 * form above and are never included here.
 */
export function ProjectInfoWorkspace({
  project,
  context,
  onSaved,
}: ProjectInfoWorkspaceProps) {
  const workflow = useProjectWorkflow(project);
  const [draft, setDraft] = React.useState<Project>(project);
  const [saving, setSaving] = React.useState<"structure" | "team" | null>(null);
  const [open, setOpen] = React.useState<SectionId | null>(null);
  const [support, setSupport] = React.useState<AssignmentSupport | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    projectService
      .getAssignmentSupport()
      .then((result) => {
        if (!cancelled) setSupport(result);
      })
      // A probe failure must not block the page; assume supported and let a
      // real save surface any genuine error.
      .catch(() => {
        if (!cancelled) {
          setSupport({ assignmentColumns: true, delegations: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyDraft = (patch: Partial<Project>) =>
    setDraft((previous) => ({ ...previous, ...patch }));

  const today = new Date().toISOString().slice(0, 10);
  const migrationBlocked =
    support !== null && (!support.assignmentColumns || !support.delegations);

  // Reporting lines are validated against the draft, so the button reflects
  // what would actually be written rather than what was last saved.
  const assignmentIssues = validateAssignments(draft);
  const assignmentsBlocked = migrationBlocked || assignmentIssues.length > 0;

  const structureDirty =
    draft.departments !== project.departments ||
    draft.disciplines !== project.disciplines;
  const teamDirty =
    draft.team !== project.team || draft.delegations !== project.delegations;

  const systemCount = draft.departments.reduce(
    (sum, assignment) => sum + assignment.systems.length,
    0
  );
  const disciplineIds = [
    ...new Set((draft.disciplines ?? []).map((link) => link.disciplineId)),
  ];
  const contactCount = new Set((draft.team ?? []).map((m) => m.contactId)).size;

  const save = async (scope: "structure" | "team") => {
    // Guard the handler as well as the button: an invalid reporting structure
    // must not reach the service by any route.
    if (scope === "team" && assignmentsBlocked) return;
    setSaving(scope);
    try {
      /*
       * NOT LOADED IS NOT EMPTY — see the same guard in project-setup-view.
       * `team: draft.team ?? []` turned "not hydrated" into "empty", and
       * `replaceTeam` deletes before it inserts, so that wiped the project
       * team. `updateProject` uses key-presence semantics: omit what we do
       * not hold rather than sending an empty array.
       */
      const payload: Parameters<typeof projectService.updateProject>[1] = {};
      if (scope === "structure") {
        payload.departments = draft.departments;
        if (draft.disciplines !== undefined) {
          payload.disciplines = draft.disciplines;
        }
      } else {
        if (draft.team !== undefined) payload.team = draft.team;
        if (draft.delegations !== undefined) {
          payload.delegations = draft.delegations;
        }
        if (payload.team === undefined) {
          toast.error("Team data has not loaded yet — nothing was saved.");
          return;
        }
      }
      const updated = await projectService.updateProject(project.id, payload);
      onSaved(updated);
      toast.success(
        scope === "structure" ? "Project scope saved" : "Assignments saved"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save"
      );
    } finally {
      setSaving(null);
    }
  };

  const sections: {
    id: SectionId;
    title: string;
    count: number;
    summary: string;
    body: React.ReactNode;
  }[] = [
    {
      id: "departments",
      title: "Departments",
      count: draft.departments.length,
      summary:
        draft.departments
          .map((a) => workflow.departmentName(a.departmentId))
          .join(", ") || "None assigned yet",
      body: (
        <SetupStepDepartments
          project={draft}
          context={context}
          departmentName={workflow.departmentName}
          onDraftChange={applyDraft}
        />
      ),
    },
    {
      id: "systems",
      title: "Systems",
      count: systemCount,
      summary:
        draft.departments
          .flatMap((a) => a.systems.map((s) => s.name))
          .join(", ") || "None assigned yet",
      body: (
        <SetupStepSystems
          project={draft}
          context={context}
          systems={workflow.systems}
          departmentName={workflow.departmentName}
          onDraftChange={applyDraft}
        />
      ),
    },
    {
      id: "disciplines",
      title: workflow.terms.plural,
      count: disciplineIds.length,
      summary:
        disciplineIds
          .map(
            (id) =>
              workflow.disciplines.find((d) => d.id === id)?.name ?? id
          )
          .join(", ") || "None linked yet",
      body: (
        <SetupStepDisciplines
          project={draft}
          context={context}
          disciplines={workflow.disciplines}
          departmentName={workflow.departmentName}
          onDraftChange={applyDraft}
          terms={workflow.terms}
        />
      ),
    },
    {
      id: "contacts",
      title: "Contacts & Responsibilities",
      count: contactCount,
      summary: contactCount
        ? `${contactCount} assigned across ${draft.departments.length} department${
            draft.departments.length === 1 ? "" : "s"
          }`
        : "No one assigned yet",
      body: (
        <SetupStepContacts
          project={draft}
          context={context}
          contacts={workflow.contacts}
          disciplines={workflow.disciplines}
          departmentName={workflow.departmentName}
          onDraftChange={applyDraft}
          terms={workflow.terms}
        />
      ),
    },
  ];

  const contactName = (id: string) =>
    workflow.contacts.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Project scope & management"
        description="Manage the same records the setup steps use, without leaving Project Info."
        action={
          <Button
            onClick={() => save("structure")}
            disabled={saving !== null || !structureDirty}
          >
            {saving === "structure" ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Save data-icon="inline-start" aria-hidden="true" />
            )}
            Save scope
          </Button>
        }
      >
        {structureDirty && (
          <p className="mb-3 text-xs text-muted-foreground">
            Unsaved scope changes
          </p>
        )}

        {/* Always-visible summary cards. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => (
            <div
              key={section.id}
              data-summary={section.id}
              className="flex flex-col gap-2 rounded-lg border p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{section.title}</p>
                <StatusBadge tone={section.count > 0 ? "info" : "neutral"}>
                  {section.count}
                </StatusBadge>
              </div>
              <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
                {section.summary}
              </p>
              <div className="mt-auto flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={withProjectContext(ADD_PATH[section.id], {
                      ...context,
                      sourceType: "project",
                      parentId: project.id,
                    })}
                  >
                    <Plus data-icon="inline-start" aria-hidden="true" />
                    Add
                  </Link>
                </Button>
                <Button
                  variant={open === section.id ? "default" : "outline"}
                  size="sm"
                  onClick={() =>
                    setOpen(open === section.id ? null : section.id)
                  }
                  aria-expanded={open === section.id}
                >
                  {open === section.id ? (
                    <X data-icon="inline-start" aria-hidden="true" />
                  ) : (
                    <Settings2 data-icon="inline-start" aria-hidden="true" />
                  )}
                  {open === section.id ? "Close" : "Manage"}
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={projectWorkflowHref(project.id, section.id)}>
                    <ExternalLink data-icon="inline-start" aria-hidden="true" />
                    Step
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* The chosen editor — the dedicated step's own component. */}
        {open && (
          <div className="mt-4 rounded-lg border p-3" data-editor={open}>
            {sections.find((section) => section.id === open)?.body}
          </div>
        )}
      </SectionCard>

      {/* ------------------- Responsibilities, per department ------------------ */}
      <SectionCard
        title="Contacts & responsibilities"
        description="Who is assigned in each department, and who currently holds Weekly authority."
        action={
          <Button
            onClick={() => save("team")}
            disabled={saving !== null || !teamDirty || assignmentsBlocked}
            title={
              migrationBlocked
                ? "Pending migration must be applied before assignments can be saved"
                : assignmentIssues.length > 0
                  ? `${assignmentIssues.length} assignment problem(s) must be fixed first`
                  : undefined
            }
          >
            {saving === "team" ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Save data-icon="inline-start" aria-hidden="true" />
            )}
            Save assignments
          </Button>
        }
      >
        {assignmentIssues.length > 0 && (
          <ul
            role="alert"
            data-assignment-errors="summary"
            className="mb-3 space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          >
            {assignmentIssues.map((issue) => (
              <li
                key={`${issue.departmentId}-${issue.contactId ?? ""}-${issue.message}`}
                className="text-sm text-destructive text-pretty"
              >
                {/* Named, because the same problem can occur in several
                    departments and the list is outside their cards. */}
                <span className="font-medium">
                  {workflow.departmentName(issue.departmentId)}
                </span>
                {" — "}
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        {migrationBlocked && (
          <div
            role="status"
            className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            <p className="text-sm text-pretty">
              Assignment roles, functional titles, reporting lines and
              delegations cannot be saved yet — the migration{" "}
              <code className="font-mono text-xs">
                20260804000001_project_contact_assignments.sql
              </code>{" "}
              has not been applied. Everything else on this page works normally,
              and nothing is dropped silently: only this save is disabled.
            </p>
          </div>
        )}

        {draft.departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Assign a department first — responsibilities are scoped per
            department.
          </p>
        ) : (
          <ul className="space-y-2">
            {draft.departments.map((assignment) => {
              const entries = departmentAssignments(
                draft,
                assignment.departmentId
              );
              const manager = entries.find(
                (e) => e.assignmentRole === "department_manager"
              );
              const leads = entries.filter(
                (e) => e.assignmentRole === "team_member_lead"
              );
              const members = entries.filter(
                (e) => e.assignmentRole === "team_member"
              );
              const acting = activeDelegations(
                draft,
                assignment.departmentId,
                today
              );
              return (
                <li
                  key={assignment.departmentId}
                  className="rounded-lg border p-3"
                  data-responsibility={assignment.departmentId}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {workflow.departmentName(assignment.departmentId)}
                    </p>
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={projectWorkflowHref(project.id, "contacts")}
                      >
                        <ExternalLink
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                        Contacts step
                      </Link>
                    </Button>
                  </div>

                  <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">
                        {ASSIGNMENT_ROLE_META.department_manager.label}
                      </dt>
                      <dd className="font-medium">
                        {manager ? contactName(manager.contactId) : "Not set"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {ASSIGNMENT_ROLE_META.team_member_lead.label}s
                      </dt>
                      <dd className="font-medium">
                        {leads.length
                          ? leads.map((l) => contactName(l.contactId)).join(", ")
                          : "None"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {ASSIGNMENT_ROLE_META.team_member.label}s
                      </dt>
                      <dd className="font-medium">
                        {members.length
                          ? members
                              .map((m) => contactName(m.contactId))
                              .join(", ")
                          : "None"}
                      </dd>
                    </div>
                  </dl>

                  {entries.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {entries.map((entry) => (
                        <li
                          key={entry.contactId}
                          className="flex flex-wrap items-center gap-1.5 text-xs"
                        >
                          <span className="rounded-md bg-muted px-2 py-0.5">
                            {contactName(entry.contactId)}
                          </span>
                          {entry.functionalTitle && (
                            <span className="text-muted-foreground">
                              {entry.functionalTitle}
                            </span>
                          )}
                          <StatusBadge
                            tone={
                              entry.assignmentRole === "department_manager"
                                ? "info"
                                : "neutral"
                            }
                          >
                            {ASSIGNMENT_ROLE_META[entry.assignmentRole].label}
                          </StatusBadge>
                          {entry.reportsToContactId && (
                            <span className="text-muted-foreground">
                              → {contactName(entry.reportsToContactId)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {acting.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {acting.map((delegation, index) => (
                        <li
                          key={delegation.id ?? index}
                          className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <StatusBadge tone="success">
                            Acting / Delegated Manager
                          </StatusBadge>
                          {contactName(delegation.delegateContactId)}
                          <span>
                            · {delegationStatus(delegation, today)} until{" "}
                            {delegation.endDate}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
