"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ProjectLinkContext } from "@/features/projects/project-link-context";

export interface ProjectReturnBarProps {
  context: ProjectLinkContext;
  /** What the user is working on, e.g. "Cooling Water Network". */
  recordName?: string;
}

/**
 * Shown on a master-data page that was opened from Project Edit. Names the
 * project trail the user is on and offers the way back, so editing shared
 * master data mid-flow never feels like a dead end.
 */
export function ProjectReturnBar({
  context,
  recordName,
}: ProjectReturnBarProps) {
  if (!context.returnTo) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/30 p-3">
      <p className="text-sm text-muted-foreground">
        {recordName
          ? `Editing ${recordName} from a project.`
          : "Opened from a project."}{" "}
        Changes apply everywhere this record is used.
      </p>
      <Button variant="outline" size="sm" asChild>
        <Link href={context.returnTo}>
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          Return to Project
        </Link>
      </Button>
    </div>
  );
}
