import type { ProjectProgress } from "@/features/dashboard/types";

export const progressByProject: ProjectProgress[] = [
  { project: "PSAIM – SOPC", actual: 65, planned: 68, status: "on-track" },
  { project: "RBI Program", actual: 58, planned: 60, status: "on-track" },
  { project: "Turnaround 2026", actual: 45, planned: 52, status: "at-risk" },
  { project: "Pipeline Integrity", actual: 57, planned: 58, status: "on-track" },
  {
    project: "Storage Tank Project",
    actual: 36,
    planned: 48,
    status: "delayed",
  },
];
