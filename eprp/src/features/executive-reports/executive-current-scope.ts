/**
 * Current-management scope for Executive reporting.
 *
 * Archived projects remain addressable by historical registers and reports,
 * but a live management surface must never aggregate them. `Project.status`
 * is the domain lifecycle marker; the archive service also maintains the
 * database-only `active` / `archived_at` fields.
 */
export function currentExecutiveScope<T extends { status: string }>(
  projects: readonly T[]
): T[] {
  return projects.filter((project) => project.status !== "archived");
}
