import { HeartPulse } from "lucide-react";

import type { StatList } from "@/features/dashboard/types";

export const hseStatistics: StatList = {
  title: "HSE Statistics",
  icon: HeartPulse,
  headline: { label: "Man-hours to date", value: "1,250,000" },
  items: [
    { label: "Lost Time Injuries", value: "0", tone: "success" },
    { label: "Recordable Injuries", value: "2", tone: "warning" },
    { label: "First Aid Cases", value: "5", tone: "neutral" },
    { label: "Near Misses", value: "7", tone: "neutral" },
  ],
  footnote: "As of 31 Jul 2026",
};
