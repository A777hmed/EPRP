import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Gauge,
  Target,
  TrendingUp,
} from "lucide-react";

import type { DashboardKpi } from "@/features/dashboard/types";

/** Mock KPI values mirroring the approved reference mockups. */
export const dashboardKpis: DashboardKpi[] = [
  {
    id: "planned",
    label: "Planned Progress",
    value: "62%",
    caption: "Cumulative",
    icon: Target,
    tone: "info",
  },
  {
    id: "actual",
    label: "Actual Progress",
    value: "58%",
    caption: "Cumulative",
    icon: TrendingUp,
    tone: "success",
  },
  {
    id: "variance",
    label: "Schedule Variance",
    value: "-4%",
    caption: "Behind",
    icon: Activity,
    tone: "danger",
  },
  {
    id: "spi",
    label: "SPI",
    value: "0.94",
    caption: "Index",
    icon: Gauge,
    tone: "warning",
  },
  {
    id: "status",
    label: "Overall Status",
    value: "Behind",
    caption: "Schedule",
    icon: AlertTriangle,
    tone: "warning",
  },
  {
    id: "actions",
    label: "Open Actions",
    value: "12",
    caption: "Open",
    icon: ClipboardList,
    tone: "default",
  },
];
