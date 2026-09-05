"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, FolderX, PenLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/shared";
import type { Contact, JobTitle } from "@/types";
import { jobTitleService } from "../services";
import { useMasterData } from "../use-master-data";
import { MasterDataForm } from "./master-data-form";
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

export interface JobTitleDetailViewProps {
  jobTitleId: string;
}

/**
 * /administration/job-titles/[jobTitleId] — one job title, the people using
 * it, and archive / restore. Editing opens the shared form in a dialog rather
 * than a separate route, so this kind stays at three pages.
 */
export function JobTitleDetailView({ jobTitleId }: JobTitleDetailViewProps) {
  const [jobTitle, setJobTitle] = React.useState<JobTitle | null | undefined>();
  const [editing, setEditing] = React.useState(false);
  const { records: contactRecords } = useMasterData("contact");

  const reload = React.useCallback(() => {
    jobTitleService
      .getById(jobTitleId)
      .then((record) => setJobTitle(record as JobTitle | null));
  }, [jobTitleId]);

  React.useEffect(reload, [reload]);

  const actions = useMasterDataActions("jobTitle", { onMutated: reload });

  if (jobTitle === undefined) {
    return <LoadingState variant="page" label="Loading job title…" />;
  }

  if (jobTitle === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Job title not found"
        description={`No job title exists with id “${jobTitleId}”.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/administration/job-titles">Back to Job Titles</Link>
          </Button>
        }
      />
    );
  }

  // Archived titles keep their existing holders visible — that history is
  // exactly why a referenced title is archived rather than deleted.
  const holders = (contactRecords as Contact[]).filter(
    (contact) => contact.jobTitleId === jobTitle.id
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title={jobTitle.name}
        description={
          jobTitle.description ??
          "Job title master data. A label only — it grants no access."
        }
        actions={
          // `has_global_operational_authority()` — see department-detail-view.
          actions.canMutate ? (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <PenLine data-icon="inline-start" aria-hidden="true" />
                Edit
              </Button>
              {jobTitle.active ? (
                <Button
                  variant="destructive"
                  onClick={() => actions.requestArchive(jobTitle)}
                >
                  <Archive data-icon="inline-start" aria-hidden="true" />
                  Archive
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => actions.requestRestore(jobTitle)}
                >
                  <ArchiveRestore data-icon="inline-start" aria-hidden="true" />
                  Restore
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Details" className="xl:col-span-1">
          <dl className="space-y-2">
            <DetailRow label="Short code">
              <span className="font-mono">{jobTitle.code ?? "—"}</span>
            </DetailRow>
            <DetailRow label="Status">
              <StatusBadge tone={jobTitle.active ? "success" : "neutral"}>
                {jobTitle.active ? "Active" : "Archived"}
              </StatusBadge>
            </DetailRow>
            <DetailRow label="People with this title">
              {holders.length}
            </DetailRow>
          </dl>
          {!jobTitle.active && (
            <p className="mt-3 text-xs text-muted-foreground text-pretty">
              Archived titles stay visible on the people who already hold them
              and are no longer offered for new selections.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="People with this job title"
          description="Contacts whose managed job title is set to this record."
          className="xl:col-span-2"
        >
          {holders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one holds this job title yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {holders.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{contact.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[contact.organization, contact.email]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/contacts/${contact.id}`}>Open</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Job Title</DialogTitle>
            <DialogDescription>
              Update this job title. Renaming it updates everyone who holds it.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <MasterDataForm
              kind="jobTitle"
              record={jobTitle}
              columns={1}
              onSaved={() => {
                toast.success("Job title updated");
                setEditing(false);
                reload();
              }}
              onCancel={() => setEditing(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {actions.element}
    </div>
  );
}
