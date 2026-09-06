"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, SectionCard } from "@/components/shared";
import {
  ManagedMultiSelect,
  useMasterData,
  type ManagedMultiSelectHandle,
} from "@/features/master-data";
import type {
  Discipline,
  MasterRecordBase,
  Project,
  ProjectDisciplineLink,
  System,
} from "@/types";
import { AlertTriangle, ArrowRightLeft, Plus, X } from "lucide-react";

import {
  canCorrectScopeLink,
  correctScopeLink,
  misplacedScopeLinks,
  removeScopeLink,
  scopeLinkKey,
} from "../../scope-integrity";

import { Button } from "@/components/ui/button";
import { type ProjectLinkContext } from "../../project-link-context";
import type { HierarchyTerms } from "@/config/project-terminology";
import { LinkedRecordRow } from "./linked-record-row";

export interface SetupStepDisciplinesProps {
  /** Hierarchy wording — display only. */
  terms: HierarchyTerms;
  project: Project;
  context: ProjectLinkContext;
  disciplines: Discipline[];
  departmentName: (id: string) => string;
  onDraftChange: (patch: Partial<Project>) => void;
}

/**
 * Step 4 — link disciplines to the systems and departments they cover.
 *
 * A discipline is chosen per system: pick the system, then the disciplines
 * working on it. Options are limited to disciplines owned by that exact
 * system and department, so the Discipline → System → Department chain holds.
 *
 * Creating one never leaves the wizard. The header button and the dropdown's
 * "Add new…" open the SAME inline dialog, pre-scoped to the System selected
 * above (and the Department owning it), and the saved record is linked into
 * this step's draft on the way back. Both of those fields are required on a
 * Discipline, so without the preset the user had to re-pick the scope the
 * screen was already showing them.
 */
