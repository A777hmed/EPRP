"use client";

import { archivedNodes, nodesByLevel } from "../../../structure/structure-rules";
import type { ProjectStructure } from "@/types/project-structure";

const units = (count: number) => `${count} active unit${count === 1 ? "" : "s"}`;

/**
 * A compact, read-only count of an Other project's structure per level.
 * Shared by the Project Structure step and Review; counts come from the
 * structure rules (active units only), never re-derived here.
 */
export function StructureLevelSummary({
  structure,
}: {
  structure: Pick<ProjectStructure, "levels" | "nodes">;
}) {
  const active = nodesByLevel(structure);
  const archived = archivedNodes(structure.nodes);

  return (
    <ol className="divide-y rounded-lg ring-1 ring-foreground/10">
      {structure.levels.map((level) => {
        const activeCount = active.get(level.levelNumber)?.length ?? 0;
        const archivedCount = archived.filter((node) => node.levelNumber === level.levelNumber).length;
        return (
          <li
            key={level.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
          >
            <span>
              <span className="text-xs text-muted-foreground tabular-nums">
                Level {level.levelNumber}
              </span>{" "}
              <span className="font-medium">{level.pluralLabel}</span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {units(activeCount)}
              {archivedCount > 0 && ` · ${archivedCount} archived`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
