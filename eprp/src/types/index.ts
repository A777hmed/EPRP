/**
 * EPR domain types.
 *
 * - `core`    — enums / string unions shared across the domain
 * - `project` — project master data (projects, departments, disciplines, …)
 * - `reports` — weekly / monthly / executive reports and their children
 * - `organization` — project organization charts and their positions
 * - `admin`   — roles, imports, exports, audit trail
 */

export * from "./core";
export * from "./project";
export * from "./reports";
export * from "./organization";
export * from "./admin";
