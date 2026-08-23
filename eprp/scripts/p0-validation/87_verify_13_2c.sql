-- EPRP — MASTER MILESTONE COMPLETION (13.2c) VERIFIER.  100% READ-ONLY.
--
-- Asserts the shape migration 20260822000003 is supposed to have produced, and
-- the one rule that matters most: an Advance / Down Payment cannot inflate
-- physical progress.
--
-- Every statement is a SELECT. Safe to run against production, and repeatable.
--
-- HOW TO RUN
--   Dashboard -> SQL Editor -> New query -> paste -> Run -> export CSV.
--
-- WHAT THIS DOES NOT PROVE
--   Section E reads the CHECK constraint's definition; it does not attempt a
--   write that the constraint would refuse. Proving refusal needs an actual
--   INSERT, which is not read-only and is therefore done through the UI.

with
identity_cols(c) as (values
  ('milestone_type'),('category'),('planned_date'),('weight_percent'),
  ('planned_progress_percent'),('predecessor_milestone_id'),
  ('client_approval_required'),('notes'),
  ('payment_percent'),('payment_amount'),('payment_due_date'),
  ('is_advance_payment')),
update_cols(c) as (values
  ('payment_status'),('invoice_reference'),('invoiced_date'),('received_date'),
  ('recovered_amount'),('client_approval_status'),('client_approval_date'))

