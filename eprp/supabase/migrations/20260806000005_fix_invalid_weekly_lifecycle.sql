-- EPRP — correct Weekly Reports sitting in a lifecycle state their own
-- evidence does not support.
--
-- At least one report was observed as:
--     status = locked · reviewed_by = null · approved_by = null · 1/2 accepted
--
-- That state was reachable because the old guard only checked transition
-- SHAPE, never whether the stage's conditions were met. The service-layer
-- guards added in this sprint stop it recurring; this migration corrects what
-- already exists.
--
-- POLICY — downgrade only, never fabricate.
--   * No reviewer, approver or submission is invented.
--   * Each report is downgraded to the highest status its own evidence
--     supports, mirroring highestSupportedStatus() exactly:
--
--       locked / finalized  require all submissions accepted + reviewer + approver
--       approved            requires all submissions accepted + reviewer
--       under_review        requires all submissions accepted
--       collecting          otherwise
--
--   * A report already consistent with its evidence is left untouched.
--   * Every correction is written to an audit table with the previous state,
--     the corrected state, the reason and the timestamp.
--   * Idempotent: re-running corrects nothing further.

/* ------------------------------ Audit table ------------------------------- */

create table if not exists public.weekly_lifecycle_corrections (
  id                uuid primary key default gen_random_uuid(),
  weekly_report_id  uuid not null references public.weekly_reports(id) on delete cascade,
  previous_status   text not null,
  corrected_status  text not null,
  reason            text not null,
  evidence          jsonb not null,
  corrected_at      timestamptz not null default now()
);

alter table public.weekly_lifecycle_corrections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'weekly_lifecycle_corrections'
       and policyname = 'weekly_lifecycle_corrections_authenticated_all'
  ) then
    create policy weekly_lifecycle_corrections_authenticated_all
      on public.weekly_lifecycle_corrections
      for all to authenticated using (true) with check (true);
  end if;
end;
$$;

comment on table public.weekly_lifecycle_corrections is
  'Audit of Weekly Reports downgraded to the lifecycle state their evidence supports. Append-only history; no reviewer or approver data was ever fabricated.';

/* ------------------------------ Correction -------------------------------- */

do $$
declare
  r          record;
  total      integer;
  accepted   integer;
  supported  text;
  corrected  integer := 0;
  checked    integer := 0;
begin
  for r in
    select id, report_number, status, reviewed_by_contact_id, approved_by_contact_id
      from public.weekly_reports
     where status in ('under_review', 'approved', 'finalized', 'locked')
  loop
    checked := checked + 1;

    select count(*),
           count(*) filter (where s.status = 'accepted')
      into total, accepted
      from public.weekly_submissions s
     where s.weekly_report_id = r.id;

    -- Mirrors highestSupportedStatus() in lifecycle-guards.ts.
    if total > 0 and accepted = total
       and r.reviewed_by_contact_id is not null
       and r.approved_by_contact_id is not null then
      supported := 'locked';
    elsif total > 0 and accepted = total
       and r.reviewed_by_contact_id is not null then
      supported := 'approved';
    elsif total > 0 and accepted = total then
      supported := 'under_review';
    else
      supported := 'collecting';
    end if;

    -- Only ever move DOWN, and only when the current state is unsupported.
    if supported = r.status then
      continue;
    end if;
    if array_position(array['collecting','under_review','approved','finalized','locked'], supported)
       >= array_position(array['collecting','under_review','approved','finalized','locked'], r.status) then
      continue;  -- never promote
    end if;

    insert into public.weekly_lifecycle_corrections
      (weekly_report_id, previous_status, corrected_status, reason, evidence)
    values (
      r.id,
      r.status,
      supported,
      'Status was not supported by the report''s own evidence. Downgraded to the '
        || 'highest legitimately supported state. No reviewer, approver or '
        || 'submission data was created.',
      jsonb_build_object(
        'report_number',        r.report_number,
        'submissions_total',    total,
        'submissions_accepted', accepted,
        'had_reviewer',         r.reviewed_by_contact_id is not null,
        'had_approver',         r.approved_by_contact_id is not null
      )
    );

    update public.weekly_reports set status = supported where id = r.id;
    corrected := corrected + 1;

    raise notice 'Weekly % : % -> %  (accepted %/%, reviewer %, approver %)',
      coalesce(r.report_number, r.id::text), r.status, supported, accepted, total,
      (r.reviewed_by_contact_id is not null), (r.approved_by_contact_id is not null);
  end loop;

  raise notice 'Weekly lifecycle audit: % report(s) checked, % corrected.', checked, corrected;
end;
$$;
