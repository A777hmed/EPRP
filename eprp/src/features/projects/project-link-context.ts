import {
  isProjectWorkflowStep,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";

/**
 * The breadcrumb a project carries when it sends the user off to edit a
 * linked master-data record.
 *
 * Master-data pages are shared across the platform, so they need to be told
 * which project sent them, what the user was looking at, and where to go
 * back to. All four travel as URL params, which keeps the trail intact
 * across full reloads and shared links.
 */
export interface ProjectLinkContext {
  projectId?: string;
  /** The kind of record that owns the one being added or edited. */
  sourceType?: "project" | "department" | "system" | "discipline" | "contact";
  /** Id of that parent, so the target can pre-select its relationship. */
  parentId?: string;
  /** The wizard step the user left, to return to and to continue from. */
  currentStep?: ProjectWorkflowStepId;
  /** Absolute path to return to, including any section anchor. */
  returnTo?: string;
}

/** Section anchors inside Project Edit, used as return targets. */
export const PROJECT_EDIT_SECTIONS = {
  departments: "scope-departments",
  systems: "scope-systems",
  contacts: "scope-contacts",
} as const;

export type ProjectEditSection = keyof typeof PROJECT_EDIT_SECTIONS;

/** Return path that lands back on a specific Project Edit section. */
export function projectEditReturn(
  projectId: string,
  section: ProjectEditSection
): string {
  return `/projects/${projectId}/edit#${PROJECT_EDIT_SECTIONS[section]}`;
}

/** Append the context params to a path, preserving any it already has. */
export function withProjectContext(
  href: string,
  context: ProjectLinkContext
): string {
  const [path, existing] = href.split("?");
  const params = new URLSearchParams(existing);
  if (context.projectId) params.set("projectId", context.projectId);
  if (context.sourceType) params.set("sourceType", context.sourceType);
  if (context.parentId) params.set("parentId", context.parentId);
  if (context.currentStep) params.set("currentStep", context.currentStep);
  if (context.returnTo) params.set("returnTo", context.returnTo);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Read the context back out of a page's resolved search params. */
export function readProjectContext(
  searchParams: Record<string, string | string[] | undefined>
): ProjectLinkContext {
  const one = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  const sourceType = one(searchParams.sourceType);
  const step = one(searchParams.currentStep);
  return {
    projectId: one(searchParams.projectId),
    sourceType:
      sourceType === "project" ||
      sourceType === "department" ||
      sourceType === "system" ||
      sourceType === "discipline" ||
      sourceType === "contact"
        ? sourceType
        : undefined,
    parentId: one(searchParams.parentId),
    currentStep: step && isProjectWorkflowStep(step) ? step : undefined,
    // Only ever return to an in-app path, never an absolute URL — the value
    // comes from the address bar and is used as a redirect target.
    returnTo: safeReturnTo(one(searchParams.returnTo)),
  };
}

/**
 * A return path must be a local absolute path. Anything else (a protocol, a
 * protocol-relative `//host`, or a backslash variant) is discarded so a
 * crafted link cannot bounce the user off-site after saving.
 */
export function safeReturnTo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();
  const normalized = decoded.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) return undefined;
  if (normalized.startsWith("//")) return undefined;
  return normalized;
}

/** True when there is a project to return to. */
export function hasProjectReturn(
  context: ProjectLinkContext
): context is ProjectLinkContext & { projectId: string; returnTo: string } {
  return Boolean(context.projectId && context.returnTo);
}
