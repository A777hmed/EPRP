# Report Generation — Executive Report and A4 Output

> The composition and print output of the Executive / Company-President report.
> This is the operating detail beneath
> [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) §6, §17 and §18,
> which is authoritative on generation rules. Its portfolio-dashboard sections
> (§2, §3, §5) belong to `08_DASHBOARD_ARCHITECTURE.md` and should move there
> when that document is written.

## 1. Purpose

The Executive Report gives the company president and senior management a concise, trustworthy view of all projects. It should answer three questions quickly:

1. Which projects are healthy or delayed?
2. What risks or decisions need leadership attention?
3. What changed during this reporting period?

## 2. Portfolio dashboard

Show portfolio-level KPIs:

- Total projects.
- Active, on-track, at-risk, delayed, critical, and completed projects.
- Overall planned progress.
- Overall actual progress.
- Schedule variance and SPI where available.
- Open critical risks and issues.
- Overdue actions.
- HSE and quality summary.
- Decisions required from management.

Filters should include project, client, project manager, status, week/month, and reporting period.

## 3. Project executive cards

Each project should display:

- Project name, code, and client.
- Overall status.
- Planned %, actual %, variance, SPI.
- Main achievement.
- Main delay or constraint.
- Top risk.
- Required management decision.
- Next major milestone.
- Most recent approved Weekly/Monthly period.

## 4. Executive comments

Show only comments explicitly marked `Executive`. Each item includes project, department, priority, status, owner, due date, source period, and latest update. Do not show every operational comment by default.

## 5. Trends and charts

Use compact, readable visualizations:

- Planned vs actual progress.
- Progress trend across reporting periods.
- Project health distribution.
- Department or project comparison.
- Risk/issue priority distribution.
- Open versus closed actions.

Charts must have clear labels and must not rely on color alone.

## 6. Decisions required

Provide a dedicated list for decisions that need leadership action:

- Decision text.
- Project.
- Requested by.
- Owner.
- Due date.
- Priority.
- Status.
- Supporting comment or document.

## 7. One-page A4 output

Create a separate print view designed for one A4 page. It should include:

- EPROM/company logo and optional client logo.
- Report title, period, date, and confidentiality label.
- Compact KPI cards.
- Two or three compact charts.
- Executive summary of no more than 4–5 lines.
- Top achievements.
- Top risks.
- Executive comments.
- Decisions required.
- Next period plan / Look Ahead.
- Prepared, reviewed, and approved by.
- Page 1 of 1.

Hide navigation, editing controls, and interactive-only elements in print mode. Use print-safe CSS and avoid overcrowding; show only top-ranked items.

## 8. Portfolio versus project report

- **Project Executive Report:** one selected project with deeper project context.
- **Portfolio Executive Report:** all authorized projects, with concise cards and cross-project KPIs.

Both use the same approved data model and export conventions.