select * from (

  /* A — the migration applied exactly once -------------------------------- */
  select 1 as seq, 'A. MIGRATION' as check_name, '20260822000003' as item,
         coalesce((select count(*)::text from supabase_migrations.schema_migrations
                    where version='20260822000003'),'0') as value,
         case when (select count(*) from supabase_migrations.schema_migrations
                     where version='20260822000003') = 1
              then 'PASS - applied once' else 'FAIL' end as verdict

  /* B — identity columns present on master_milestones ---------------------- */
  union all
  select 2, 'B. IDENTITY COLUMNS', i.c,
         coalesce((select data_type from information_schema.columns
                    where table_schema='public' and table_name='master_milestones'
                      and column_name=i.c), '(missing)'),
         case when exists (select 1 from information_schema.columns
                            where table_schema='public'
                              and table_name='master_milestones'
                              and column_name=i.c)
              then 'PASS' else 'FAIL - column missing' end
    from identity_cols i

  /* C — reported columns present on milestone_updates ---------------------- */
  union all
  select 3, 'C. REPORTED COLUMNS', u.c,
         coalesce((select data_type from information_schema.columns
                    where table_schema='public' and table_name='milestone_updates'
                      and column_name=u.c), '(missing)'),
         case when exists (select 1 from information_schema.columns
                            where table_schema='public'
                              and table_name='milestone_updates'
                              and column_name=u.c)
              then 'PASS' else 'FAIL - column missing' end
    from update_cols u

  /* D — the split held: no status/progress on the identity row ------------- */
  union all
  select 4, 'D. SPLIT HELD', 'no reported figure on master_milestones',
         coalesce((select string_agg(column_name, ', ')
                     from information_schema.columns
                    where table_schema='public' and table_name='master_milestones'
                      and column_name in ('status','progress_percent',
                                          'forecast_date','actual_date',
                                          'payment_status','recovered_amount')),
                  '(none)'),
         case when not exists (select 1 from information_schema.columns
                                where table_schema='public'
                                  and table_name='master_milestones'
                                  and column_name in ('status','progress_percent',
                                                      'forecast_date','actual_date',
                                                      'payment_status','recovered_amount'))
              then 'PASS - state lives only in milestone_updates'
              else 'FAIL - a second writable store of a reported fact' end

  /* E — THE ACCOUNTING RULE ------------------------------------------------ */
  union all
  select 5, 'E. ADVANCE RULE',
         'commercial milestone refused a physical weight',
         coalesce((select pg_get_constraintdef(oid) from pg_constraint
                    where conname='master_milestones_commercial_no_physical_weight'),
                  '(missing)'),
         case when exists (select 1 from pg_constraint
                            where conname='master_milestones_commercial_no_physical_weight')
              then 'PASS - constraint present'
              else 'FAIL - physical progress can be inflated by a payment' end

  union all
  select 5, 'E. ADVANCE RULE', 'payment fields confined to commercial rows',
         coalesce((select pg_get_constraintdef(oid) from pg_constraint
                    where conname='master_milestones_payment_needs_commercial'),
                  '(missing)'),
         case when exists (select 1 from pg_constraint
                            where conname='master_milestones_payment_needs_commercial')
              then 'PASS' else 'FAIL' end

  -- Live data check: nothing in the register may currently break the rule.
  union all
  select 5, 'E. ADVANCE RULE', 'commercial rows carrying physical weight',
         (select count(*)::text from public.master_milestones
           where milestone_type='commercial' and coalesce(weight_percent,0) <> 0),
         case when (select count(*) from public.master_milestones
                     where milestone_type='commercial'
                       and coalesce(weight_percent,0) <> 0) = 0
              then 'PASS - none' else 'FAIL - inspect these rows' end

  /* F — dependency guard --------------------------------------------------- */
  union all
  select 6, 'F. DEPENDENCY', 'identity guard trigger',
         coalesce((select tgname::text from pg_trigger
                    where tgname='master_milestones_identity_guard'), '(missing)'),
         case when exists (select 1 from pg_trigger
                            where tgname='master_milestones_identity_guard')
              then 'PASS' else 'FAIL - loops and cross-project links possible' end

  union all
  select 6, 'F. DEPENDENCY', 'cross-project predecessors in live data',
         (select count(*)::text
            from public.master_milestones m
            join public.master_milestones p on p.id = m.predecessor_milestone_id
           where p.project_id <> m.project_id),
         case when (select count(*) from public.master_milestones m
                      join public.master_milestones p
                        on p.id = m.predecessor_milestone_id
                     where p.project_id <> m.project_id) = 0
              then 'PASS - none' else 'FAIL' end

  /* G — append-only guarantee widened over the new columns ----------------- */
  union all
  select 7, 'G. APPEND-ONLY', 'guard_milestone_update freezes payment columns',
         case when (select prosrc from pg_proc
                     where proname='guard_milestone_update')
                   like '%recovered_amount%' then 'yes' else 'no' end,
         case when (select prosrc from pg_proc
                     where proname='guard_milestone_update')
                   like '%recovered_amount%'
                and (select prosrc from pg_proc
                      where proname='guard_milestone_update')
                   like '%client_approval_status%'
              then 'PASS - reported payment facts are immutable'
              else 'FAIL - a payment fact could be rewritten in place' end

  /* H — no DELETE policy was introduced ------------------------------------ */
  union all
  select 8, 'H. NO DELETE', 'master_milestones / milestone_updates',
         (select count(*)::text from pg_policies
           where schemaname='public'
             and tablename in ('master_milestones','milestone_updates')
             and cmd='DELETE'),
         case when (select count(*) from pg_policies
                     where schemaname='public'
                       and tablename in ('master_milestones','milestone_updates')
                       and cmd='DELETE') = 0
              then 'PASS - history cannot be destroyed' else 'FAIL' end

  /* I — the deliverable link is still a reference, never a copy ------------ */
  union all
  select 9, 'I. DELIVERABLE LINK', 'no milestone fields copied onto deliverables',
         coalesce((select string_agg(column_name, ', ')
                     from information_schema.columns
                    where table_schema='public' and table_name='master_deliverables'
                      and column_name in ('milestone_code','milestone_name',
                                          'milestone_baseline_date')), '(none)'),
         case when not exists (select 1 from information_schema.columns
                                where table_schema='public'
                                  and table_name='master_deliverables'
                                  and column_name in ('milestone_code','milestone_name',
                                                      'milestone_baseline_date'))
              then 'PASS - reference only' else 'FAIL - denormalized' end

) results
order by seq, check_name, item;
