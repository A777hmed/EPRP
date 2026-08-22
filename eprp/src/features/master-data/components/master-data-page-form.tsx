"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
} from "@/components/shared";
import type { MasterRecordBase } from "@/types";
import {
  hasProjectReturn,
  type ProjectLinkContext,
} from "@/features/projects/project-link-context";
import { linkRecordToProject } from "@/features/projects/link-record-to-project";
import { useHierarchyTermsByProjectId } from "@/features/projects/use-hierarchy-terms";
import {
  nextStepId,
  projectWorkflowHref,
} from "@/config/project-workflow";
import { ProjectReturnBar } from "./project-return-bar";
import { useMasterDataActions } from "./use-master-data-actions";
import {
  getDisciplineById,
  getMasterService,
  getSystemById,
  MASTER_KIND_CONFIG,
} from "../services";
import type { MasterKind } from "../types";
import { MasterDataForm } from "./master-data-form";

export interface MasterDataPageFormProps {
  kind: MasterKind;
  eyebrow: string;
  /** Record id for edit mode; omit for create. */
  recordId?: string;
  /** Where the list lives, e.g. "/departments". */
  basePath: string;
  /**
   * Where to go after saving or cancelling, overriding the default. Set when
   * arriving from a project so the user lands back where they left.
   */
  returnTo?: string;
  /**
   * The project trail this page was opened from. Drives the return bar, the
   * "Save & Return to Project" label, and — for contacts — the link written
   * back to the project team.
   */
  context?: ProjectLinkContext;
}

/**
 * The department a new record inherits from the parent it is created under.
 *
 * The chain always resolves down to a department, because that is the only
 * relationship the shared master records carry:
 *   System / Discipline / Contact → the parent's department.
 */
function presetsForKind(
  kind: MasterKind,
  context: ProjectLinkContext
): Record<string, string> | undefined {
  const departmentId =
    context.departmentId ??
    (context.sourceType === "department"
      ? context.parentId
      : context.sourceType === "system"
        ? getSystemById(context.parentId)?.departmentId
        : context.sourceType === "discipline"
          ? getDisciplineById(context.parentId)?.departmentId
          : undefined);
  if (!departmentId) return undefined;
  // Only these kinds carry a department reference on the record itself.
  return kind === "system" || kind === "discipline" || kind === "contact"
    ? { departmentId }
    : undefined;
}

/**
 * Page-level create/edit for a master-data kind (used by dedicated routes
 * such as /departments/new and /departments/[id]/edit). Reuses
 * MasterDataForm; no duplicated form logic.
 */
