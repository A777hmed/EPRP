"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, FolderX, PenLine, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/shared";
import type { Contact, System } from "@/types";
import { listProjectsSync } from "@/services/project-service";
import {
  hasProjectReturn,
  withProjectContext,
  type ProjectLinkContext,
} from "@/features/projects/project-link-context";
import { getDepartmentById, systemService } from "../services";
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

export interface SystemDetailViewProps {
  systemId: string;
  /** Project trail when opened from Project Edit. */
  context?: ProjectLinkContext;
}

/** /systems/[systemId] — system overview with its department and people. */
export function SystemDetailView({
  systemId,
  context = {},
}: SystemDetailViewProps) {
  const [system, setSystem] = React.useState<System | null | undefined>();
  const { records: contactRecords } = useMasterData("contact");

  const reload = React.useCallback(() => {
    systemService.getById(systemId).then((record) =>
      setSystem(record as System | null)
    );
  }, [systemId]);

  React.useEffect(reload, [reload]);

  const actions = useMasterDataActions("system", { onMutated: reload });

  if (system === undefined) {
    return <LoadingState variant="page" label="Loading system…" />;
  }

  if (system === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="System not found"
        description={`No system exists with id “${systemId}”.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {context.returnTo && (
              <Button asChild>
                <Link href={context.returnTo}>Return to Project</Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href="/systems">Back to Systems</Link>
            </Button>
          </div>
        }
      />
    );
  }

  const department = getDepartmentById(system.departmentId);
  // People in the owning department are the ones who can staff this system.
  const relatedContacts = (contactRecords as Contact[]).filter(
    (contact) =>
      contact.active && contact.departmentId === system.departmentId
  );
  const usedByProjects = listProjectsSync().filter((project) =>
    project.departments.some((assignment) =>
      assignment.systems.some((assigned) => assigned.id === system.id)
    )
  );

  // Adding a contact from here keeps the project trail and pre-scopes the
  // person to this system.
  const addContactHref = withProjectContext("/contacts/new", {
    ...context,
    sourceType: "system",
    parentId: system.id,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Master Data"
        title={system.name}
        description={system.description ?? "System master data."}
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
                href={withProjectContext(`/systems/${system.id}/edit`, context)}
              >
                <PenLine data-icon="inline-start" aria-hidden="true" />
                Edit
              </Link>
            </Button>
            {system.active ? (
              <Button
                variant="destructive"
                onClick={() => actions.requestArchive(system)}
              >
                <Archive data-icon="inline-start" aria-hidden="true" />
                Archive
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => actions.requestRestore(system)}
              >
                <ArchiveRestore data-icon="inline-start" aria-hidden="true" />
                Restore
              </Button>
            )}
          </>
        }
      />

      <ProjectReturnBar context={context} recordName={system.name} />

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Details" className="xl:col-span-1">
          <dl className="space-y-2">
            <DetailRow label="Code">
              <span className="font-mono">{system.code ?? "—"}</span>
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
              <StatusBadge tone={system.active ? "success" : "neutral"}>
                {system.active ? "Active" : "Archived"}
              </StatusBadge>
            </DetailRow>
          </dl>
        </SectionCard>

        <SectionCard
          title="Contacts"
          description="People in the department that owns this system."
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
              description="Add a contact to staff this system."
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
                            sourceType: "system",
                            parentId: system.id,
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
          description="Projects with this system in scope."
          className="xl:col-span-3"
        >
          {usedByProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not assigned to any project yet.
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

      {hasProjectReturn(context) && (
        <div className="flex justify-end">
          <Button asChild>
            <Link href={context.returnTo}>Return to Project</Link>
          </Button>
        </div>
      )}

      {actions.element}
    </div>
  );
}
