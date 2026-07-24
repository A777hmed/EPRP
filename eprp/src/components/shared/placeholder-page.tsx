import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

export interface PlaceholderPageProps {
  eyebrow?: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Optional call to action for the empty state. */
  action?: React.ReactNode;
}

/**
 * Professional placeholder for routes whose module ships in a later phase:
 * a real page header plus an empty state explaining what will live here.
 */
export function PlaceholderPage({
  eyebrow,
  title,
  description,
  icon,
  action,
}: PlaceholderPageProps) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EmptyState
        icon={icon}
        title={`${title} is coming soon`}
        description="This module is planned for an upcoming phase. The navigation and layout are ready — content will appear here once the module ships."
        action={action}
      />
    </div>
  );
}
