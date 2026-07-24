"use client";

import * as React from "react";

import { StatCard, type StatCardProps } from "@/components/shared";
import { SectionCard } from "@/components/shared";
import { cn } from "@/lib/utils";

export interface ProjectSectionLayoutProps {
  /** KPI cards across the top. */
  stats?: StatCardProps[];
  /** Search + filter controls, rendered in a FilterBar by the caller. */
  filters?: React.ReactNode;
  /** Right-hand quick actions panel. */
  quickActions?: React.ReactNode;
  /** Title for the main content card. */
  title: string;
  description?: string;
  /** Header-level action inside the content card. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The shared shape of a project section page, following the dashboard
 * layout already used elsewhere in the platform: KPI cards, a filter row,
 * then the content table or cards with a quick-actions rail beside it.
 *
 * Sections that have nothing to filter or measure simply omit those props
 * and the layout collapses to the content card alone.
 */
export function ProjectSectionLayout({
  stats,
  filters,
  quickActions,
  title,
  description,
  action,
  children,
}: ProjectSectionLayoutProps) {
  return (
    <div className="space-y-4">
      {stats && stats.length > 0 && (
        <div
          className={cn(
            "grid gap-3 sm:grid-cols-2",
            stats.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"
          )}
        >
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      )}

      {filters}

      <div
        className={cn(
          "gap-4",
          quickActions ? "xl:grid xl:grid-cols-[minmax(0,1fr)_18rem]" : undefined
        )}
      >
        <SectionCard
          title={title}
          description={description}
          action={action}
          contentClassName="space-y-3"
        >
          {children}
        </SectionCard>

        {quickActions && (
          <div className="mt-4 xl:mt-0">
            <SectionCard
              title="Quick actions"
              description="Common next steps for this section."
              contentClassName="flex flex-col gap-2"
            >
              {quickActions}
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}
