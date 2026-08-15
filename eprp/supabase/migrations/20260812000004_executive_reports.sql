-- EPRP Phase 10 — minimum safe Executive Report persistence.
--
-- WHAT THIS IS FOR
--   The Executive Report is composed live from approved Monthly Reports. This
--   table does NOT store that composition — it stores only the small amount of
--   content the EXECUTIVE TIER OWNS, so that Edit and Delete have something
--   real to act on:
--
--     * the reviewed Executive Summary wording
--     * who prepared it, when overridden
--     * its lifecycle state
--
--   Everything else — planned, actual, variance, health, risks, actions,
--   milestones, Weekly movement — remains derived on every load and is never
--   copied here. That is what keeps `03_REPORTING_ARCHITECTURE.md` Law 1 intact
--   and stops the Executive tier becoming a second source of truth.
--
-- WHY DELETING ONE IS SAFE
--   This table holds NO foreign key onto projects, Weekly reports, Monthly
--   reports, comments, risks, actions, milestones or contacts' owning records.
--   The only reference is `prepared_by_contact_ids`, an array of ids with no FK
--   and therefore no cascade. Deleting a row here CANNOT reach source data by
--   any path — there is no path to reach it by.
--
-- ONE REPORT PER PERIOD
--   A portfolio report covers every authorized project for a reporting month,
--   so `reporting_month` is unique. There is deliberately no per-project
--   Executive Report: projects are drill-downs beneath the portfolio.

create table public.executive_reports (
  id uuid primary key default gen_random_uuid(),
  reporting_month date not null unique,
  status text not null default 'draft',

  -- Executive-owned content. NULL means "use the auto-drafted narrative".
  executive_summary text,

  -- Preparer override. Plain uuid[] with no foreign key, deliberately: this is
  -- a record of who was named at the time, and it must not gain the power to
  -- block or cascade a contact deletion.
  prepared_by_contact_ids uuid[] not null default '{}',

  -- Executive metadata.
  title text,
  confidentiality text,

  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint executive_reports_month_start
    check (reporting_month = date_trunc('month', reporting_month)::date),
  constraint executive_reports_status_valid
    check (status in ('draft', 'under_review', 'approved', 'locked', 'archived'))
);

create trigger set_updated_at
  before update on public.executive_reports
  for each row execute function public.set_updated_at();

comment on table public.executive_reports is
  'Executive-owned report content only (reviewed summary, preparer override, lifecycle). Derived figures are never stored here. Holds no FK onto source data, so deleting a row cannot affect Weekly, Monthly or project records.';

/* ------------------------------- Authorship -------------------------------- */

create or replace function public.set_executive_report_authorship()
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
    -- Archiving stamps itself, so the date cannot drift from the state.
    if new.status = 'archived' and old.status <> 'archived' then
      new.archived_at := now();
    elsif new.status <> 'archived' then
      new.archived_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger executive_reports_authorship
  before insert or update on public.executive_reports
  for each row execute function public.set_executive_report_authorship();

/* --------------------------- Delete is governed ---------------------------- */

/**
 * A report that has been approved is part of the reporting record.
 *
 * Hard delete is refused past approval at DATABASE level, not merely hidden in
 * the UI: an approved report is archived instead, which withdraws it from use
 * while leaving it readable (§10.2). A draft has never been issued and may be
 * deleted outright.
 */
create or replace function public.guard_executive_report_delete()
returns trigger language plpgsql as $$
begin
  if old.status in ('approved', 'locked') then
    raise exception
      'Executive Report % is % and cannot be deleted. Archive it instead — an issued report stays readable.',
      old.reporting_month, old.status;
  end if;
  return old;
end;
$$;

create trigger executive_reports_delete_guard
  before delete on public.executive_reports
  for each row execute function public.guard_executive_report_delete();

/* ------------------------------ Authorization ------------------------------ */

create index idx_executive_reports_month on public.executive_reports(reporting_month desc);

alter table public.executive_reports enable row level security;

-- Any authenticated reader of the Executive module may read the record; the
-- figures it accompanies are already filtered per reader by their own policies.
create policy executive_reports_select on public.executive_reports
  for select to authenticated
  using (true);

-- Authoring is limited to the Executive roles, reusing the helper introduced
-- alongside executive_notes.
create policy executive_reports_insert on public.executive_reports
  for insert to authenticated
  with check (public.executive_can_manage());

create policy executive_reports_update on public.executive_reports
  for update to authenticated
  using (public.executive_can_manage())
  with check (public.executive_can_manage());

create policy executive_reports_delete on public.executive_reports
  for delete to authenticated
  using (public.executive_can_manage());

/* -------------------------- Post-condition check --------------------------- */

do $$
declare fk_count integer;
begin
  -- Prove the safety claim rather than asserting it: this table must hold no
  -- foreign key onto any reporting or project table.
  select count(*) into fk_count
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
   where tc.table_name = 'executive_reports'
     and tc.constraint_type = 'FOREIGN KEY'
     and ccu.table_name in (
       'projects', 'weekly_reports', 'weekly_submissions', 'weekly_entries',
       'monthly_reports', 'monthly_comments', 'monthly_plan_items', 'contacts'
     );

  if fk_count > 0 then
    raise exception
      'Post-check failed: executive_reports carries % foreign key(s) onto source data; deleting one could affect reporting records.',
      fk_count;
  end if;

  raise notice 'executive_reports created; no foreign keys onto source data.';
end;
$$;
