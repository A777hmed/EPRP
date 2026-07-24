import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";

import { PageHeader, StatusBadge } from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import {
  CumulativeCurveChart,
  DisciplineChart,
  InsightCard,
  KpiTile,
  ProgressTrendChart,
  ProjectProgressChart,
  ReportPanel,
  RiskExposureChart,
  StatListCard,
} from "@/features/dashboard";
import {
  cumulativeProgressCurve,
  dashboardKpis,
  delayedActivities,
  hseStatistics,
  majorAchievements,
  monthlyProgressTrend,
  openIssues,
  progressByDiscipline,
  progressByProject,
  qualityStatistics,
  reportingPeriod,
  riskExposure,
  topRisks,
} from "@/data/mock";

export const metadata: Metadata = {
  title: "Executive Dashboard",
};

export default function DashboardPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <PageHeader
          eyebrow="Overview"
          title="Executive Dashboard"
          description="Portfolio-wide progress, performance, and risk at a glance."
          actions={
            <>
              <StatusBadge tone="info" hideDot>
                {reportingPeriod.label}
              </StatusBadge>
              <span className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <CalendarDays className="size-3.5" aria-hidden="true" />
                Report Date:{" "}
                <span className="text-foreground tabular-nums">
                  {formatDate(reportingPeriod.reportDate)}
                </span>
              </span>
            </>
          }
        />

        {/* KPI row */}
        <section aria-label="Key performance indicators">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
            {dashboardKpis.map((kpi) => (
              <KpiTile
                key={kpi.id}
                label={kpi.label}
                value={kpi.value}
                caption={kpi.caption}
                icon={kpi.icon}
                tone={kpi.tone}
              />
            ))}
          </div>
        </section>

        {/* Progress charts */}
        <section aria-label="Progress charts" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ProgressTrendChart data={monthlyProgressTrend} />
            <CumulativeCurveChart data={cumulativeProgressCurve} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DisciplineChart data={progressByDiscipline} />
            <RiskExposureChart data={riskExposure} />
          </div>
          <ProjectProgressChart data={progressByProject} />
        </section>

        {/* Executive information */}
        <section
          aria-label="Executive information"
          className="grid gap-4 sm:grid-cols-2"
        >
          <InsightCard insight={majorAchievements} />
          <InsightCard insight={delayedActivities} />
          <InsightCard insight={topRisks} />
          <InsightCard insight={openIssues} />
          <StatListCard stats={hseStatistics} />
          <StatListCard stats={qualityStatistics} />
        </section>
      </div>

      {/* Right information panel */}
      <aside aria-label="Report panel" className="min-w-0">
        <div className="xl:sticky xl:top-[4.5rem]">
          <ReportPanel />
        </div>
      </aside>
    </div>
  );
}
