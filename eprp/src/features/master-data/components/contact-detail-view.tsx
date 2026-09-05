"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, FolderX, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/shared";
import type { Contact, Project } from "@/types";
import { listProjectsSync } from "@/services/project-service";
import {
  hasProjectReturn,
  withProjectContext,
  type ProjectLinkContext,
} from "@/features/projects/project-link-context";
import { contactService, getDepartmentById, getSystemById } from "../services";
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

/** The project roles a contact holds, derived from project data. */
function contactRoles(project: Project, contactId: string): string[] {
  const roles: string[] = [];
  if (project.projectManagerId === contactId) roles.push("Project Manager");
  if (project.projectControlManagerId === contactId)
    roles.push("Project Control");
  if (project.clientRepresentativeId === contactId)
    roles.push("Client Representative");
  if (project.reportingCoordinatorId === contactId)
    roles.push("Reporting Coordinator");
  if (project.projectSponsorId === contactId) roles.push("Sponsor");
  for (const member of project.team ?? []) {
    if (member.contactId !== contactId) continue;
    const scope = [
      getDepartmentById(member.departmentId)?.name,
      getSystemById(member.systemId)?.name,
    ]
      .filter(Boolean)
      .join(" · ");
    roles.push(scope ? `Team — ${scope}` : "Team");
  }
  return roles;
}

export interface ContactDetailViewProps {
  contactId: string;
  /** Project trail when opened from Project Edit. */
  context?: ProjectLinkContext;
}

/** /contacts/[contactId] — person overview with their department and projects. */
export function ContactDetailView({
  contactId,
  context = {},
}: ContactDetailViewProps) {
  const [contact, setContact] = React.useState<Contact | null | undefined>();
  // Subscribing keeps the department name fresh if it is renamed elsewhere.
  useMasterData("department");

  const reload = React.useCallback(() => {
    contactService.getById(contactId).then((record) =>
      setContact(record as Contact | null)
    );
  }, [contactId]);

  React.useEffect(reload, [reload]);

  const actions = useMasterDataActions("contact", { onMutated: reload });

  if (contact === undefined) {
    return <LoadingState variant="page" label="Loading contact…" />;
  }

  if (contact === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Contact not found"
        description={`No contact exists with id “${contactId}”.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {context.returnTo && (
              <Button asChild>
                <Link href={context.returnTo}>Return to Project</Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href="/contacts">Back to Contacts</Link>
            </Button>
          </div>
        }
      />
    );
  }

  const department = getDepartmentById(contact.departmentId);
  const involvement = listProjectsSync()
    .map((project) => ({ project, roles: contactRoles(project, contact.id) }))
    .filter((entry) => entry.roles.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Master Data"
        title={contact.name}
        description={contact.position ?? "Contact master data."}
        actions={
          // `has_global_operational_authority()` — see department-detail-view.
          actions.canMutate ? (
            <>
              <Button variant="outline" asChild>
                <Link
                  href={withProjectContext(
                    `/contacts/${contact.id}/edit`,
                    context
                  )}
                >
                  <PenLine data-icon="inline-start" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
              {contact.active ? (
                <Button
                  variant="destructive"
                  onClick={() => actions.requestArchive(contact)}
                >
                  <Archive data-icon="inline-start" aria-hidden="true" />
                  Archive
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => actions.requestRestore(contact)}
                >
                  <ArchiveRestore data-icon="inline-start" aria-hidden="true" />
                  Restore
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <ProjectReturnBar context={context} recordName={contact.name} />

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Details" className="xl:col-span-1">
          <dl className="space-y-2">
            <DetailRow label="Position">{contact.position || "—"}</DetailRow>
            <DetailRow label="Role">{contact.role || "—"}</DetailRow>
            <DetailRow label="Email">{contact.email || "—"}</DetailRow>
            <DetailRow label="Phone">{contact.phone || "—"}</DetailRow>
            <DetailRow label="Organization">
              {contact.organization || "—"}
            </DetailRow>
            <DetailRow label="Department">
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
              <StatusBadge tone={contact.active ? "success" : "neutral"}>
                {contact.active ? "Active" : "Archived"}
              </StatusBadge>
            </DetailRow>
          </dl>
        </SectionCard>

        <SectionCard
          title="Projects"
          description="Where this person is assigned, and in what capacity."
          className="xl:col-span-2"
        >
          {involvement.length === 0 ? (
            <EmptyState
              title="Not assigned to a project"
              description="This contact is not referenced by any project yet."
              className="py-6"
            />
          ) : (
            <ul className="space-y-2">
              {involvement.map(({ project, roles }) => (
                <li
                  key={project.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {project.shortName ?? project.name}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {project.code}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {roles.join(" · ")}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/projects/${project.id}`}>Open project</Link>
                  </Button>
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
