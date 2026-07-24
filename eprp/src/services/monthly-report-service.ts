import type { MonthlyComment, MonthlyReport } from "@/types";
import type { WorkflowStatus } from "@/config/workflows";
import { notImplemented } from "./not-implemented";

/** Monthly report lifecycle, including auto-compilation from weeklies. */
export interface MonthlyReportService {
  list(projectId?: string): Promise<MonthlyReport[]>;
  getById(id: string): Promise<MonthlyReport | null>;
  create(input: Omit<MonthlyReport, "id">): Promise<MonthlyReport>;
  update(id: string, input: Partial<MonthlyReport>): Promise<MonthlyReport>;
  /** Compile a draft monthly report from approved weekly reports. */
  compileFromWeeklies(
    projectId: string,
    weeklyReportIds: string[]
  ): Promise<MonthlyReport>;
  changeStatus(id: string, to: WorkflowStatus): Promise<MonthlyReport>;
  listComments(reportId: string): Promise<MonthlyComment[]>;
}

export const monthlyReportService: MonthlyReportService = {
  list: notImplemented("monthlyReportService.list"),
  getById: notImplemented("monthlyReportService.getById"),
  create: notImplemented("monthlyReportService.create"),
  update: notImplemented("monthlyReportService.update"),
  compileFromWeeklies: notImplemented(
    "monthlyReportService.compileFromWeeklies"
  ),
  changeStatus: notImplemented("monthlyReportService.changeStatus"),
  listComments: notImplemented("monthlyReportService.listComments"),
};
