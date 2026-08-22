import { SectionCard, StatusBadge } from "@/components/shared";
import type { SectionStatus } from "@/features/projects/form-meta";

const statusMeta = {
  complete: { label: "Complete", tone: "success" as const },
  incomplete: { label: "Incomplete", tone: "warning" as const },
  "has-errors": { label: "Has Errors", tone: "danger" as const },
  optional: { label: "Optional", tone: "neutral" as const },
};

export interface ProjectFormSectionProps {
  title: string;
  description?: string;
  /** Completion status shown as a small badge in the header. */
  status?: SectionStatus;
  /** Anchor id, so a return link can scroll back to this section. */
  id?: string;
  /** Extra header control, shown left of the status badge. */
  action?: React.ReactNode;
  /** Replaces the default two-column field grid when the body is not fields. */
  plain?: boolean;
  children: React.ReactNode;
}

/** One titled section of the project form with a responsive field grid. */
export function ProjectFormSection({
  title,
  description,
  status,
  id,
  action,
  plain = false,
  children,
}: ProjectFormSectionProps) {
  const meta = status ? statusMeta[status.kind] : undefined;
  const badgeText =
    status && status.kind === "incomplete"
      ? `${status.missingCount} required missing`
      : meta?.label;

  return (
    <SectionCard
      id={id}
      // Clears the sticky top bar when a return link scrolls here.
      className={id ? "scroll-mt-24" : undefined}
      title={title}
      description={description}
      action={
        (action || meta) && (
          <div className="flex items-center gap-2">
            {action}
            {meta && (
              <StatusBadge tone={meta.tone}>
                <span className="sr-only">Section status: </span>
                {badgeText}
              </StatusBadge>
            )}
          </div>
        )
      }
    >
      {plain ? (
        children
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">{children}</div>
      )}
    </SectionCard>
  );
}
