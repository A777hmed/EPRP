/**
 * The Dashboard is a current-management surface. Archived projects remain in
 * the project register and historical reports, but they are not members of
 * the live portfolio shown here.
 *
 * `status` is the domain lifecycle marker exposed on `Project`. The archive
 * service also sets the database-only `active` and `archived_at` fields, but
 * those fields are deliberately not duplicated on the domain model.
 */
export function dashboardProjectScope<T extends { status: string }>(
  projects: readonly T[]
): T[] {
  return projects.filter((project) => project.status !== "archived");
}
