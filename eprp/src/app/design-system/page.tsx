import type { Metadata } from "next";
import {
  AlertTriangle,
  CalendarClock,
  FileText,
  FolderKanban,
  Inbox,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  EmptyState,
  KpiCard,
  LoadingState,
  PageHeader,
  ProgressBar,
  SectionCard,
  StatCard,
  StatusBadge,
  type StatusTone,
} from "@/components/shared";
import { PROJECT_STATUS_META } from "@/lib/constants";
import type { ProjectStatus } from "@/types";
import {
  ConfirmDialogDemo,
  ErrorStateDemo,
  FilterBarDemo,
  SearchInputDemo,
} from "./demos";

export const metadata: Metadata = {
  title: "Design System",
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

const semanticColors: { name: string; className: string; usage: string }[] = [
  { name: "Primary", className: "bg-primary", usage: "Brand actions, emphasis" },
  { name: "Success", className: "bg-success", usage: "On track, approved" },
  { name: "Warning", className: "bg-warning", usage: "At risk, pending" },
  { name: "Destructive", className: "bg-destructive", usage: "Delayed, errors" },
  { name: "Info", className: "bg-info", usage: "Completed, informational" },
  { name: "Muted", className: "bg-muted", usage: "Surfaces, disabled" },
];

const statusTones: { tone: StatusTone; label: string }[] = [
  { tone: "success", label: "Success" },
  { tone: "warning", label: "Warning" },
  { tone: "danger", label: "Danger" },
  { tone: "info", label: "Info" },
  { tone: "neutral", label: "Neutral" },
];

const projectStatuses = Object.keys(PROJECT_STATUS_META) as ProjectStatus[];

export default function DesignSystemPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-12">
        <PageHeader
          eyebrow="EPRP Foundation"
          title="Design System"
          description="Reusable building blocks for the Enterprise Progress Reporting Platform. Every component uses semantic tokens, meets WCAG AA contrast, and works in light and dark mode."
        />

        <Section
          title="Semantic Colors"
          description="Status meaning is always expressed through these tokens — never raw palette values in components."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {semanticColors.map((c) => (
              <div key={c.name} className="space-y-2">
                <div
                  className={`h-14 rounded-lg ring-1 ring-foreground/10 ${c.className}`}
                />
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.usage}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Separator />

        <Section
          title="PageHeader"
          description="Standard page heading with eyebrow, description, and an action area."
        >
          <div className="rounded-xl border p-6">
            <PageHeader
              eyebrow="Delivery"
              title="Projects"
              description="Track progress, milestones, and health across the active portfolio."
              actions={
                <>
                  <Button variant="outline">Export</Button>
                  <Button>
                    <Plus data-icon="inline-start" aria-hidden="true" />
                    New project
                  </Button>
                </>
              }
            />
          </div>
        </Section>

        <Section
          title="SectionCard"
          description="Titled container for grouping related content, with optional header action and footer."
        >
          <SectionCard
            title="Milestone summary"
            description="Progress across active milestones this quarter."
            action={
              <Button variant="ghost" size="sm">
                View all
              </Button>
            }
            footer={
              <p className="text-xs text-muted-foreground">
                Updated 5 minutes ago
              </p>
            }
          >
            <div className="space-y-4">
              <ProgressBar label="Foundation works" value={92} tone="success" />
              <ProgressBar label="Structural steel" value={64} />
              <ProgressBar label="MEP installation" value={31} tone="warning" />
            </div>
          </SectionCard>
        </Section>

        <Section
          title="StatCard"
          description="Compact metric tiles for dense stat rows, with optional trend delta and helper text."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Active Projects"
              value="24"
              icon={FolderKanban}
              delta={{ value: "+3", trend: "up", positive: true }}
              helper="vs. last month"
            />
            <StatCard
              label="Reports Submitted"
              value="128"
              icon={FileText}
              delta={{ value: "+12%", trend: "up", positive: true }}
              helper="vs. last month"
            />
            <StatCard
              label="Open Risks"
              value="9"
              icon={AlertTriangle}
              delta={{ value: "+2", trend: "up", positive: false }}
              helper="vs. last month"
            />
            <StatCard
              label="Avg. Cycle Time"
              value="6.4 d"
              icon={CalendarClock}
              delta={{ value: "0.0", trend: "flat" }}
              helper="no change"
            />
          </div>
        </Section>

        <Section
          title="KPI Card"
          description="Executive KPI tiles with recent-history sparkline and progress toward target."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Portfolio Progress"
              value="68%"
              helper="vs. 61% last quarter"
              trend={[48, 52, 51, 57, 60, 63, 62, 68]}
              trendDescription="Portfolio progress rising from 48% to 68% over eight weeks"
              progress={68}
              targetLabel="Target 75%"
            />
            <KpiCard
              label="Budget Utilization"
              value="$4.2M"
              helper="of $6.0M approved"
              trend={[1.1, 1.6, 2.0, 2.4, 2.9, 3.3, 3.8, 4.2]}
              trendDescription="Budget utilization rising steadily to $4.2M"
              progress={70}
              targetLabel="70% consumed"
            />
            <KpiCard
              label="On-Time Milestones"
              value="87%"
              helper="26 of 30 this quarter"
              trend={[91, 90, 88, 92, 89, 86, 88, 87]}
              trendDescription="On-time milestone rate holding near 87–92%"
              progress={87}
              targetLabel="Target 90%"
            />
          </div>
        </Section>

        <Section
          title="StatusBadge"
          description="Semantic status pills. The leading dot reinforces state so meaning never relies on color alone."
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {statusTones.map((t) => (
                <StatusBadge key={t.tone} tone={t.tone}>
                  {t.label}
                </StatusBadge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {projectStatuses.map((status) => (
                <StatusBadge
                  key={status}
                  tone={PROJECT_STATUS_META[status].tone}
                >
                  {PROJECT_STATUS_META[status].label}
                </StatusBadge>
              ))}
            </div>
          </div>
        </Section>

        <Section
          title="ProgressBar"
          description="Determinate progress with semantic tones and two sizes; values are tabular so columns never shift."
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-4">
              <ProgressBar label="Default" value={62} />
              <ProgressBar label="Success" value={88} tone="success" />
              <ProgressBar label="Warning" value={45} tone="warning" />
              <ProgressBar label="Danger" value={18} tone="danger" />
            </div>
            <div className="space-y-4">
              <ProgressBar label="Small size" value={62} size="sm" />
              <ProgressBar
                label="Without value"
                value={40}
                showValue={false}
              />
              <ProgressBar ariaLabel="Unlabeled progress" value={75} />
            </div>
          </div>
        </Section>

        <Section
          title="EmptyState"
          description="Explains why a view is empty and offers the next step."
        >
          <EmptyState
            icon={Inbox}
            title="No reports yet"
            description="Progress reports submitted by project managers will appear here once the first reporting period opens."
            action={
              <Button>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Create report
              </Button>
            }
          />
        </Section>

        <Section
          title="LoadingState"
          description="Skeletons reserve layout space to avoid content shift; the spinner is for short inline waits."
        >
          <div className="space-y-6">
            <LoadingState variant="card" count={4} />
            <LoadingState variant="table" count={3} />
            <div className="rounded-xl border">
              <LoadingState variant="spinner" />
            </div>
          </div>
        </Section>

        <Section
          title="ErrorState"
          description="Failure placeholder with a clear recovery path."
        >
          <ErrorStateDemo />
        </Section>

        <Section
          title="SearchInput"
          description="Search field with leading icon and clear button; controlled or uncontrolled."
        >
          <SearchInputDemo />
        </Section>

        <Section
          title="FilterBar"
          description="Lines up filter controls above tables and grids, with a reset affordance once filters are active."
        >
          <FilterBarDemo />
        </Section>

        <Section
          title="Dialog"
          description="Confirmation dialogs with async pending state; destructive actions are visually separated."
        >
          <ConfirmDialogDemo />
        </Section>
      </div>
    </main>
  );
}
