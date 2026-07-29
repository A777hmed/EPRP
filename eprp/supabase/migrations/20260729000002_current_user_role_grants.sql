-- EPRP Phase A1.1 — restrict execution of current_user_role().
--
-- 20260729000001_profiles.sql intended to keep this function away from
-- anonymous callers but used:
--
--   revoke execute on function public.current_user_role() from anon;
--
-- That has no effect. Postgres grants EXECUTE on a new function to PUBLIC by
-- default, and revoking from `anon` does not remove the PUBLIC grant — so
-- `anon` retained execute rights through PUBLIC and the call returned 200.
--
-- Impact of the original defect was nil: the function resolves the CALLER's
-- own role via auth.uid(), which is null for an anonymous request, so it
-- returned null and disclosed nothing about anyone. This migration closes the
-- gap so the granted privileges match the stated intent.
--
-- Additive and privilege-only: no table, column, index, policy, or row is
-- touched, and no RLS policy is relaxed.

revoke execute on function public.current_user_role() from public;

-- Re-assert the intended grant. Repeating it is harmless and keeps this
-- migration correct on its own, without depending on the earlier one.
grant execute on function public.current_user_role() to authenticated;

comment on function public.current_user_role() is
  'Role of the calling user, or null when unauthenticated. For use in RLS policies without recursing through profiles. EXECUTE is granted to authenticated only (A1.1).';
