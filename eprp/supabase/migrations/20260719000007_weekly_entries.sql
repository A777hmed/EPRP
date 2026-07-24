-- EPRP Phase 6A.4 — key comments, risks, issues, and action items.
--
-- All four share one field set, so `weekly_comments` is generalised into
-- `weekly_entries` with an `entry_type` discriminator rather than creating
-- three more near-identical tables.

alter table public.weekly_comments rename to weekly_entries;

alter table public.weekly_entries rename column text to description;
alter table public.weekly_entries rename column important to include_in_monthly;
alter table public.weekly_entries rename column author_contact_id to owner_contact_id;

alter table public.weekly_entries
  add column entry_type text not null default 'comment',
  add column status text not null default 'open',
  add column due_date date,
  add column system_id uuid references public.systems(id) on delete set null,
  add column discipline_id uuid references public.disciplines(id) on delete set null;

alter table public.weekly_entries
  add constraint weekly_entries_entry_type_valid
    check (entry_type in ('comment', 'risk', 'issue', 'action')),
  add constraint weekly_entries_status_valid
    check (status in ('open', 'in_progress', 'resolved', 'closed', 'escalated')),
  add constraint weekly_entries_category_valid
    check (
      category in (
        'progress', 'risk', 'issue', 'hse',
        'quality', 'financial', 'escalation', 'general'
      )
    ),
  add constraint weekly_entries_priority_valid
    check (priority in ('low', 'medium', 'high', 'critical'));

-- Keep object names consistent with the new table name.
alter index idx_weekly_comments_report_id rename to idx_weekly_entries_report_id;
alter policy weekly_comments_authenticated_all on public.weekly_entries
  rename to weekly_entries_authenticated_all;

create index idx_weekly_entries_entry_type on public.weekly_entries(entry_type);
create index idx_weekly_entries_owner_contact_id on public.weekly_entries(owner_contact_id);
create index idx_weekly_entries_due_date on public.weekly_entries(due_date);
create index idx_weekly_entries_include_in_monthly
  on public.weekly_entries(include_in_monthly) where include_in_monthly;

comment on column public.weekly_entries.entry_type is
  'Discriminator: comment | risk | issue | action.';
comment on column public.weekly_entries.include_in_monthly is
  'Roll this entry up into the monthly report.';
