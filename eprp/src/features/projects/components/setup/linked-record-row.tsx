"use client";

import Link from "next/link";
import { ExternalLink, PenLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  withProjectContext,
  type ProjectLinkContext,
} from "../../project-link-context";

/** Every linked kind now has its own detail and edit page. */
const KIND_ROUTES = {
  department: "/departments",
  system: "/systems",
  discipline: "/disciplines",
  contact: "/contacts",
} as const;

export type LinkedKind = keyof typeof KIND_ROUTES;

export interface LinkedRecordRowProps {
  kind: LinkedKind;
  id: string;
  name: string;
  /** Secondary line — code, department, position, etc. */
  meta?: React.ReactNode;
  /** Project trail carried into the target page and back again. */
  context: ProjectLinkContext;
  onRemove?: () => void;
  className?: string;
  children?: React.ReactNode;
}

/**
 * One linked master-data record inside a wizard step, with Open and Edit
 * buttons that carry the project context so the user lands back here.
 */
export function LinkedRecordRow({
  kind,
  id,
  name,
  meta,
  context,
  onRemove,
  className,
  children,
}: LinkedRecordRowProps) {
  const base = KIND_ROUTES[kind];
  const openHref = withProjectContext(`${base}/${id}`, context);
  const editHref = withProjectContext(`${base}/${id}/edit`, context);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3",
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      </div>
      {children}
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" asChild>
          <Link href={openHref}>
            <ExternalLink data-icon="inline-start" aria-hidden="true" />
            Open
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={editHref}>
            <PenLine data-icon="inline-start" aria-hidden="true" />
            Edit
          </Link>
        </Button>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
