"use client";

import * as React from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  FolderX,
  PenLine,
  UserPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/shared";
import type { Contact, Discipline } from "@/types";
import { listProjectsSync } from "@/services/project-service";
import {
  withProjectContext,
  type ProjectLinkContext,
} from "@/features/projects/project-link-context";
import { disciplineService, getDepartmentById } from "../services";
import { useMasterData } from "../use-master-data";
import { useMasterDataActions } from "./use-master-data-actions";
import { ProjectReturnBar } from "./project-return-bar";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed pb-1.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

export interface DisciplineDetailViewProps {
  disciplineId: string;
  /** Project trail when opened from a project. */
  context?: ProjectLinkContext;
}

/** /disciplines/[disciplineId] — discipline overview with its people. */
export function DisciplineDetailView({
  disciplineId,
  context = {},
}: DisciplineDetailViewProps) {
  const [discipline, setDiscipline] = React.useState<
    Discipline | null | undefined
  >();
  const { records: contactRecords } = useMasterData("contact");

  const reload = React.useCallback(() => {
    disciplineService
      .getById(disciplineId)
      .then((record) => setDiscipline(record as Discipline | null));
  }, [disciplineId]);

  React.useEffect(reload, [reload]);

  const actions = useMasterDataActions("discipline", { onMutated: reload });

  if (discipline === undefined) {
    return <LoadingState variant="page" label="Loading discipline…" />;
  }

  if (discipline === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Discipline not found"
        description={`No discipline exists with id “${disciplineId}”.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {context.returnTo && (
              <Button asChild>
                <Link href={context.returnTo}>Return to Project</Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href="/disciplines">Back to Disciplines</Link>
            </Button>
          </div>
        }
      />
    );
  }

  const department = getDepartmentById(discipline.departmentId);
  const relatedContacts = (contactRecords as Contact[]).filter(
    (contact) =>
      contact.active && contact.departmentId === discipline.departmentId
  );
  const usedByProjects = listProjectsSync().filter((project) =>
    (project.disciplines ?? []).some(
      (link) => link.disciplineId === discipline.id
    )
  );

  const addContactHref = withProjectContext("/contacts/new", {
    ...context,
    sourceType: "discipline",
    parentId: discipline.id,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Master Data"
        title={discipline.name}
        description={discipline.description ?? "Discipline master data."}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={addContactHref}>
                <UserPlus data-icon="inline-start" aria-hidden="true" />
                Add Contact
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link
                href={withProjectContext(
                  `/disciplines/${discipline.id}/edit`,
                  context
                )}
              >
                <PenLine data-icon="inline-start" aria-hidden="true" />
                Edit
              </Link>
            </Button>
            {discipline.active ? (
              <Button
                variant="destructive"
                onClick={() => actions.requestArchive(discipline)}
              >
                <Archive data-icon="inline-start" aria-hidden="true" />
                Archive
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => actions.requestRestore(discipline)}
              >
                <ArchiveRestore data-icon="inline-start" aria-hidden="true" />
                Restore
              </Button>
            )}
          </>
        }
      />

      <ProjectReturnBar context={context} recordName={discipline.name} />

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Details" className="xl:col-span-1">
          <dl className="space-y-2">
            <DetailRow label="Code">
              <span className="font-mono">{discipline.code ?? "—"}</span>
            </DetailRow>
            <DetailRow label="Owning department">
              {department ? (
                <Link
                  href={withProjectContext(
                    `/departments/${department.id}`,
                    context
                  )}
                  className="underline underline-offset-2"
                >
                  {department.name}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Status">
              <StatusBadge tone={discipline.active ? "success" : "neutral"}>
                {discipline.active ? "Active" : "Archived"}
              </StatusBadge>
            </DetailRow>
          </dl>
        </SectionCard>

        <SectionCard
          title="Contacts"
          description="People in the department that owns this discipline."
          className="xl:col-span-2"
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href={addContactHref}>
                <UserPlus data-icon="inline-start" aria-hidden="true" />
                Add Contact
              </Link>
            </Button>
          }
        >
          {relatedContacts.length === 0 ? (
            <EmptyState
              title="No contacts yet"
              description="Add a contact to staff this discipline."
              className="py-6"
            />
          ) : (
            <ul className="space-y-2">
              {relatedContacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{contact.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[contact.position, contact.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={withProjectContext(
                          `/contacts/${contact.id}`,
                          context
                        )}
                      >
                        Open
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={withProjectContext(
                          `/contacts/${contact.id}/edit`,
                          {
                            ...context,
                            sourceType: "discipline",
                            parentId: discipline.id,
                          }
                        )}
                      >
                        Edit
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Used by projects"
          description="Projects with this discipline in scope."
          className="xl:col-span-3"
        >
          {usedByProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not linked to any project yet.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {usedByProjects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="rounded-md bg-muted px-2 py-0.5 text-xs underline underline-offset-2"
                  >
                    {project.shortName ?? project.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {actions.element}
    </div>
  );
}
