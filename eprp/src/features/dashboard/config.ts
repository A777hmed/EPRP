import {
  BarChart3,
  FileCheck2,
  FileText,
  Gauge,
  HeartPulse,
  Landmark,
  Link2,
  ListChecks,
  PenLine,
  ShieldAlert,
  Users,
} from "lucide-react";

import type { ReportFeature, TimeframeOption } from "./types";

/**
 * Static UI configuration for the dashboard report panel (not mock data —
 * these lists describe the product itself and survive database integration).
 */

export const reportFeatures: ReportFeature[] = [
  { label: "Executive Summary", icon: FileText },
  { label: "KPIs & Performance", icon: Gauge },
  { label: "Charts & Trends", icon: BarChart3 },
  { label: "Risks, Issues & Actions", icon: ShieldAlert },
  { label: "HSE & Quality Stats", icon: HeartPulse },
  { label: "Manpower & Resources", icon: Users },
  { label: "Financial Summary", icon: Landmark },
  { label: "Approvals & Signatures", icon: PenLine },
  { label: "Linked Documents", icon: Link2 },
];

export const timeframeOptions: TimeframeOption[] = [
  { id: "weekly", label: "Weekly Report", icon: ListChecks },
  { id: "monthly", label: "Monthly Report", icon: FileCheck2 },
  { id: "quarterly", label: "Quarterly Report", icon: FileText },
  { id: "annual", label: "Annual Report", icon: Landmark },
];
