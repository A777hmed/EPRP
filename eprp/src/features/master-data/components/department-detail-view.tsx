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
import { Separator } from "@/components/ui/separator";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/shared";
import type { Contact, Department, Discipline, System } from "@/types";
import { listProjectsSync } from "@/services/project-service";
import {
  departmentService,
  getContactById,
} from "../services";
import {
  withProjectContext,
  type ProjectLinkContext,
} from "@/features/projects/project-link-context";
import { useMasterData } from "../use-master-data";
import { ProjectReturnBar } from "./project-return-bar";
import { useMasterDataActions } from "./use-master-data-actions";

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

export interface DepartmentDetailViewProps {
  departmentId: string;
  /** Project trail when opened from Project Edit or the setup wizard. */
  context?: ProjectLinkContext;
}

/** /departments/[departmentId] — department overview with related records. */
export function DepartmentDetailView({
  departmentId,
  context = {},
}: DepartmentDetailViewProps) {
  const [department, setDepartment] = React.useState<
    Department | null | undefined
  >();
  const { records: systems } = useMasterData("system");
  const { records: disciplines } = useMasterData("discipline");
  const { records: contacts } = useMasterData("contact");

  const reload = React.useCallback(() => {
    departmentService.getById(departmentId).then(setDepartment);
  }, [departmentId]);

  React.useEffect(reload, [reload]);

  const actions = useMasterDataActions("department", {
    onMutated: reload,
  });

  if (department === undefined) {
    return <LoadingState variant="page" label="Loading department…" />;
  }

  if (department === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Department not found"
        description={`No department exists with id “${departmentId}”.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/departments">Back to Departments</Link>
          </Button>
        }
      />
    );
  }

  const lead = getContactById(department.leadContactId);
  const relatedSystems = (systems as System[]).filter(
    (s) => s.departmentId === department.id
  );
  const relatedDisciplines = (disciplines as Discipline[]).filter(
    (d) => d.departmentId === department.id
  );
  const relatedContacts = (contacts as Contact[]).filter(
    (c) => c.departmentId === department.id
  );
  const relatedProjects = listProjectsSync().filter((p) =>
    p.departments.some((d) => d.departmentId === department.id)
  );

  // Creating a contact from here keeps the project trail and pre-scopes the
  // person to this department.
  const addContactHref = withProjectContext("/contacts/new", {
    ...context,
    sourceType: "department",
    parentId: department.id,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Master Data"
        title={department.name}
        description={department.description ?? "Department master data."}
        actions={
          // Add Contact / Edit / Archive / Restore are all master-data
          // mutations — `has_global_operational_authority()`. The detail view
          // itself stays readable, which is the useful read-only context.
          actions.canMutate ? (
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
                    `/departments/${department.id}/edit`,
                    context
                  )}
                >
                  <PenLine data-icon="inline-start" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
              {department.active ? (
                <Button
                  variant="destructive"
                  onClick={() => actions.requestArchive(department)}
                >
                  <Archive data-icon="inline-start" aria-hidden="true" />
                  Archive
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => actions.requestRestore(department)}
                >
                  <ArchiveRestore data-icon="inline-start" aria-hidden="true" />
                  Restore
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={department.active ? "success" : "neutral"}>
            {department.active ? "Active" : "Archived"}
          </StatusBadge>
          <span className="font-mono text-xs text-muted-foreground">
            {department.code}
          </span>
        </div>
      </PageHeader>

      <ProjectReturnBar context={context} recordName={department.name} />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Details" className="lg:col-span-1">
          <dl className="space-y-2">
            <DetailRow label="Code">
              <span className="font-mono text-xs">{department.code}</span>
            </DetailRow>
            <DetailRow label="Default Department Lead (master)">
              {lead ? lead.name : "—"}
            </DetailRow>
            <DetailRow label="Status">
              {department.active ? "Active" : "Archived"}
            </DetailRow>
            <DetailRow label="Systems">{relatedSystems.length}</DetailRow>
            <DetailRow label="Disciplines">
              {relatedDisciplines.length}
            </DetailRow>
            <DetailRow label="Contacts">{relatedContacts.length}</DetailRow>
          </dl>
          {department.description && (
            <>
              <Separator className="my-3" />
              <p className="text-sm text-muted-foreground text-pretty">
                {department.description}
              </p>
            </>
          )}
        </SectionCard>

        <div className="space-y-4 lg:col-span-2">
          <SectionCard
            title="Systems"
            description="Systems owned by this department."
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/systems">Manage</Link>
              </Button>
            }
          >
            {relatedSystems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No systems assigned to this department.
              </p>
            ) : (
              <ul className="space-y-2">
                {relatedSystems.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {s.name}
                        {!s.active && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            (archived)
                          </span>
                        )}
                      </p>
                      {s.code && (
                        <p className="font-mono text-xs text-muted-foreground">
                          {s.code}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          href={withProjectContext(`/systems/${s.id}`, context)}
                        >
                          Open
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          href={withProjectContext(
                            `/systems/${s.id}/edit`,
                            context
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
            title="Disciplines"
            description="Disciplines owned by this department."
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/disciplines">Manage</Link>
              </Button>
            }
          >
            {relatedDisciplines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No disciplines assigned to this department.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {relatedDisciplines.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-md bg-muted px-2 py-0.5 text-xs"
                  >
                    {d.name}
                    {d.code && (
                      <span className="ml-1 font-mono text-muted-foreground">
                        {d.code}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Contacts"
            description="People in this department."
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
              <p className="text-sm text-muted-foreground">
                No contacts in this department yet.
              </p>
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
                              sourceType: "department",
                              parentId: department.id,
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
            title="Projects"
            description="Projects that include this department."
          >
            {relatedProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This department is not assigned to any project yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {relatedProjects.map((p) => (
                  <li key={p.id} className="text-sm">
                    <Link
                      href={`/projects/${p.id}`}
                      className="hover:underline"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.code}
                      </span>{" "}
                      {p.shortName ?? p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {actions.element}
    </div>
  );
}
