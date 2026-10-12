"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import type { ProjectStructureWorkspaceProps } from "../../../structure/structure-workspace-contract";
import { defaultStructureView, type StructureViewMode } from "../../../structure/structure-hierarchy";
import { StructureHierarchyView } from "./structure-hierarchy-view";
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
 */
export function StructureViews(props: ProjectStructureWorkspaceProps) {
  const [view, setView] = React.useState<StructureViewMode>(() => defaultStructureView(props.structure));
  const switchButtons = React.useRef<Partial<Record<StructureViewMode, HTMLButtonElement | null>>>({});
  const restoreFocus = React.useRef(false);

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

  return view === "hierarchy" ? (
    <StructureHierarchyView
      project={props.project}
      structure={props.structure}
      canManage={props.canManage}
      onManage={() => choose("manage")}
      headerAction={viewSwitch}
    />
  ) : (
    <StructureUnitsEditor {...props} headerAction={viewSwitch} />
  );
}
