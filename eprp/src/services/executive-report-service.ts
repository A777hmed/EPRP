import type { ExecutiveReport, ReportStatus } from "@/types";
import { notImplemented } from "./not-implemented";

/** Executive report lifecycle. */
export interface ExecutiveReportService {
  list(): Promise<ExecutiveReport[]>;
  getById(id: string): Promise<ExecutiveReport | null>;
  create(input: Omit<ExecutiveReport, "id">): Promise<ExecutiveReport>;
  update(id: string, input: Partial<ExecutiveReport>): Promise<ExecutiveReport>;
  changeStatus(id: string, to: ReportStatus): Promise<ExecutiveReport>;
}

export const executiveReportService: ExecutiveReportService = {
  list: notImplemented("executiveReportService.list"),
  getById: notImplemented("executiveReportService.getById"),
  create: notImplemented("executiveReportService.create"),
  update: notImplemented("executiveReportService.update"),
  changeStatus: notImplemented("executiveReportService.changeStatus"),
};
