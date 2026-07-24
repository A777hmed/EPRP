-- OC-6: editable chart metadata (Chart Management UI).
--
-- Adds the two attributes the management panel edits that the review
-- lifecycle did not already cover: the kind of structure the chart
-- represents, and the date it takes effect. Name and description already
-- exist; source stays as the record of how the chart was first created.

begin;

alter table public.organization_charts
  add column if not exists chart_type text,
  add column if not exists effective_date date;

alter table public.organization_charts
  drop constraint if exists organization_charts_chart_type_valid;

alter table public.organization_charts
  add constraint organization_charts_chart_type_valid
    check (
      chart_type is null
      or chart_type in ('epc', 'epcm', 'construction', 'turnaround', 'custom')
    );

comment on column public.organization_charts.chart_type is
  'Project structure kind (EPC/EPCM/…). Distinct from source, which records how the chart was started.';
comment on column public.organization_charts.effective_date is
  'The date this chart takes effect from.';

commit;
