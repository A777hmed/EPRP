-- EPRP Phase 11 — project-scoped calendar events (MOM / KOM / meetings).
--
-- WHY A NEW ENTITY IS NEEDED
--   Nothing in the existing 29 tables can carry a meeting. Milestones live on
--   `weekly_plan_items` (kind='milestone') and `monthly_plan_items`, and report
--   due dates are derivable from `weekly_reports` / `monthly_reports` — those
--   stay DERIVED and are never copied here. What has no home at all is the
--   scheduled-activity record: MOM, KOM, meetings, client meetings, workshops
--   and reminders, with a time, a location, an organizer and attendees.
--
-- WHAT THIS DELIBERATELY IS NOT
--   Not a meeting-management system. There is no minutes body, no approval
--   workflow, no recurrence, no notification fan-out. This is the minimum
--   robust foundation the Dashboard preview and the Calendar workspace need,
--   sized so that MOM/KOM can later grow on the SAME record rather than
--   arriving as a second, disconnected one.
--
-- ADDITIVE ONLY
--   Two new tables. No existing table, column, policy, function or row is
--   altered or removed. Weekly, Monthly, Executive, Project, Department and
--   Contact data are untouched.
--
-- OWNERSHIP AND DELETION
--   An event belongs to its project, so `project_id` cascades: deleting a
--   project takes its own calendar with it, which is correct. Every other
--   reference (department, organizer, attendee contact) is ON DELETE SET NULL
--   so that archiving a contact or department can never be blocked by, or
--   silently destroy, a calendar entry.
--
--   `related_id` intentionally carries NO foreign key. It is a soft pointer to
--   a Weekly/Monthly/Executive record for convenience; giving it a real FK
--   would let a calendar row block the deletion of a report, which inverts the
--   ownership the reporting architecture depends on.

/* ------------------------------- Events ----------------------------------- */

create table public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,

  event_type text not null,
  title text not null,
  event_date date not null,
  start_time time,
  end_time time,
  location text,

  organizer_contact_id uuid references public.contacts(id) on delete set null,
  status text not null default 'scheduled',
  description text,

  -- Soft link to the record this event is about. No FK, by design (see header).
  related_kind text,
  related_id uuid,

  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_events_title_not_blank
    check (length(btrim(title)) > 0),
  constraint project_events_type_valid
    check (event_type in (
      'mom', 'kom', 'meeting', 'client_meeting',
      'workshop', 'milestone', 'reminder', 'report_due'
    )),
  constraint project_events_status_valid
    check (status in ('scheduled', 'completed', 'cancelled', 'postponed')),
  constraint project_events_time_order
    check (start_time is null or end_time is null or start_time <= end_time),
  constraint project_events_related_pair
    check ((related_kind is null) = (related_id is null)),
  constraint project_events_related_kind_valid
    check (related_kind is null or related_kind in (
      'weekly_report', 'monthly_report', 'executive_report'
    ))
);

comment on table public.project_events is
  'Project-scoped scheduled activities (MOM, KOM, meetings, workshops, reminders). Milestones and report due dates are DERIVED from plan items and reports and are not stored here. Holds no foreign key onto any reporting record.';

comment on column public.project_events.related_id is
  'Soft pointer to a Weekly/Monthly/Executive record. Deliberately without a foreign key so a calendar entry can never block deletion of a report.';

create trigger set_updated_at
  before update on public.project_events
  for each row execute function public.set_updated_at();

/* ------------------------------ Attendees --------------------------------- */

/**
 * An attendee is either a platform contact OR a free-typed name.
 *
 * Meetings routinely include client representatives and external parties who
 * have no reason to exist in project master data. Requiring a Contact row for
 * each would pollute every contact dropdown in the platform, so `name` carries
 * the external case and `contact_id` the internal one.
 *
 * `display_name` is filled for BOTH: for a contact it is a snapshot of the name
 * as it was when invited, so an attendee list of a past meeting does not
 * silently rewrite itself when somebody is renamed.
 */
create table public.project_event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.project_events(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  display_name text not null,
  organization text,
  response text not null default 'invited',
  created_at timestamptz not null default now(),

  constraint project_event_attendees_name_not_blank
    check (length(btrim(display_name)) > 0),
  constraint project_event_attendees_response_valid
    check (response in ('invited', 'accepted', 'declined', 'tentative'))
);

