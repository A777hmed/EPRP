-- EPRP — let one person hold several scoped assignments in the same project.
--
-- EXISTING MODEL (audited, unchanged in shape)
--   public.project_contacts already stores one row per scoped assignment:
--     project_id, contact_id, role, department_id, system_id, discipline_id,
--     assignment_role, functional_title, reports_to_contact_id
--   `role` is the ROW KIND ('team_member', or one of the responsibility roles
--   such as project_manager). `assignment_role` is the business Assignment
--   Role on that one scope item. Responsibility rows carry NULL scope.
--
--   So the storage was already right. What was wrong was the uniqueness key.
--
-- WHAT WAS WRONG
--   project_contacts_unique_scope was
--     unique nulls not distinct (project_id, contact_id, role, discipline_id)
--
--   That key omits department_id, system_id and assignment_role. Consequences:
--     * the same person could not hold two different Assignment Roles that
--       differ only by Assignment Role on the same scope item;
--     * a scope item reachable through two departments collapsed into one row;
--     * yet it did NOT actually describe "an exact duplicate assignment",
--       which is the only thing that should ever be refused.
--
-- WHAT THIS DOES
--   Replaces the key with the full identity of a scoped assignment. After
--   this, the only refused insert is a byte-for-byte duplicate of an existing
--   assignment. Everything the business calls legitimate is allowed:
--     * same person + same project + same department + same Assignment Role
--       + DIFFERENT scope item                                    -> allowed
--     * same person + same project + same department
--       + DIFFERENT Assignment Role + DIFFERENT scope item        -> allowed
--     * same person as Department Manager across many scope items -> allowed,
--       and counted as ONE Department Manager, because that rule is about the
--       PERSON, not the row (enforced in assignment-rules.ts).
--
--   `nulls not distinct` is kept deliberately: an unscoped responsibility row
--   has NULL department/system/discipline, and two of those for the same
--   (project, contact, role) really are the same assignment.
--
-- SAFETY
--   * Widening a unique key can never reject rows that already satisfy the
--     narrower one, so no existing assignment can be invalidated.
--   * No data is read, written, moved or deleted. Constraint definition only.
--   * No contact master record is touched or duplicated.
--   * Reversible: drop this constraint and recreate the previous one.

do $$
declare
  dupes integer;
begin
  -- Prove the new key holds on current data before swapping it in. If this
  -- ever fires, the transaction aborts and the old constraint stays.
  select count(*) into dupes from (
    select project_id, contact_id, role, department_id, system_id,
           discipline_id, assignment_role
      from public.project_contacts
     group by 1,2,3,4,5,6,7
    having count(*) > 1
  ) x;

  if dupes > 0 then
    raise exception
      'Refusing to widen the key: % exact-duplicate scoped assignment(s) already exist. Resolve them first.',
      dupes;
  end if;

  raise notice 'Pre-check passed: no exact-duplicate scoped assignments.';
end;
$$;

alter table public.project_contacts
  drop constraint if exists project_contacts_unique_scope;

alter table public.project_contacts
  add constraint project_contacts_unique_scope
  unique nulls not distinct
    (project_id, contact_id, role, department_id, system_id,
     discipline_id, assignment_role);

comment on constraint project_contacts_unique_scope on public.project_contacts is
  'One row per scoped assignment. A person may hold any number of assignments in the same project and department, on different scope items, with the same or different Assignment Roles. Only an exact duplicate — identical project, contact, row kind, department, system, scope item AND Assignment Role — is refused.';

-- Resolving "which scope items does this user cover, in what role" is the
-- lookup Weekly will need per user and department. Index it now so that
-- resolution is cheap when Weekly is built; it costs nothing today.
create index if not exists idx_project_contacts_scope_resolution
  on public.project_contacts (project_id, contact_id, department_id)
  where discipline_id is not null;
