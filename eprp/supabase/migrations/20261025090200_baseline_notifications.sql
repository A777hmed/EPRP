-- Phase 13.12 (browser UAT) — notifications for Baseline Revision requests and
-- decisions (found by UAT: a BL0 request awaited a decision, but no approver
-- was told).
--
-- SCOPE: Baseline Revisions ONLY, on the EXISTING notification system — the
-- same user_notifications rows, read-time visibility, action-required rule,
-- Clear history, reconcile safety net, bell, inbox and compact toast as the
-- 13.9B Setup Amendment notifications. No second notification system.
--
-- WHAT THIS ADDS
--   * user_notifications.baseline_id — the Baseline Revision a baseline_* row
--     points at (ON DELETE CASCADE). source_id keeps its meaning and its foreign
--     key to project_setup_amendments for amendment_* rows; each row carries
--     exactly one of the two.
--   * Event types:
--       baseline_requested — every active System Administrator / Project Control
--         Admin EXCEPT the requester (B3 / B8), one row each (unique index);
--       baseline_approved / baseline_rejected — the requester.
--     A withdrawal sends nothing (as for amendments): approvers' rows simply stop
--     being visible and actionable.
--   * Actionability decided when the inbox is READ, never by changing a
--     baseline: a baseline_requested row is visible only while the request is
--     still requested, its project is not archived and the reader is still an
--     active approver; it requires action (never cleared) while requested.
--   * reconcile_my_setup_amendment_notifications() also creates a missing
--     baseline_requested row for the caller (an approver created or promoted
--     after the request still finds it).
--   * A one-time backfill of baseline_requested rows for requests pending today.
--
-- UNCHANGED: every amendment_* row and rule, the Baseline Revision functions and
-- guards, B3 / B8, archived and no-formal-schedule behaviour.

/* --------------------------------- columns -------------------------------- */

alter table public.user_notifications
  alter column source_id drop not null,
  add column baseline_id uuid references public.planning_baselines(id) on delete cascade;

alter table public.user_notifications drop constraint user_notifications_event_valid;
alter table public.user_notifications
  add constraint user_notifications_event_valid check (event_type in (
    'amendment_submitted', 'amendment_approved', 'amendment_rejected', 'amendment_stale', 'amendment_frozen',
    'baseline_requested', 'baseline_approved', 'baseline_rejected')),
  -- An amendment row points at its amendment; a baseline row at its Baseline Revision.
  add constraint user_notifications_source_shape check (
    (event_type like 'amendment\_%' and source_id is not null and baseline_id is null)
    or (event_type like 'baseline\_%' and baseline_id is not null and source_id is null));

create unique index user_notifications_one_per_baseline_event
  on public.user_notifications (recipient_id, event_type, baseline_id) where baseline_id is not null;

comment on column public.user_notifications.baseline_id is
  '13.12. The Baseline Revision a baseline_* notification points at (source_id is then null).';

/* ------------------------------- visibility ------------------------------- */

