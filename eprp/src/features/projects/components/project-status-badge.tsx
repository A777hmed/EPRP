import { StatusBadge } from "@/components/shared";
import {
  OVERALL_STATUS_META,
  PRIORITY_META,
  PROJECT_LIFECYCLE_META,
} from "@/lib/constants";
import type { OverallStatus, Priority, ProjectLifecycleStatus } from "@/types";

/** Lifecycle status pill (planning / active / on hold / …). */
export function ProjectStatusBadge({
  status,
  className,
}: {
  status: ProjectLifecycleStatus;
  className?: string;
}) {
  const meta = PROJECT_LIFECYCLE_META[status];
  return (
    <StatusBadge tone={meta.tone} className={className}>
      {meta.label}
    </StatusBadge>
  );
}

/** Executive health pill (on track / at risk / behind / critical). */
export function OverallStatusBadge({
  status,
  className,
}: {
  status: OverallStatus;
  className?: string;
}) {
  const meta = OVERALL_STATUS_META[status];
  return (
    <StatusBadge tone={meta.tone} className={className}>
      {meta.label}
    </StatusBadge>
  );
}

/** Priority pill. */
export function PriorityBadge({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  return (
    <StatusBadge tone={meta.tone} className={className}>
      {meta.label}
    </StatusBadge>
  );
}
