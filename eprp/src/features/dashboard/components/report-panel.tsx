"use client";

import * as React from "react";
import { Download, FileText, FileType2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
import { cn } from "@/lib/utils";
import { reportFeatures, timeframeOptions } from "@/features/dashboard/config";
import type { TimeframeOption } from "@/features/dashboard/types";

/**
 * Right information panel from the reference design: export actions,
 * what the generated report includes, and the reporting timeframe.
 * Export buttons are visual placeholders — the export engine ships in a
 * later phase, so they are disabled with an explanatory note.
 */
export function ReportPanel() {
  const [timeframe, setTimeframe] =
    React.useState<TimeframeOption["id"]>("monthly");

  return (
    <div className="space-y-4">
      <SectionCard
        title="Export Report"
        description="Generate the executive report from live dashboard data."
        contentClassName="space-y-2"
      >
        <Button
          className="w-full bg-success text-white hover:bg-success/90"
          disabled
        >
          <Download data-icon="inline-start" aria-hidden="true" />
          Export Report
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled>
            <FileText data-icon="inline-start" aria-hidden="true" />
            PDF
          </Button>
          <Button variant="outline" disabled>
            <FileType2 data-icon="inline-start" aria-hidden="true" />
            DOCX
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The export engine ships in a later phase.
        </p>
      </SectionCard>

      <SectionCard
        title="Report Features"
        description="Generated reports will include:"
      >
        <ul className="space-y-2 text-sm">
          {reportFeatures.map((feature) => (
            <li key={feature.label} className="flex items-center gap-2.5">
              <feature.icon
                className="size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span>{feature.label}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="Timeframe Selection"
        description="Choose the reporting period."
      >
        <div
          role="radiogroup"
          aria-label="Reporting timeframe"
          className="space-y-1.5"
        >
          {timeframeOptions.map((option) => {
            const selected = option.id === timeframe;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTimeframe(option.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  selected
                    ? "border-primary/40 bg-primary/5 font-medium text-primary"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <option.icon className="size-4 shrink-0" aria-hidden="true" />
                {option.label}
                <span
                  aria-hidden="true"
                  className={cn(
                    "ml-auto size-2 rounded-full",
                    selected ? "bg-primary" : "bg-border"
                  )}
                />
              </button>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