-- Same signature; the amendment branch is unchanged. p_source is the row's
-- source: its amendment (amendment_*) or its Baseline Revision (baseline_*).
create or replace function public.setup_notification_visible(p_event text, p_source uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select case
    when p_event = 'amendment_submitted' then
      public.has_global_operational_authority()
      and exists (select 1 from public.project_setup_amendments a
                   where a.id = p_source and a.status = 'pending'
                     and not public.project_is_archived(a.project_id))
    when p_event = 'baseline_requested' then
      public.has_global_operational_authority()
      and exists (select 1 from public.planning_baselines b
                   where b.id = p_source and b.revision_status = 'requested'
                     and not public.project_is_archived(b.project_id))
    else true
  end;
$fn$;

create or replace function public.notification_requires_action(p_event text, p_source uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select case
    when p_event = 'amendment_submitted' then exists (
      select 1 from public.project_setup_amendments a where a.id = p_source and a.status = 'pending')
    when p_event = 'baseline_requested' then exists (
      select 1 from public.planning_baselines b where b.id = p_source and b.revision_status = 'requested')
    else false
  end;
$fn$;

drop policy user_notifications_select on public.user_notifications;
create policy user_notifications_select on public.user_notifications
  for select to authenticated
  using (recipient_id = (select auth.uid())
         and cleared_at is null
         and public.current_user_role() is not null
         and public.setup_notification_visible(event_type, coalesce(source_id, baseline_id)));

create or replace function public.clear_my_notification_history()
returns integer language plpgsql security definer set search_path = '' as $fn$
declare
  v_cleared integer;
begin
  if auth.uid() is null or public.current_user_role() is null then
    raise exception using errcode = '42501', message = '[NOT_AUTHORISED] Sign in to clear your notifications.';
  end if;
  update public.user_notifications n
     set cleared_at = now()
   where n.recipient_id = auth.uid()
     and n.cleared_at is null
     and not public.notification_requires_action(n.event_type, coalesce(n.source_id, n.baseline_id));
  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$fn$;

/* --------------------------------- events --------------------------------- */

create function public.notify_planning_baseline_event()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then
    if new.revision_status = 'requested' then
      insert into public.user_notifications (recipient_id, event_type, project_id, baseline_id, actor_name, created_at)
      select p.id, 'baseline_requested', new.project_id, new.id,
             (select r.full_name from public.profiles r where r.id = new.requested_by_user_id), new.requested_at
        from public.profiles p
       where p.active and p.role in ('system_admin', 'project_control_admin')
         and p.id is distinct from new.requested_by_user_id
      on conflict do nothing;
    end if;
  elsif old.revision_status = 'requested' and new.revision_status in ('approved', 'rejected') then
    insert into public.user_notifications (recipient_id, event_type, project_id, baseline_id, actor_name, created_at)
    select p.id, 'baseline_' || new.revision_status, new.project_id, new.id,
           (select d.full_name from public.profiles d where d.id = new.decided_by_user_id),
           coalesce(new.decided_at, now())
      from public.profiles p
     where p.id = new.requested_by_user_id
    on conflict do nothing;
  end if;
  return null;
end;
$fn$;

create trigger notify_planning_baseline_event
  after insert or update on public.planning_baselines
  for each row execute function public.notify_planning_baseline_event();

/* ------------------------------- reconcile -------------------------------- */

create or replace function public.reconcile_my_setup_amendment_notifications()
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or public.has_global_operational_authority() is distinct from true then
    return;
  end if;
  insert into public.user_notifications (recipient_id, event_type, project_id, source_id, actor_name, created_at)
  select auth.uid(), 'amendment_submitted', a.project_id, a.id, a.requested_by_name, a.requested_at
    from public.project_setup_amendments a
   where a.status = 'pending' and a.amendment_class = 'governed' and a.requested_by <> auth.uid()
     and not public.project_is_archived(a.project_id)
  on conflict do nothing;
  -- 13.12: pending Baseline Revision requests the caller may decide (never their own).
  insert into public.user_notifications (recipient_id, event_type, project_id, baseline_id, actor_name, created_at)
  select auth.uid(), 'baseline_requested', b.project_id, b.id,
         (select r.full_name from public.profiles r where r.id = b.requested_by_user_id), b.requested_at
    from public.planning_baselines b
   where b.revision_status = 'requested' and b.requested_by_user_id is distinct from auth.uid()
     and not public.project_is_archived(b.project_id)
  on conflict do nothing;
end;
$fn$;

comment on function public.reconcile_my_setup_amendment_notifications() is
  '13.9B / 13.12. Idempotent, caller-only: creates any missing amendment_submitted or baseline_requested notification for the pending governed amendment requests and Baseline Revision requests the caller (an active System Administrator / Project Control Admin) may decide — never their own.';

/* ------------------------- one-time backfill (pending) -------------------- */

insert into public.user_notifications (recipient_id, event_type, project_id, baseline_id, actor_name, created_at)
select p.id, 'baseline_requested', b.project_id, b.id,
       (select r.full_name from public.profiles r where r.id = b.requested_by_user_id), b.requested_at
  from public.planning_baselines b
  join public.profiles p on p.active and p.role in ('system_admin', 'project_control_admin')
                        and p.id is distinct from b.requested_by_user_id
 where b.revision_status = 'requested' and not public.project_is_archived(b.project_id)
on conflict do nothing;

/* --------------------------------- grants --------------------------------- */

revoke execute on function public.notify_planning_baseline_event() from public, anon, authenticated, service_role;

/* ------------------------------- post-checks ------------------------------ */

do $post$
begin
  if has_table_privilege('authenticated', 'public.user_notifications', 'INSERT,DELETE')
     or has_column_privilege('authenticated', 'public.user_notifications', 'baseline_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_notifications', 'event_type', 'UPDATE') then
    raise exception 'baseline notifications post-check failed: client privileges are too wide.';
  end if;
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'notify_planning_baseline_event') <> 1
     or (select count(*) from pg_catalog.pg_trigger where tgname = 'notify_setup_amendment_event') <> 1 then
    raise exception 'baseline notifications post-check failed: triggers missing.';
  end if;
  if not exists (select 1 from pg_catalog.pg_policies
                  where schemaname = 'public' and tablename = 'user_notifications'
                    and policyname = 'user_notifications_select' and qual like '%cleared_at IS NULL%') then
    raise exception 'baseline notifications post-check failed: select policy does not hide cleared rows.';
  end if;
end;
$post$;

notify pgrst, 'reload schema';
