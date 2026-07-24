import type { ExportRecord } from "@/types";
import { notImplemented } from "./not-implemented";

/** PDF/DOCX report export pipeline. */
export interface ExportService {
  listRecords(reportId?: string): Promise<ExportRecord[]>;
  exportReport(
    reportId: string,
    reportType: ExportRecord["reportType"],
    format: ExportRecord["format"]
  ): Promise<ExportRecord>;
}

export const exportService: ExportService = {
  listRecords: notImplemented("exportService.listRecords"),
  exportReport: notImplemented("exportService.exportReport"),
};
