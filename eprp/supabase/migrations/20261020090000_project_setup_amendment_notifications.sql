-- Phase 13.9B — Project Setup Governance — actionable notifications for
-- Project Setup amendments (found by browser UAT: the approval workflow works
-- but nobody was told a decision was waiting).
--
-- SCOPE: Project Setup amendments ONLY. Not a notification redesign.
--
-- WHAT EXISTED: the bell / inbox UI and its NotificationService contract
-- (src/features/notifications) were a front-end shell with NO backend
-- ("Notification delivery is not connected yet"). The UI and contract are
-- reused unchanged; this migration adds the first real source of rows.
--
-- WHAT THIS ADDS
--   * user_notifications — one row per recipient and event. Read state is the
--     recipient's. Clients can read their own rows and set read_at; nothing else.
--   * A trigger on project_setup_amendments (the event source — no function
--     that writes amendments was changed):
--       - a GOVERNED request is submitted (pending)
--           -> every active System Administrator / Project Control Admin except
--              the requester gets 'amendment_submitted';
--       - pending -> approved | rejected | stale
--           -> the requester gets 'amendment_approved' | 'amendment_rejected' |
--              'amendment_stale';
--       - withdrawn -> nothing (the requester is not told about their own
--         withdrawal, and approvers' rows simply stop being actionable);
--       - lightweight (applied at once) and free / logged edits -> nothing.
--   * Actionability is decided when the inbox is READ, never by changing an
--     amendment: an 'amendment_submitted' row is visible only while the request
--     is still pending, its project is not archived and the reader is still an
--     active approver. So a decided, withdrawn or frozen (archived) request
--     leaves every approver's inbox and unread count by itself, and returns if
--     the project is restored.
--   * A trigger on projects: when a project is archived, the requester of each
--     pending governed request gets 'amendment_frozen'. The amendments stay
--     pending, untouched (B24).
--   * reconcile_my_setup_amendment_notifications() — idempotent safety net for
--     the CALLER: creates any missing 'amendment_submitted' row for pending
--     requests, so an approver who was created or promoted after the request
--     still finds it.
--   * A one-time backfill of the same rows for the requests pending today.
--     It writes notifications only; no amendment is read for update.
--
-- UNCHANGED: amendment, decision and withdrawal functions, the history guard,
-- the archived guards, authority and every Step 1-4 rule.

create table public.user_notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type   text not null,
  project_id   uuid not null references public.projects(id) on delete cascade,
  source_id    uuid not null references public.project_setup_amendments(id) on delete cascade,
  actor_name   text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  constraint user_notifications_event_valid check (event_type in (
    'amendment_submitted', 'amendment_approved', 'amendment_rejected', 'amendment_stale', 'amendment_frozen'))
);

create unique index user_notifications_one_per_event on public.user_notifications (recipient_id, event_type, source_id);
create index user_notifications_recipient_time on public.user_notifications (recipient_id, created_at desc);

comment on table public.user_notifications is
  '13.9B. Per-recipient notification rows. First producer: Project Setup amendments (event_type amendment_*; source_id = the amendment). Written only by triggers and reconcile_my_setup_amendment_notifications(); a recipient reads their own rows and sets read_at. Visibility of amendment_submitted rows is derived from the amendment (pending, project not archived, reader still an approver).';

/* ------------------------------- visibility ------------------------------- */

create function public.setup_notification_visible(p_event text, p_source uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select case
    when p_event <> 'amendment_submitted' then true
    else public.has_global_operational_authority()
         and exists (select 1 from public.project_setup_amendments a
                      where a.id = p_source and a.status = 'pending'
                        and not public.project_is_archived(a.project_id))
  end;
$fn$;

alter table public.user_notifications enable row level security;

create policy user_notifications_select on public.user_notifications
  for select to authenticated
  using (recipient_id = (select auth.uid())
         and public.current_user_role() is not null
         and public.setup_notification_visible(event_type, source_id));
create policy user_notifications_mark_read on public.user_notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()) and public.current_user_role() is not null)
  with check (recipient_id = (select auth.uid()));

