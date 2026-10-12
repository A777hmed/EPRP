"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import type { ProjectStructureWorkspaceProps } from "../../../structure/structure-workspace-contract";
import { defaultStructureView, type StructureViewMode } from "../../../structure/structure-hierarchy";
import { findLevel } from "../../../structure/structure-rules";
import { StructureHierarchyView } from "./structure-hierarchy-view";
import { StructureResponsibilityDialog } from "./structure-responsibility-dialog";
import { StructureUnitsEditor } from "./structure-units-editor";

const VIEW_LABEL: Record<StructureViewMode, string> = {
  hierarchy: "Hierarchy View",
  manage: "Manage View",
};

/**
 * Two complementary views over ONE structure: the Hierarchy View for
 * understanding the whole tree, and the Manage View — the existing editor,
 * unchanged — for adding, editing, moving, archiving and reporting input.
 * Both receive the same `structure` prop; nothing is copied between them.
 *
 * When the project's people directory is given (Phase 2C.3D), both views
 * open the ONE Responsibility dialog for a unit's people.
 */
export function StructureViews(props: ProjectStructureWorkspaceProps) {
  const [view, setView] = React.useState<StructureViewMode>(() => defaultStructureView(props.structure));
  const switchButtons = React.useRef<Partial<Record<StructureViewMode, HTMLButtonElement | null>>>({});
  const restoreFocus = React.useRef(false);
  // The unit whose people dialog is open, and the control that opened it.
  const [peopleFor, setPeopleFor] = React.useState<{ nodeId: string; opener: HTMLElement | null } | null>(null);
  const { people, structure } = props;
  const editPeople = people && structure.assignments
    ? (nodeId: string) =>
        setPeopleFor({ nodeId, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null })
    : undefined;
  const peopleNode = structure.nodes.find((node) => node.id === peopleFor?.nodeId && !node.archivedAt);

  // The switch lives in each view's header, so it remounts on change:
  // keep keyboard focus on the button the user just chose.
  React.useEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    switchButtons.current[view]?.focus();
  }, [view]);

  const choose = (next: StructureViewMode) => {
    if (next === view) return;
    restoreFocus.current = true;
    setView(next);
  };

  const viewSwitch = (
    <div role="group" aria-label="Structure view" className="inline-flex rounded-lg border bg-background p-0.5">
      {(Object.keys(VIEW_LABEL) as StructureViewMode[]).map((mode) => (
        <Button
          key={mode}
          ref={(element: HTMLButtonElement | null) => { switchButtons.current[mode] = element; }}
          type="button"
          variant={view === mode ? "secondary" : "ghost"}
          className="h-10 px-3"
          aria-pressed={view === mode}
          onClick={() => choose(mode)}
        >
          {VIEW_LABEL[mode]}
        </Button>
      ))}
    </div>
  );

  return (
    <>
      {view === "hierarchy" ? (
        <StructureHierarchyView
          project={props.project}
          structure={props.structure}
          canManage={props.canManage}
          onManage={() => choose("manage")}
          headerAction={viewSwitch}
          people={people}
          onEditPeople={editPeople}
        />
      ) : (
        <StructureUnitsEditor {...props} headerAction={viewSwitch} onEditPeople={editPeople && ((node) => editPeople(node.id))} />
      )}
      {peopleNode && people && (
        <StructureResponsibilityDialog
          project={props.project}
          node={peopleNode}
          levelLabel={findLevel(structure.levels, peopleNode.levelNumber)?.singularLabel ?? `Level ${peopleNode.levelNumber}`}
          assignments={structure.assignments}
          directory={people}
          canManage={props.canManage}
          onSave={props.actions.saveUnitResponsibilities}
          onClose={() => setPeopleFor(null)}
          onReturnFocus={() => {
            const opener = peopleFor?.opener;
            if (!opener?.isConnected) return false;
            opener.focus();
            return true;
          }}
        />
      )}
    </>
  );
}
