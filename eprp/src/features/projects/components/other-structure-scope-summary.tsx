"use client";

import Link from "next/link";
import { Layers } from "lucide-react";

import { Button } from "@/components/ui/button";
import { hierarchyLine, structureLevelHref, structureSetupHref } from "../structure-navigation";
import { levelsOf } from "../use-structure-nav";
import { useProjectStructure } from "../use-project-structure";

/**
 * "Scope & Structure" of an OTHER project: its own configured levels with the
 * number of active units on each — in the names the project chose — instead
 * of the Departments / Systems / Disciplines of a PSM project. Read-only; the
 * structure is managed in Project Setup → Project Structure.
 */
export function OtherStructureScopeSummary({ projectId }: { projectId: string | undefined }) {
  const { structure, error } = useProjectStructure(projectId);

  if (!projectId) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        The project structure can be configured once the project has been saved.
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!structure) return <p className="text-sm text-muted-foreground">Loading the project structure…</p>;

  const levels = levelsOf(structure) ?? [];
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
          {levels.length > 0 ? hierarchyLine(levels) : "No structure levels configured yet"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href={structureSetupHref(projectId)}>Project Structure setup</Link>
        </Button>
      </div>
      {levels.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {levels.map((level) => {
            const count = structure.nodes.filter((node) => node.levelNumber === level.levelNumber && !node.archivedAt).length;
            return (
              <li key={level.levelNumber} className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <Link href={structureLevelHref(projectId, level.levelNumber)} className="font-medium hover:underline">
                  {level.pluralLabel}
                </Link>
                <span className="ml-2 tabular-nums text-muted-foreground">{count}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
