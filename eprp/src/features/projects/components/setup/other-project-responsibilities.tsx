"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import { projectWorkflowHref } from "@/config/project-workflow";
import type { Contact, Project } from "@/types";
import { FIXED_RESPONSIBILITIES } from "../../responsibilities";

/**
 * Contacts and Project Team & Responsibilities for an Other project
 * (Phase 2C.1c-c).
 *
 * An Other project has no departments, so the department / discipline team
 * builder does not apply. Its people are, for now, the project-level
 * responsibility holders stored on the project and set on Project Type &
 * Information. Assigning people to structure units is later work; nothing
 * here stores anything.
 */
export function OtherProjectResponsibilities({
  project,
  contacts,
  title,
}: {
  project: Project;
  contacts: Contact[];
  title: string;
}) {
  const nameOf = (id?: string) =>
    (id && contacts.find((contact) => contact.id === id)?.name) || undefined;

  return (
    <SectionCard
      title={title}
      description="Project-level responsibility holders, set on Project Type & Information. Assigning people within the project structure is not available yet."
      action={
        <Button variant="outline" size="sm" asChild>
          <Link href={projectWorkflowHref(project.id, "info")}>Edit holders</Link>
        </Button>
      }
    >
      <dl className="divide-y rounded-lg ring-1 ring-foreground/10">
        {FIXED_RESPONSIBILITIES.map((meta) => {
          const holder = nameOf(project[meta.field]);
          return (
            <div
              key={meta.field}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
            >
              <dt className="text-muted-foreground">
                {meta.label}
                {meta.required && <span className="sr-only"> (required)</span>}
              </dt>
              <dd className={holder ? "font-medium" : "text-muted-foreground"}>
                {holder ?? (meta.required ? "Not assigned — required" : "Not assigned")}
              </dd>
            </div>
          );
        })}
      </dl>
    </SectionCard>
  );
}
