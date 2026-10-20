-- Phase 13.9B (UAT) — "Clear history" for the notification inbox.
--
-- SCOPE: the caller's own notification inbox. Platform-wide (any event type in
-- user_notifications), not Project Setup specific.
--
-- STORAGE DECISION: user_notifications rows are per-recipient DELIVERY RECORDS
-- (who was told what, when). They are written only by triggers and the
-- reconcile function, and the runtime suites (127, 128) use them as evidence.
-- So clearing HIDES rows for their recipient (cleared_at) instead of deleting
-- them. Nothing else is touched: amendments, decisions, Project History,
-- relation history, report history, audit and other users' rows are unchanged.
--
-- WHAT THIS ADDS
--   * user_notifications.cleared_at — set only by clear_my_notification_history();
--     clients still have no write access except read_at.
--   * The select policy hides cleared rows, so the bell, unread counts, lists,
--     filters and "Mark all read" all work on the remaining inbox unchanged.
--   * notification_requires_action(event, source) — the one definition of
--     "the recipient still has to act on this": today an amendment_submitted
--     whose request is still PENDING (also while its project is archived or the
--     reader's authority lapsed, so it comes back when either is restored). New
--     action-required event types must be added here.
--   * clear_my_notification_history() — caller-only: hides every row of the
--     caller that does not require action; returns how many were cleared.
--
-- UNCHANGED: who is notified and when (triggers), visibility of actionable
-- requests, read state, reconcile, every amendment / governance rule.

alter table public.user_notifications add column cleared_at timestamptz;

comment on column public.user_notifications.cleared_at is
  '13.9B UAT. Set when the recipient clears their notification history; the row is then hidden from them (select policy) but kept as the delivery record. Never set for a row that still requires action (notification_requires_action).';

/* ------------------------------ action required --------------------------- */

create function public.notification_requires_action(p_event text, p_source uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select case
    when p_event = 'amendment_submitted' then exists (
      select 1 from public.project_setup_amendments a where a.id = p_source and a.status = 'pending')
    else false
  end;
$fn$;

comment on function public.notification_requires_action(text, uuid) is
  '13.9B UAT. True while the recipient still has to act on the notification (today: an amendment_submitted whose request is pending). Such rows are never cleared. Extend for new action-required event types.';

/* --------------------------------- visibility ------------------------------ */

drop policy user_notifications_select on public.user_notifications;
create policy user_notifications_select on public.user_notifications
  for select to authenticated
  using (recipient_id = (select auth.uid())
         and cleared_at is null
         and public.current_user_role() is not null
         and public.setup_notification_visible(event_type, source_id));

/* ----------------------------------- clear --------------------------------- */

create function public.clear_my_notification_history()
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
     and not public.notification_requires_action(n.event_type, n.source_id);
  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$fn$;

comment on function public.clear_my_notification_history() is
  '13.9B UAT. Caller-only: hides the caller''s resolved and informational notifications (sets cleared_at). Rows that still require action stay. Touches no other table and no other user''s rows.';

/* ---------------------------------- grants --------------------------------- */

revoke execute on function public.notification_requires_action(text, uuid) from public, anon;
grant execute on function public.notification_requires_action(text, uuid) to authenticated, service_role;
revoke execute on function public.clear_my_notification_history() from public, anon;
grant execute on function public.clear_my_notification_history() to authenticated, service_role;

/* -------------------------------- post-checks ------------------------------ */

do $post$
begin
  if has_column_privilege('authenticated', 'public.user_notifications', 'cleared_at', 'UPDATE')
     or has_table_privilege('authenticated', 'public.user_notifications', 'INSERT,DELETE')
     or has_function_privilege('anon', 'public.clear_my_notification_history()', 'EXECUTE') then
    raise exception 'notification history clear post-check failed: client privileges are too wide.';
  end if;
  if not exists (select 1 from pg_catalog.pg_policies
                  where schemaname = 'public' and tablename = 'user_notifications'
                    and policyname = 'user_notifications_select' and qual like '%cleared_at IS NULL%') then
    raise exception 'notification history clear post-check failed: select policy does not hide cleared rows.';
  end if;
end;
$post$;

notify pgrst, 'reload schema';