export function MasterDataPageForm({
  kind,
  eyebrow,
  recordId,
  basePath,
  returnTo,
  context = {},
}: MasterDataPageFormProps) {
  const router = useRouter();
  const config = MASTER_KIND_CONFIG[kind];
  const projectTerms = useHierarchyTermsByProjectId(context.projectId);
  const contextualDiscipline = kind === "discipline" && Boolean(context.projectId);
  const singular = contextualDiscipline ? projectTerms.singular : config.singular;
  const plural = contextualDiscipline ? projectTerms.plural : config.plural;
  const singularLower = contextualDiscipline
    ? projectTerms.singularLower
    : config.singular.toLowerCase();
  const service = getMasterService(kind);
  const isEdit = recordId !== undefined;

  const [record, setRecord] = React.useState<
    MasterRecordBase | null | undefined
  >(isEdit ? undefined : null);

  React.useEffect(() => {
    if (recordId) service.getById(recordId).then(setRecord);
  }, [recordId, service]);

  // Bumping this remounts the form, which is how "Save & Add Another"
  // clears it without duplicating the form state logic here.
  const [formKey, setFormKey] = React.useState(0);

  /*
   * Lifecycle actions on the edit page.
   *
   * Editing previously offered only Cancel and Save, so an administrator could
   * reach a record but never retire it — Contacts had no delete route at all.
   * This reuses the same hook the list view uses, so archive, restore and the
   * blocked-delete flow ("Cannot delete — used by …", with Archive offered
   * instead) behave identically here and there. No second implementation.
   */
  const lifecycle = useMasterDataActions(kind, {
    onMutated: () => router.push(basePath),
    displayTerms: contextualDiscipline ? projectTerms : undefined,
  });

  const nextStep = context.currentStep
    ? nextStepId(context.currentStep)
    : undefined;
  const nextStepHref =
    nextStep && context.projectId
      ? projectWorkflowHref(context.projectId, nextStep)
      : undefined;

  if (isEdit && record === undefined) {
    return <LoadingState variant="page" label={`Loading ${singularLower}…`} />;
  }

  if (isEdit && record === null) {
    return (
      <EmptyState
        icon={FileX}
        title={`${singular} not found`}
        description={`No ${singularLower} exists with id “${recordId}”.`}
        action={
          <Button variant="outline" asChild>
            <Link href={basePath}>Back to {plural}</Link>
          </Button>
        }
      />
    );
  }

  // Pre-select the relationship implied by the parent the user came
  // through, so a new record lands in the right place first time.
  const presetValues = !isEdit ? presetsForKind(kind, context) : undefined;

  const effectiveReturn = returnTo ?? context.returnTo;
  const backTo = effectiveReturn ?? (isEdit ? `${basePath}/${recordId}` : basePath);
  const inProjectFlow = hasProjectReturn({
    ...context,
    returnTo: effectiveReturn,
  });

  // Creating inside the project flow offers the three-way save; editing an
  // existing record just returns.
  const saveActions =
    inProjectFlow && !isEdit
      ? [
          { id: "add-another", label: "Save & Add Another" },
          ...(nextStep ? [{ id: "continue", label: "Save & Continue" }] : []),
          { id: "return", label: "Save & Return to Project" },
        ]
      : undefined;

  const handleSaved = async (
    saved: MasterRecordBase,
    mode: "create" | "edit",
    actionId?: string
  ) => {
    // Attach the record to the project at the scope it was created under.
    let linked = false;
    if (context.projectId) {
      try {
        linked = await linkRecordToProject(kind, saved, {
          ...context,
          returnTo: effectiveReturn,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? `Saved, but linking to the project failed: ${error.message}`
            : "Saved, but linking to the project failed."
        );
      }
    }

    toast.success(
      `${singular} ${mode === "create" ? `“${saved.name}” created` : "updated"}${
        linked ? " and linked to the project" : ""
      }`
    );

    if (actionId === "add-another") {
      // Remount the form so it comes back blank with the same presets.
      setFormKey((key) => key + 1);
      return;
    }
    if (actionId === "continue" && nextStepHref) {
      router.push(nextStepHref);
      return;
    }
    router.push(effectiveReturn ?? `${basePath}/${saved.id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={isEdit ? `Edit ${record?.name}` : `New ${singular}`}
        description={
          isEdit
            ? `Update this ${singularLower}.`
            : `Create a new ${singularLower}.`
        }
        actions={
          isEdit && record ? (
            <div className="flex flex-wrap items-center gap-2">
              {record.active === false ? (
                <Button
                  variant="outline"
                  onClick={() => lifecycle.requestRestore(record)}
                >
                  Restore
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => lifecycle.requestArchive(record)}
                >
                  Archive
                </Button>
              )}
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => lifecycle.requestDelete(record)}
              >
                Delete
              </Button>
            </div>
          ) : undefined
        }
      />
      <ProjectReturnBar
        context={{ ...context, returnTo: effectiveReturn }}
        recordName={record?.name}
      />
      <SectionCard
        title={`${singular} details`}
        className="max-w-3xl"
      >
        <MasterDataForm
          key={formKey}
          kind={kind}
          record={record ?? undefined}
          columns={2}
          presetValues={presetValues}
          submitLabel={
            inProjectFlow && isEdit ? "Save & Return to Project" : undefined
          }
          saveActions={saveActions}
          onSaved={handleSaved}
          onCancel={() => router.push(backTo)}
        />
      </SectionCard>
      {lifecycle.element}
    </div>
  );
}
