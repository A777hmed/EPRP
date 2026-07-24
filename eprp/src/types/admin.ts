import type { IsoDateTime, ReportSource } from "./core";

/** Platform roles — permission sets are defined in `@/config/permissions`. */
export type UserRole =
  | "system_admin"
  | "project_control_admin"
  | "project_manager"
  | "department_user"
  | "reviewer"
  | "executive"
  | "viewer";

/** Record of an Excel/DOCX template import run. */
export interface ImportRecord {
  id: string;
  source: ReportSource;
  fileName: string;
  targetType: "weekly" | "monthly" | "executive" | "master-data";
  targetReportId?: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage?: string;
  importedByContactId?: string;
  importedAt: IsoDateTime;
}

/** Record of a generated export (PDF/DOCX). */
export interface ExportRecord {
  id: string;
  reportId: string;
  reportType: "weekly" | "monthly" | "executive";
  format: "pdf" | "docx";
  status: "pending" | "processing" | "completed" | "failed";
  fileRef?: string;
  exportedByContactId?: string;
  exportedAt: IsoDateTime;
}

/** Immutable audit trail entry for traceability. */
export interface AuditRecord {
  id: string;
  entityType:
    | "project"
    | "weekly-report"
    | "monthly-report"
    | "executive-report"
    | "user"
    | "master-data";
  entityId: string;
  action: string; // e.g. "status_changed", "created", "approved"
  detail?: string;
  fromValue?: string;
  toValue?: string;
  actorContactId?: string;
  occurredAt: IsoDateTime;
}
