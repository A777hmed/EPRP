import type {
  CumulativePoint,
  DisciplineProgress,
  WeeklyProgressPoint,
} from "@/features/dashboard/types";

export const monthlyProgressTrend: WeeklyProgressPoint[] = [
  { week: "Week 1", planned: 15, actual: 12 },
  { week: "Week 2", planned: 32, actual: 28 },
  { week: "Week 3", planned: 48, actual: 43 },
  { week: "Week 4", planned: 62, actual: 58 },
];

export const cumulativeProgressCurve: CumulativePoint[] = [
  { date: "1 Jul", planned: 0, actual: 0 },
  { date: "7 Jul", planned: 15, actual: 12 },
  { date: "14 Jul", planned: 32, actual: 28 },
  { date: "21 Jul", planned: 48, actual: 43 },
  { date: "31 Jul", planned: 62, actual: 58 },
];

export const progressByDiscipline: DisciplineProgress[] = [
  { discipline: "Mechanical", progress: 65 },
  { discipline: "Civil", progress: 55 },
  { discipline: "Electrical", progress: 60 },
  { discipline: "Instrumentation", progress: 58 },
  { discipline: "Others", progress: 50 },
];