revoke all on public.user_notifications from public, anon, authenticated, service_role;
grant select on public.user_notifications to authenticated, service_role;
grant update (read_at) on public.user_notifications to authenticated;

/* --------------------------------- events --------------------------------- */

create function public.notify_setup_amendment_event()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' and new.amendment_class = 'governed' then
      insert into public.user_notifications (recipient_id, event_type, project_id, source_id, actor_name, created_at)
      select p.id, 'amendment_submitted', new.project_id, new.id, new.requested_by_name, new.requested_at
        from public.profiles p
       where p.active and p.role in ('system_admin', 'project_control_admin') and p.id <> new.requested_by
      on conflict do nothing;
    end if;
  elsif old.status = 'pending' and new.status in ('approved', 'rejected', 'stale') then
    insert into public.user_notifications (recipient_id, event_type, project_id, source_id, actor_name, created_at)
    select p.id, 'amendment_' || new.status, new.project_id, new.id, new.decided_by_name,
           coalesce(new.decided_at, now())
      from public.profiles p
     where p.id = new.requested_by
    on conflict do nothing;
  end if;
  return null;
end;
$fn$;

create trigger notify_setup_amendment_event
  after insert or update on public.project_setup_amendments
  for each row execute function public.notify_setup_amendment_event();

create function public.notify_setup_amendments_frozen()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.user_notifications (recipient_id, event_type, project_id, source_id, actor_name)
  select p.id, 'amendment_frozen', a.project_id, a.id, null
    from public.project_setup_amendments a
    join public.profiles p on p.id = a.requested_by
   where a.project_id = new.id and a.status = 'pending' and a.amendment_class = 'governed'
  on conflict do nothing;
  return null;
end;
$fn$;

create trigger notify_setup_amendments_frozen
  after update of status on public.projects
  for each row when (new.status = 'archived' and old.status is distinct from 'archived')
  execute function public.notify_setup_amendments_frozen();

/* ------------------------------- reconcile -------------------------------- */

create function public.reconcile_my_setup_amendment_notifications()
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
end;
$fn$;

comment on function public.reconcile_my_setup_amendment_notifications() is
  '13.9B. Idempotent, caller-only: creates any missing amendment_submitted notification for the pending governed requests the caller (an active System Administrator / Project Control Admin) may decide.';

/* ------------------------- one-time backfill (pending) -------------------- */

insert into public.user_notifications (recipient_id, event_type, project_id, source_id, actor_name, created_at)
select p.id, 'amendment_submitted', a.project_id, a.id, a.requested_by_name, a.requested_at
  from public.project_setup_amendments a
  join public.profiles p on p.active and p.role in ('system_admin', 'project_control_admin') and p.id <> a.requested_by
 where a.status = 'pending' and a.amendment_class = 'governed'
   and not public.project_is_archived(a.project_id)
on conflict do nothing;

/* --------------------------------- grants --------------------------------- */

do $grants$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.notify_setup_amendment_event()',
    'public.notify_setup_amendments_frozen()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
  foreach v_fn in array array[
    'public.setup_notification_visible(text,uuid)',
    'public.reconcile_my_setup_amendment_notifications()'] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;
end;
$grants$;

/* ------------------------------- post-checks ------------------------------ */

do $post$
begin
  if (select count(*) from pg_catalog.pg_trigger where tgname = 'notify_setup_amendment_event') <> 1
     or (select count(*) from pg_catalog.pg_trigger where tgname = 'notify_setup_amendments_frozen') <> 1 then
    raise exception 'amendment notifications post-check failed: triggers missing.';
  end if;
  if has_table_privilege('authenticated', 'public.user_notifications', 'INSERT,DELETE')
     or has_column_privilege('authenticated', 'public.user_notifications', 'event_type', 'UPDATE')
     or has_table_privilege('anon', 'public.user_notifications', 'SELECT') then
    raise exception 'amendment notifications post-check failed: client privileges are too wide.';
  end if;
  if has_function_privilege('authenticated', 'public.notify_setup_amendment_event()', 'EXECUTE') then
    raise exception 'amendment notifications post-check failed: trigger function is callable.';
  end if;
end;
$post$;

notify pgrst, 'reload schema';
