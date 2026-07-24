import type { ImportRecord } from "@/types";
import { notImplemented } from "./not-implemented";

/** Excel/DOCX template import pipeline. */
export interface ImportService {
  listRecords(): Promise<ImportRecord[]>;
  /** Validate a template file before import; returns found problems. */
  validateTemplate(file: File): Promise<string[]>;
  importWeekly(file: File, projectId: string): Promise<ImportRecord>;
  importMonthly(file: File, projectId: string): Promise<ImportRecord>;
  importMasterData(file: File): Promise<ImportRecord>;
}

export const importService: ImportService = {
  listRecords: notImplemented("importService.listRecords"),
  validateTemplate: notImplemented("importService.validateTemplate"),
  importWeekly: notImplemented("importService.importWeekly"),
  importMonthly: notImplemented("importService.importMonthly"),
  importMasterData: notImplemented("importService.importMasterData"),
};
