-- Weekly lifecycle sign-off guard alignment.
--
-- Weekly sign-off is persisted in weekly_reports.signatories as an immutable
-- report snapshot. The workspace reads and writes that snapshot, but the
-- lifecycle guard added before the snapshot migration still checked only the
-- legacy reviewed_by_contact_id / approved_by_contact_id columns. A reviewer
-- could therefore be visibly and correctly saved while approval was refused.
--
-- Keep the reviewer and approver requirements intact. The snapshot is the
-- canonical source; legacy ids remain a compatibility fallback for reports
-- saved before the snapshot column existed.

create or replace function public.weekly_transition_blockers(
  p_report uuid, p_to text
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_total        integer;
  v_approved     integer;
  v_has_reviewer boolean;
  v_has_approver boolean;
  v_out          text[] := '{}';
begin
  select
    coalesce(jsonb_array_length(signatories->'reviewed'), 0) > 0
      or reviewed_by_contact_id is not null,
    coalesce(jsonb_array_length(signatories->'approved'), 0) > 0
      or approved_by_contact_id is not null
    into v_has_reviewer, v_has_approver
    from public.weekly_reports
   where id = p_report;

  select count(*), count(*) filter (where status = 'approved')
    into v_total, v_approved
    from public.weekly_submissions where weekly_report_id = p_report;

  if p_to in ('under_review', 'approved', 'finalized', 'locked') then
    if v_total = 0 then
      v_out := array_append(v_out, 'No department submissions exist for this report.');
    elsif v_approved < v_total then
      v_out := array_append(v_out, format(
        '%s of %s department submissions approved - all are required.',
        v_approved, v_total));
    end if;
  end if;

  if p_to in ('approved', 'finalized', 'locked') and not v_has_reviewer then
    v_out := array_append(v_out, 'No reviewer recorded.');
  end if;

  if p_to in ('finalized', 'locked') and not v_has_approver then
    v_out := array_append(v_out, 'No approver recorded.');
  end if;

  return v_out;
end;
$fn$;

comment on function public.weekly_transition_blockers(uuid, text) is
  'Weekly lifecycle blockers. Reviewer and approver are read from the immutable signatories snapshot, with legacy contact ids accepted only for pre-snapshot reports.';
