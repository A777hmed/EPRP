-- EPRP Phase 6A.2 — weekly progress KPIs.
-- Man-hours and the qualitative HSE / Quality / Overall ratings captured on
-- each weekly report. Schedule variance and SPI are NOT stored: they are
-- derived from planned_progress / actual_progress so they can never drift.

alter table public.weekly_reports
  add column man_hours_to_date integer,
  add column hse_status text,
  add column quality_status text,
  add column overall_progress_status text;

alter table public.weekly_reports
  add constraint weekly_reports_man_hours_positive
    check (man_hours_to_date is null or man_hours_to_date >= 0),
  add constraint weekly_reports_hse_status_valid
    check (
      hse_status is null
      or hse_status in ('excellent', 'good', 'fair', 'at_risk', 'critical')
    ),
  add constraint weekly_reports_quality_status_valid
    check (
      quality_status is null
      or quality_status in ('excellent', 'good', 'fair', 'at_risk', 'critical')
    ),
  add constraint weekly_reports_overall_progress_status_valid
    check (
      overall_progress_status is null
      or overall_progress_status in
        ('ahead', 'on_track', 'at_risk', 'behind', 'critical')
    );

comment on column public.weekly_reports.man_hours_to_date is
  'Cumulative man-hours expended to the end of this reporting week.';
comment on column public.weekly_reports.overall_progress_status is
  'Reported overall progress verdict for the week.';
