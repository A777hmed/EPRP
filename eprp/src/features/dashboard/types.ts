import type { LucideIcon } from "lucide-react";

import type { StatusTone } from "@/components/shared";

/** View-model types consumed by the Executive Dashboard components. */

export interface DashboardKpi {
  id: string;
  label: string;
  value: string;
  caption: string;
  icon: LucideIcon;
  tone: "default" | "success" | "warning" | "danger" | "info";
}

export interface WeeklyProgressPoint {
  week: string;
  planned: number;
  actual: number;
}

export interface CumulativePoint {
  date: string;
  planned: number;
  actual: number;
}

export interface DisciplineProgress {
  discipline: string;
  progress: number;
}

export interface ProjectProgress {
  project: string;
  actual: number;
  planned: number;
  status: "on-track" | "at-risk" | "delayed";
}

export interface RiskExposureSlice {
  severity: "High" | "Medium" | "Low";
  count: number;
}

export interface InsightList {
  title: string;
  icon: LucideIcon;
  tone: StatusTone;
  items: string[];
}

export interface StatListItem {
  label: string;
  value: string;
  tone: StatusTone;
}

export interface StatList {
  title: string;
  icon: LucideIcon;
  headline: { label: string; value: string };
  items: StatListItem[];
  footnote: string;
}

export interface ReportFeature {
  label: string;
  icon: LucideIcon;
}

export interface TimeframeOption {
  id: "weekly" | "monthly" | "quarterly" | "annual";
  label: string;
  icon: LucideIcon;
}

export interface ReportingPeriod {
  label: string;
  reportDate: string; // ISO date
}
