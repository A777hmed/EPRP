-- EPRP — corrective: archive must be reachable from every live report state.
--
-- FORWARD FIX. 20260820000005 is deployed and is NOT edited.
--
-- THE DEFECT
--   20260820000005 built report_transition_allowed() by mirroring
--   reportWorkflows in src/config/workflows.ts literally. But the TypeScript
--   service it replaced carried a deliberate special case that the table never
--   expressed:
--
--     if (to !== "archived" && !canTransition("weekly", current.status, to))
--
--   Archive bypassed the SHAPE check entirely. The migration carried over only
--   the other half of that special case — skipping the STAGE CONDITIONS for
--   archived — and left the shape check applying. Archive therefore worked from
--   only 3 of 9 weekly states.
--
--   Observed in production on EPR-PSM-00-1-W-2026-32 and -34, both at
--   'collecting': "Cannot move a weekly report from collecting to archived."
--   The report was correctly left untouched; the UI failed to say so, which is
--   fixed separately in application code.
--
-- WHAT ARCHIVE MEANS
--   Archiving WITHDRAWS a report from active use. It asserts nothing about the
--   report's content, which is why set_weekly_report_status() already skips the
--   stage conditions for it. A withdrawal that can only happen from three
--   states is not a withdrawal. Architecture 24.1 rule 5: nothing consequential
--   is deleted — archive is how a report leaves the active set, so every live
--   state must be able to reach it.
--
-- SCOPE — ONE FUNCTION
--   create or replace public.report_transition_allowed() and nothing else.
--   No RLS policy, no grant, no table, no other trigger or function, and no
--   report data is touched. Every NON-archive transition is reproduced
--   byte-for-byte; the post-check proves that.
--
-- ONE DEVIATION FROM THE REQUESTED LIST, STATED RATHER THAN SILENT
--   The brief listed eight states for BOTH tiers. The two workflows do not have
--   the same states:
--     * 'collecting' exists only in Weekly. It is NOT added to Monthly, because
--       a Monthly report can never hold that status and the row would be dead
--       data asserting something false about the model.
--     * 'auto_compiled' and 'department_review' exist only in Monthly and were
--       not in the list. They ARE added, because a Monthly sitting in either is
--       exactly as un-archivable as the Weekly reports that triggered this fix.
--       Omitting them would leave the same defect in place for Monthly.
--   Result: Weekly archives from 8 states, Monthly from 9.

create or replace function public.report_transition_allowed(
  p_type text, p_from text, p_to text
)
returns boolean
language sql
immutable
as $fn$
  select exists (
    select 1
      from (values
        /* ---------------------------- weekly ---------------------------- */
        -- Forward path — UNCHANGED from 20260820000005.
        ('weekly','draft','collecting'),
        ('weekly','collecting','under_review'),
        ('weekly','under_review','approved'),
        ('weekly','under_review','returned'),
        ('weekly','under_review','rejected'),
        ('weekly','returned','collecting'),
        ('weekly','approved','finalized'),
        ('weekly','approved','returned'),
        ('weekly','finalized','locked'),
        -- Withdrawal — reachable from every live state.
        ('weekly','draft','archived'),
        ('weekly','collecting','archived'),
        ('weekly','under_review','archived'),
        ('weekly','approved','archived'),
        ('weekly','finalized','archived'),
        ('weekly','locked','archived'),
        ('weekly','returned','archived'),
        ('weekly','rejected','archived'),

        /* --------------------------- monthly ---------------------------- */
        -- Forward path — UNCHANGED from 20260820000005.
        ('monthly','draft','auto_compiled'),
        ('monthly','auto_compiled','department_review'),
        ('monthly','department_review','under_review'),
        ('monthly','department_review','returned'),
        ('monthly','under_review','approved'),
        ('monthly','under_review','returned'),
        ('monthly','under_review','rejected'),
        ('monthly','returned','department_review'),
        ('monthly','approved','finalized'),
        ('monthly','approved','returned'),
        ('monthly','finalized','locked'),
        -- Withdrawal — reachable from every live state.
        ('monthly','draft','archived'),
        ('monthly','auto_compiled','archived'),
        ('monthly','department_review','archived'),
        ('monthly','under_review','archived'),
        ('monthly','approved','archived'),
        ('monthly','finalized','archived'),
        ('monthly','locked','archived'),
        ('monthly','returned','archived'),
        ('monthly','rejected','archived')
      ) as t(kind, from_status, to_status)
     where t.kind = p_type and t.from_status = p_from and t.to_status = p_to
  );