comment on table public.project_event_attendees is
  'Attendees of a project event. Either a linked contact or a free-typed external name; display_name is snapshotted in both cases so a past attendee list stays stable.';

/* -------------------------------- Indexes --------------------------------- */

-- The calendar always queries a DATE RANGE within a project scope.
create index idx_project_events_project_date
  on public.project_events(project_id, event_date);
create index idx_project_events_date
  on public.project_events(event_date);
create index idx_project_events_type
  on public.project_events(event_type);
create index idx_project_event_attendees_event
  on public.project_event_attendees(event_id);

/* ------------------------------ Authorization ----------------------------- */

alter table public.project_events enable row level security;
alter table public.project_event_attendees enable row level security;

/*
 * Scope reuses the EXISTING project predicates rather than inventing a parallel
 * rule. Read follows `weekly_can_access_project` (admin, project consolidation
 * roles, or any scoped assignment on the project); write follows
 * `weekly_can_manage_project` (admin, Project Control Manager, Reporting
 * Coordinator). No policy here weakens or redefines either helper.
 */
create policy project_events_select on public.project_events
  for select to authenticated
  using (public.weekly_can_access_project(project_id));

create policy project_events_insert on public.project_events
  for insert to authenticated
  with check (public.weekly_can_manage_project(project_id));

create policy project_events_update on public.project_events
  for update to authenticated
  using (public.weekly_can_manage_project(project_id))
  with check (public.weekly_can_manage_project(project_id));

create policy project_events_delete on public.project_events
  for delete to authenticated
  using (public.weekly_can_manage_project(project_id));

/** The project of an event, for the attendee policies. */
create or replace function public.project_event_project(p_event uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select project_id from public.project_events where id = p_event;
$$;

create policy project_event_attendees_select on public.project_event_attendees
  for select to authenticated
  using (public.weekly_can_access_project(public.project_event_project(event_id)));

create policy project_event_attendees_insert on public.project_event_attendees
  for insert to authenticated
  with check (public.weekly_can_manage_project(public.project_event_project(event_id)));

create policy project_event_attendees_update on public.project_event_attendees
  for update to authenticated
  using (public.weekly_can_manage_project(public.project_event_project(event_id)))
  with check (public.weekly_can_manage_project(public.project_event_project(event_id)));

create policy project_event_attendees_delete on public.project_event_attendees
  for delete to authenticated
  using (public.weekly_can_manage_project(public.project_event_project(event_id)));

/* ------------------------------- Authorship -------------------------------- */

create or replace function public.set_project_event_authorship()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  select full_name into actor_name from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_by_name := coalesce(new.created_by_name, actor_name);
    new.updated_by := new.created_by;
    new.updated_by_name := new.created_by_name;
  else
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.updated_by := coalesce(auth.uid(), old.updated_by);
    new.updated_by_name := coalesce(actor_name, old.updated_by_name);
  end if;
  return new;
end;
$$;

create trigger project_events_authorship
  before insert or update on public.project_events
  for each row execute function public.set_project_event_authorship();

/* -------------------------- Post-condition check --------------------------- */

do $$
declare reporting_fk integer;
begin
  -- Prove the additive claim: the calendar must hold no foreign key onto any
  -- REPORTING record, so deleting an event cannot reach Weekly, Monthly or
  -- Executive data, and a calendar entry cannot block a report being removed.
  select count(*) into reporting_fk
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
   where tc.table_name in ('project_events', 'project_event_attendees')
     and tc.constraint_type = 'FOREIGN KEY'
     and ccu.table_name in (
       'weekly_reports', 'weekly_submissions', 'weekly_entries',
       'weekly_plan_items', 'monthly_reports', 'monthly_comments',
       'monthly_plan_items', 'executive_reports', 'executive_notes'
     );

  if reporting_fk > 0 then
    raise exception
      'Post-check failed: project_events carries % foreign key(s) onto reporting data.',
      reporting_fk;
  end if;

  raise notice 'project_events + project_event_attendees created; no foreign keys onto reporting data.';
end;
$$;
