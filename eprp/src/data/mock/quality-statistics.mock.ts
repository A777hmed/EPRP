import { ClipboardCheck } from "lucide-react";

import type { StatList } from "@/features/dashboard/types";

export const qualityStatistics: StatList = {
  title: "Quality Statistics",
  icon: ClipboardCheck,
  headline: { label: "Inspection hold points passed", value: "98%" },
  items: [
    { label: "ITR Closure", value: "93%", tone: "success" },
    { label: "Open NCRs", value: "4", tone: "warning" },
    { label: "Welding Repair Rate", value: "1.8%", tone: "success" },
    { label: "Audits Completed", value: "3", tone: "neutral" },
  ],
  footnote: "As of 31 Jul 2026",
};