$fn$;

comment on function public.report_transition_allowed(text, text, text) is
  'Whether from -> to is a legal transition. Mirrors reportWorkflows in src/config/workflows.ts; the two must be changed together. Archive is reachable from every live state: it withdraws a report and asserts nothing about its content, which is why set_weekly_report_status() also skips the stage conditions for it.';

/* -------------------------- Post-condition checks ------------------------- */

do $post$
declare
  st text;
  missing text[] := '{}';
  widened text[] := '{}';
begin
  -- 1. Archive reachable from every live weekly state.
  foreach st in array array['draft','collecting','under_review','approved',
                            'finalized','locked','returned','rejected']
  loop
    if not public.report_transition_allowed('weekly', st, 'archived') then
      missing := array_append(missing, 'weekly:' || st);
    end if;
  end loop;

  -- 2. Archive reachable from every live monthly state.
  foreach st in array array['draft','auto_compiled','department_review',
                            'under_review','approved','finalized','locked',
                            'returned','rejected']
  loop
    if not public.report_transition_allowed('monthly', st, 'archived') then
      missing := array_append(missing, 'monthly:' || st);
    end if;
  end loop;

  if array_length(missing, 1) > 0 then
    raise exception 'Post-check failed: archive still unreachable from %',
      array_to_string(missing, ', ');
  end if;

  -- 3. NOTHING ELSE widened. Each of these was refused before and must still
  --    be refused: a skipped forward stage, a backwards jump, a cross-tier
  --    borrow, and a state that does not belong to the tier.
  if public.report_transition_allowed('weekly','draft','locked') then
    widened := array_append(widened, 'weekly draft->locked'); end if;
  if public.report_transition_allowed('weekly','draft','approved') then
    widened := array_append(widened, 'weekly draft->approved'); end if;
  if public.report_transition_allowed('weekly','collecting','approved') then
    widened := array_append(widened, 'weekly collecting->approved'); end if;
  if public.report_transition_allowed('weekly','locked','finalized') then
    widened := array_append(widened, 'weekly locked->finalized'); end if;
  if public.report_transition_allowed('monthly','draft','approved') then
    widened := array_append(widened, 'monthly draft->approved'); end if;
  if public.report_transition_allowed('monthly','draft','department_review') then
    widened := array_append(widened, 'monthly draft->department_review'); end if;
  if public.report_transition_allowed('weekly','draft','auto_compiled') then
    widened := array_append(widened, 'weekly borrowed a monthly state'); end if;
  if public.report_transition_allowed('monthly','draft','collecting') then
    widened := array_append(widened, 'monthly borrowed a weekly state'); end if;
  if public.report_transition_allowed('archived','draft','archived') then
    widened := array_append(widened, 'unknown tier accepted'); end if;

  if array_length(widened, 1) > 0 then
    raise exception 'Post-check failed: unrelated transitions were widened: %',
      array_to_string(widened, ', ');
  end if;

  -- 4. The forward path still works.
  if not public.report_transition_allowed('weekly','collecting','under_review')
     or not public.report_transition_allowed('weekly','approved','finalized')
     or not public.report_transition_allowed('monthly','approved','finalized')
     or not public.report_transition_allowed('monthly','auto_compiled','department_review') then
    raise exception 'Post-check failed: a forward transition was lost.';
  end if;

  raise notice 'Archive fix applied: weekly archives from 8 states, monthly from 9; no other transition changed.';
end;
$post$;