export function SetupStepDisciplines({
  project,
  context,
  disciplines,
  departmentName,
  onDraftChange,
  terms,
}: SetupStepDisciplinesProps) {
  const links = project.disciplines ?? [];
  const assignments = project.departments;

  // Integrity is judged against the FULL record set, archived included. The
  // `disciplines` prop carries active records only, so using it here would
  // report every archived-but-correctly-linked record as an orphan.
  const { records: allDisciplineRecords } = useMasterData("discipline");
  const { records: allSystemRecords } = useMasterData("system");

  // Every system on the project, flattened with its owning department.
  // Assignments snapshot the system's name/code at the time it was added, so
  // a stale or bad snapshot value renders forever unless the live master
  // record is preferred whenever it still resolves.
  const projectSystems = assignments.flatMap((assignment) =>
    assignment.systems.map((system) => {
      const master = (allSystemRecords as System[]).find(
        (record) => record.id === system.id
      );
      return {
        ...system,
        name: master?.name ?? system.name,
        code: master?.code ?? system.code,
        departmentId: assignment.departmentId,
      };
    })
  );

  const [systemId, setSystemId] = React.useState(
    () => projectSystems[0]?.id ?? ""
  );
  const activeSystem = projectSystems.find((system) => system.id === systemId);
  const activeDepartmentId = activeSystem?.departmentId ?? "";

  const linksForSystem = links.filter((link) => link.systemId === systemId);

  const picker = React.useRef<ManagedMultiSelectHandle>(null);

  /*
   * Only preset when the scope is unambiguous — a system is actually selected
   * and its owning department resolved. Otherwise the dialog opens blank and
   * the user chooses, exactly as the global page does.
   */
  const createPresetValues =
    systemId && activeDepartmentId
      ? { departmentId: activeDepartmentId, systemId }
      : undefined;

  const setForSystem = (ids: string[]) => {
    const others = links.filter((link) => link.systemId !== systemId);
    // A link already filed under this system is kept exactly as stored.
    // Rebuilding it would re-stamp `departmentId` from the active system and
    // silently relocate a misplaced link, hiding the very problem the panel
    // below asks the user to resolve deliberately.
    const existing = new Map(
      linksForSystem.map((link) => [link.disciplineId, link])
    );
    const next: ProjectDisciplineLink[] = ids.map(
      (disciplineId) =>
        existing.get(disciplineId) ?? {
          disciplineId,
          systemId,
          departmentId: activeDepartmentId,
        }
    );
    onDraftChange({ disciplines: [...others, ...next] });
  };

  const disciplineName = (id: string) =>
    (allDisciplineRecords as Discipline[]).find(
      (discipline) => discipline.id === id
    )?.name ??
    disciplines.find((discipline) => discipline.id === id)?.name ??
    `Unknown ${terms.singularLower}`;
  const systemName = (id?: string) =>
    id
      ? ((allSystemRecords as System[]).find((system) => system.id === id)
          ?.name ?? "Unknown system")
      : "No system";

  const misplaced = misplacedScopeLinks(
    project,
    allDisciplineRecords as Discipline[]
  );
  const misplacedKeys = new Set(
    misplaced.map((entry) => scopeLinkKey(entry.disciplineId, entry.linkSystemId))
  );

  if (projectSystems.length === 0) {
    return (
      <SectionCard title={terms.plural}>
        <EmptyState
          title="No systems yet"
          description={`Assign systems to departments before linking ${terms.pluralLower}.`}
          className="py-8"
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={`Link ${terms.pluralLower} to a system`}
        description={`${terms.plural} are offered from the department that owns the selected system.`}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => picker.current?.openCreate()}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add {terms.singular}
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="setup-system">System</Label>
            <Select value={systemId} onValueChange={setSystemId}>
              <SelectTrigger id="setup-system" className="w-full">
                <SelectValue placeholder="Select a system" />
              </SelectTrigger>
              <SelectContent>
                {projectSystems.map((system) => (
                  <SelectItem key={system.id} value={system.id}>
                    {system.name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {departmentName(system.departmentId)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-disciplines">{terms.plural}</Label>
            <ManagedMultiSelect
              ref={picker}
              kind="discipline"
              value={linksForSystem.map((link) => link.disciplineId)}
              onChange={setForSystem}
              createPresetValues={createPresetValues}
              filter={(record: MasterRecordBase) =>
                (record as Discipline).departmentId === activeDepartmentId &&
                (record as Discipline).systemId === systemId
              }
              emptyLabel={`No ${terms.pluralLower} belong to this system.`}
              placeholder={`Select ${terms.pluralLower}…`}
              displayTerms={terms}
              controlProps={{ id: "setup-disciplines" }}
            />
          </div>
        </div>
      </SectionCard>

      {misplaced.length > 0 && (
        <SectionCard
          title={`${terms.plural} filed under the wrong System`}
          description={`These project links contradict the Department and System that own the ${terms.singularLower}. Nothing is moved until you choose — the master records themselves are not affected.`}
        >
          <ul className="space-y-2">
            {misplaced.map((entry) => {
              const correctable = canCorrectScopeLink(project, entry);
              return (
                <li
                  key={scopeLinkKey(entry.disciplineId, entry.linkSystemId)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <AlertTriangle
                        className="size-3.5 shrink-0 text-warning"
                        aria-hidden="true"
                      />
                      {disciplineName(entry.disciplineId)}
                    </p>
                    {entry.problem === "unknown-record" ? (
                      <p className="text-xs text-muted-foreground">
                        No master record exists for this id. It can only be
                        removed from the project.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Filed under {systemName(entry.linkSystemId)} ·{" "}
                        {departmentName(entry.linkDepartmentId ?? "")} — owned by{" "}
                        {systemName(entry.ownerSystemId)} ·{" "}
                        {departmentName(entry.ownerDepartmentId ?? "")}
                      </p>
                    )}
                    {entry.problem !== "unknown-record" && !correctable && (
                      <p className="text-xs text-muted-foreground">
                        Add {systemName(entry.ownerSystemId)} on the Systems step
                        before it can be moved there.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {entry.problem !== "unknown-record" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!correctable}
                        onClick={() =>
                          onDraftChange({
                            disciplines: correctScopeLink(project, entry),
                          })
                        }
                      >
                        <ArrowRightLeft
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                        Move to {systemName(entry.ownerSystemId)}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${disciplineName(entry.disciplineId)} from this project`}
                      onClick={() =>
                        onDraftChange({
                          disciplines: removeScopeLink(
                            project,
                            entry.disciplineId,
                            entry.linkSystemId
                          ),
                        })
                      }
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      <SectionCard
        title={`Linked ${terms.pluralLower}`}
        description={`Every ${terms.singularLower} linked on this project, grouped by system.`}
      >
        {links.length === 0 ? (
          <EmptyState
            title={`No ${terms.pluralLower} linked yet`}
            description={`Pick a system above, then choose the ${terms.pluralLower} covering it.`}
            className="py-8"
          />
        ) : (
          <ul className="space-y-4">
            {projectSystems
              .filter((system) =>
                links.some((link) => link.systemId === system.id)
              )
              .map((system) => (
                <li key={system.id}>
                  <p className="text-xs text-muted-foreground">
                    {system.name} · {departmentName(system.departmentId)}
                  </p>
                  <ul className="mt-1 space-y-2">
                    {links
                      .filter((link) => link.systemId === system.id)
                      .map((link) => (
                        <li key={`${system.id}-${link.disciplineId}`}>
                          <LinkedRecordRow
                            kind="discipline"
                            id={link.disciplineId}
                            name={disciplineName(link.disciplineId)}
                            meta={
                              misplacedKeys.has(
                                scopeLinkKey(link.disciplineId, link.systemId)
                              )
                                ? `${departmentName(link.departmentId ?? "")} · Wrong System — see the panel above`
                                : departmentName(link.departmentId ?? "")
                            }
                            className={
                              misplacedKeys.has(
                                scopeLinkKey(link.disciplineId, link.systemId)
                              )
                                ? "border-warning/40 bg-warning/5"
                                : undefined
                            }
                            context={context}
                            onRemove={() =>
                              onDraftChange({
                                disciplines: links.filter(
                                  (candidate) =>
                                    !(
                                      candidate.systemId === system.id &&
                                      candidate.disciplineId ===
                                        link.disciplineId
                                    )
                                ),
                              })
                            }
                          />
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
