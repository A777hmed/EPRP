import {
  AlertTriangle,
  CheckCircle2,
  MessagesSquare,
  ShieldAlert,
} from "lucide-react";

import type {
  InsightList,
  RiskExposureSlice,
} from "@/features/dashboard/types";

export const riskExposure: RiskExposureSlice[] = [
  { severity: "High", count: 3 },
  { severity: "Medium", count: 5 },
  { severity: "Low", count: 8 },
];

export const majorAchievements: InsightList = {
  title: "Major Achievements",
  icon: CheckCircle2,
  tone: "success",
  items: [
    "Completed piping installation at Unit 200",
    "Mechanical completion for Pump House",
    "Electrical cable tray installation 70% completed",
    "Zero Lost Time Injury recorded this month",
  ],
};

export const delayedActivities: InsightList = {
  title: "Delayed Activities",
  icon: AlertTriangle,
  tone: "warning",
  items: [
    "Heat exchanger E-201 delivery delayed",
    "Civil works at Tank Farm area behind schedule",
  ],
};

export const topRisks: InsightList = {
  title: "Top Risks",
  icon: ShieldAlert,
  tone: "danger",
  items: [
    "Delay in material delivery",
    "Weather conditions impact civil works",
    "Resource shortage for critical activities",
  ],
};

export const openIssues: InsightList = {
  title: "Issues",
  icon: MessagesSquare,
  tone: "info",
  items: ["Pending vendor drawings", "Limited access in some work areas"],
};
