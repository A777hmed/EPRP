-- EPRP OC-4 — position editor fields.
--
-- Adds the attributes the editor captures that the position did not already
-- carry. Everything here describes the *position*, not the person: a role
-- can have its own contact details and a validity period regardless of who
-- currently fills it, and keeps them when it falls vacant.

alter table public.organization_positions
  -- The employing organisation for this seat (client, main contractor, …).
  add column company         text,
  add column employment_type text,
  -- Contact details for the role itself. When empty, the UI falls back to
  -- the assigned contact's own details rather than duplicating them.
  add column email           text,
  add column phone           text,
  add column status          text not null default 'active',
  -- Validity period of the position within the project.
  add column start_date      date,
  add column end_date        date;

alter table public.organization_positions
  add constraint organization_positions_status_valid
    check (status in ('active', 'vacant', 'planned', 'on_hold', 'closed')),
  add constraint organization_positions_employment_type_valid
    check (
      employment_type is null
      or employment_type in ('staff', 'contract', 'secondment', 'agency')
    ),
  add constraint organization_positions_dates_valid
    check (end_date is null or start_date is null or end_date >= start_date);

create index idx_organization_positions_status
  on public.organization_positions(status);

comment on column public.organization_positions.status is
  'Lifecycle of the seat: active | vacant | planned | on_hold | closed.';
comment on column public.organization_positions.email is
  'Role inbox. Falls back to the assigned contact when null.';
comment on column public.organization_positions.company is
  'Employing organisation for this seat, independent of the occupant.';
