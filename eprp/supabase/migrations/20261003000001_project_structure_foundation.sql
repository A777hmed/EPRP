-- Phase 2C.1c-a — Other Project dynamic structure: schema and security.
--
-- Prepared for review; it has not been applied to any database.
--
-- An Other project defines its own hierarchy of 1 to 4 named levels (for
-- example Package -> Area -> Discipline) and its own units at those levels.
-- The project owns both. Nothing here touches the PSM hierarchy
-- (departments -> systems -> disciplines), the global master tables,
-- Weekly / Monthly submissions, Planning, or project contacts.
--
--   * project_structure_levels — the project's 1..4 contiguous levels.
--   * project_structure_nodes  — the project's units; each sits at one level,
--     under a parent exactly one level up, and is the AUTHORITATIVE place
--     where an Other project marks which units owe Weekly / Monthly
--     OPERATIONAL INPUT. Weekly and Monthly will consume this scope later;
--     they must never re-declare it.
--   * configure_project_structure_levels() — the atomic way to change levels.
--   * correct_project_structure_family() — re-created unchanged apart from one
--     guard: Other -> PSM is refused while active structure units exist.
--
-- No backfill, no demo data, no seeded levels. Legacy and PSM projects can
-- never hold structure rows. Project Structure is NOT a planning WBS: a
-- schedule hierarchy, when it arrives, is a separate, revision-controlled
-- entity that may map to these units, never be generated from them or into
-- them.

/* ------------------------------- Levels ---------------------------------- */

create table public.project_structure_levels (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  level_number       integer not null,
  singular_label     text not null,
  plural_label       text not null,
  -- Case-insensitive identity of each label, so uniqueness can be a real,
  -- deferrable constraint: relabelling two levels into each other's names in
  -- one save must not fail half-way.
  singular_label_key text generated always as (lower(singular_label)) stored,
  plural_label_key   text generated always as (lower(plural_label)) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint project_structure_levels_number_range
    check (level_number between 1 and 4),
  constraint project_structure_levels_project_number_unique
    unique (project_id, level_number),
  constraint project_structure_levels_singular_label_valid
    check (singular_label = btrim(singular_label) and length(singular_label) between 1 and 60),
  constraint project_structure_levels_plural_label_valid
    check (plural_label = btrim(plural_label) and length(plural_label) between 1 and 60),
  constraint project_structure_levels_singular_key_unique
    unique (project_id, singular_label_key) deferrable initially immediate,
  constraint project_structure_levels_plural_key_unique
    unique (project_id, plural_label_key) deferrable initially immediate
);

comment on table public.project_structure_levels is
  'Phase 2C.1c. The 1..4 contiguous, project-specific structure levels of an Other project (e.g. Package -> Area -> Discipline). Labels are display data; level_number is the structural identity and never changes. Changed through configure_project_structure_levels().';

/* -------------------------------- Nodes ---------------------------------- */

create table public.project_structure_nodes (
  id                         uuid primary key default gen_random_uuid(),
  project_id                 uuid not null references public.projects(id) on delete cascade,
  level_number               integer not null,
  parent_id                  uuid,
  name                       text not null,
  code                       text,
  description                text,
  sort_order                 integer not null default 0,
  -- OPERATIONAL INPUT REQUIRED from this unit. Not a consolidated reviewer
  -- or management roll-up role; that, if ever needed, is a separate concept.
  weekly_reporting_required  boolean not null default false,
  monthly_reporting_required boolean not null default false,
  archived_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  -- Target of the same-project parent reference below.
  constraint project_structure_nodes_id_project_unique unique (id, project_id),
  -- The level must be one this project defines. NO ACTION (checked at the end
  -- of the statement) so deleting the project cascades cleanly, while a level
  -- that still has units can never be removed.
  constraint project_structure_nodes_level_fk
    foreign key (project_id, level_number)
    references public.project_structure_levels (project_id, level_number),
  -- The parent belongs to the same project; a unit with children cannot be
  -- deleted.
  constraint project_structure_nodes_parent_fk
    foreign key (parent_id, project_id)
    references public.project_structure_nodes (id, project_id),
  constraint project_structure_nodes_root_rule
    check ((level_number = 1) = (parent_id is null)),
  constraint project_structure_nodes_name_valid
    check (name = btrim(name) and length(name) between 1 and 140),
  constraint project_structure_nodes_code_valid
    check (code is null or (code = btrim(code) and length(code) between 1 and 40)),
  constraint project_structure_nodes_description_valid
    check (description is null or length(description) <= 2000),
  constraint project_structure_nodes_archived_not_reporting
    check (archived_at is null
           or (not weekly_reporting_required and not monthly_reporting_required))
);

comment on table public.project_structure_nodes is
  'Phase 2C.1c. The project-specific structure units of an Other project. Each unit sits at one level (never changes) under a same-project parent exactly one level up. weekly/monthly_reporting_required are the authoritative Other-project reporting scope (operational input required); Weekly and Monthly consume it and never re-declare it. Archive, do not delete, once referenced.';
comment on column public.project_structure_nodes.weekly_reporting_required is
  'This unit owes Weekly OPERATIONAL INPUT. Not a consolidated-review or management roll-up responsibility. A unit and its own ancestor or descendant may not both owe the same report.';
comment on column public.project_structure_nodes.monthly_reporting_required is
  'This unit owes Monthly OPERATIONAL INPUT. Same meaning and overlap rule as weekly_reporting_required.';

create index idx_project_structure_nodes_project_level
  on public.project_structure_nodes (project_id, level_number);
create index idx_project_structure_nodes_parent
  on public.project_structure_nodes (parent_id);

-- Active siblings never share a name (roots are siblings of each other).
-- Both unique indexes below are checked row by row (not deferrable — a partial
-- expression index cannot be): swapping two active units' names or codes in a
-- single multi-row statement can be refused depending on row order. The
-- service performs such a swap in two steps (2C.1c-b).
create unique index project_structure_nodes_active_sibling_name_unique
  on public.project_structure_nodes (project_id, parent_id, lower(name))
  nulls not distinct
  where archived_at is null;

-- An active code is unique within the project, at any level.
create unique index project_structure_nodes_active_code_unique
  on public.project_structure_nodes (project_id, upper(code))
  where archived_at is null and code is not null;

/* ------------------------------ Row guard -------------------------------- */

-- Every write path (table writes, the level RPC, any future definer path)
-- reaches this. Structure belongs to Other projects only, an archived project
-- is read-only, and a row's level is its identity.
create function public.guard_project_structure_write() returns trigger
language plpgsql
security definer
set search_path = ''
as $guard$
declare
  v_project uuid;
  v_family  text;
begin
  if tg_op = 'DELETE' then
    v_project := old.project_id;
  else
    v_project := new.project_id;
  end if;

  if public.project_is_archived(v_project) then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its structure is read-only.'
      using errcode = '42501';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select p.structure_family into v_family from public.projects p where p.id = v_project;
    if v_family is distinct from 'other' then
      raise exception '[NOT_OTHER] Only an Other project has a configurable Project Structure.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.level_number is distinct from old.level_number then
    raise exception '[LEVEL_IMMUTABLE] A level or unit keeps its level number. Create a new one instead.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$guard$;

revoke execute on function public.guard_project_structure_write()
  from public, anon, authenticated, service_role;

/* ------------------------- Level-set integrity --------------------------- */

-- Contiguity is a cross-row rule, so it is a constraint trigger checked at
-- the end of each statement: the levels of a project are exactly 1..n.
-- An empty set is valid (structure not configured yet).
create function public.check_project_structure_levels() returns trigger
language plpgsql
security definer
set search_path = ''
as $levels_check$
declare
  v_project uuid;
  v_count   integer;
  v_max     integer;
begin
  if tg_op = 'DELETE' then
    v_project := old.project_id;
  else
    v_project := new.project_id;
  end if;

  select count(*), coalesce(max(l.level_number), 0)
    into v_count, v_max
    from public.project_structure_levels l
   where l.project_id = v_project;

  if v_count <> v_max then
    raise exception '[LEVEL_GAP] Structure levels must run from 1 without gaps.'
      using errcode = '23514';
  end if;
  return null;
end;
$levels_check$;

revoke execute on function public.check_project_structure_levels()
  from public, anon, authenticated, service_role;

/* -------------------------- Node-set integrity --------------------------- */

-- Cross-row node rules, checked at the end of each statement against the
-- row's final state:
--   * the parent sits exactly one level up;
--   * an active unit has an active parent (insert / restore / move);
--   * an archived unit has no active children (archive children first);
--   * for the same report, a unit and its ancestor or descendant never both
--     owe operational input (the same input must not be requested twice).
-- A parent is always exactly one level shallower, so a cycle cannot form.
create function public.check_project_structure_node() returns trigger
language plpgsql
security definer
set search_path = ''
as $node_check$
declare
  r              public.project_structure_nodes;
  v_parent_level integer;
  v_parent_arch  timestamptz;
  v_cursor       uuid;
  v_next         uuid;
  v_w            boolean;
  v_m            boolean;
  v_anc_weekly   boolean := false;
  v_anc_monthly  boolean := false;
  v_desc_weekly  boolean;
  v_desc_monthly boolean;
begin
  select * into r from public.project_structure_nodes n where n.id = new.id;
  if not found then
    return null;
  end if;

  if r.parent_id is not null then
    select n.level_number, n.archived_at into v_parent_level, v_parent_arch
      from public.project_structure_nodes n
     where n.id = r.parent_id;
    if v_parent_level is distinct from r.level_number - 1 then
      raise exception '[PARENT_LEVEL] A unit''s parent must be on the level directly above it.'
        using errcode = '23514';
    end if;
    if r.archived_at is null and v_parent_arch is not null then
      raise exception '[PARENT_ARCHIVED] Restore the parent unit first.'
        using errcode = '23514';
    end if;
  end if;

  if r.archived_at is not null and exists (
    select 1 from public.project_structure_nodes c
     where c.parent_id = r.id and c.archived_at is null
  ) then
    raise exception '[ACTIVE_CHILDREN] Archive this unit''s child units first.'
      using errcode = '23514';
  end if;

  -- Ancestors (at most three).
  v_cursor := r.parent_id;
  while v_cursor is not null loop
    select n.parent_id, n.weekly_reporting_required, n.monthly_reporting_required
      into v_next, v_w, v_m
      from public.project_structure_nodes n
     where n.id = v_cursor;
    v_anc_weekly := v_anc_weekly or coalesce(v_w, false);
    v_anc_monthly := v_anc_monthly or coalesce(v_m, false);
    v_cursor := v_next;
  end loop;

  -- Descendants (at most three levels down).
  with recursive d as (
    select c.id, c.weekly_reporting_required as w, c.monthly_reporting_required as m
      from public.project_structure_nodes c
     where c.parent_id = r.id
    union all
    select c.id, c.weekly_reporting_required, c.monthly_reporting_required
      from public.project_structure_nodes c
      join d on c.parent_id = d.id
  )
  select coalesce(bool_or(d.w), false), coalesce(bool_or(d.m), false)
    into v_desc_weekly, v_desc_monthly
    from d;

  if (v_anc_weekly and (r.weekly_reporting_required or v_desc_weekly))
     or (r.weekly_reporting_required and v_desc_weekly) then
    raise exception '[REPORTING_OVERLAP] A unit and the units above or below it cannot all owe Weekly input.'
      using errcode = '23514';
  end if;
  if (v_anc_monthly and (r.monthly_reporting_required or v_desc_monthly))
     or (r.monthly_reporting_required and v_desc_monthly) then
    raise exception '[REPORTING_OVERLAP] A unit and the units above or below it cannot all owe Monthly input.'
      using errcode = '23514';
  end if;

  return null;
end;
$node_check$;

revoke execute on function public.check_project_structure_node()
  from public, anon, authenticated, service_role;

/* ------------------------------- Triggers -------------------------------- */

-- Guard first (alphabetical before-row order: guard_ < invalidate_ < set_).
create trigger guard_project_structure_write
  before insert or update or delete on public.project_structure_levels
  for each row execute function public.guard_project_structure_write();
create trigger guard_project_structure_write
  before insert or update or delete on public.project_structure_nodes
  for each row execute function public.guard_project_structure_write();

create trigger set_updated_at before update on public.project_structure_levels
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.project_structure_nodes
  for each row execute function public.set_updated_at();

-- The existing Project Setup protocol, unchanged: one setup writer at a time,
-- and any structure write advances the project version that optimistic saves
-- compare against (it also refuses moving rows between projects).
do $setup_triggers$
declare v_table text;
begin
  foreach v_table in array array['project_structure_levels', 'project_structure_nodes'] loop
    execute format('create trigger lock_project_setup_statement before insert or update or delete on public.%I for each statement execute function public.lock_project_setup_statement()', v_table);
    execute format('create trigger invalidate_setup_project_version before insert or update or delete on public.%I for each row execute function public.invalidate_setup_project_version()', v_table);
  end loop;
end;
$setup_triggers$;

create constraint trigger check_project_structure_levels
  after insert or update or delete on public.project_structure_levels
  deferrable initially immediate
  for each row execute function public.check_project_structure_levels();

create constraint trigger check_project_structure_node
  after insert or update on public.project_structure_nodes
  deferrable initially immediate
  for each row execute function public.check_project_structure_node();

/* --------------------------------- RLS ----------------------------------- */

alter table public.project_structure_levels enable row level security;
alter table public.project_structure_nodes enable row level security;

-- Read: exactly the visibility the reader has to the project itself. The
-- subquery runs under the projects table's own RLS, so a structure row is
-- visible if and only if its project row is: today that is projects_select
-- (can_access_project(id) OR has_published_portfolio_read() — global
-- operational authority, any project assignment, and both portfolio-read
-- tiers), and it follows any future change to that policy without a second,
-- drifting copy of the rule. Project structure is project definition, the
-- same surface the published tier already sees on the project record; it is
-- not report working content. (Older project-setup tables still read
-- USING (true); they are deliberately not changed here.)
--
-- Write: the existing Project Setup authority, exactly like
-- project_departments. Other-only and archived-project rules are enforced for
-- every path by guard_project_structure_write().
create policy project_structure_levels_select on public.project_structure_levels
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_structure_levels.project_id));
create policy project_structure_levels_insert on public.project_structure_levels
  for insert to authenticated
  with check (public.can_manage_project_setup(project_id));
create policy project_structure_levels_update on public.project_structure_levels
  for update to authenticated
  using (public.can_manage_project_setup(project_id))
  with check (public.can_manage_project_setup(project_id));
create policy project_structure_levels_delete on public.project_structure_levels
  for delete to authenticated
  using (public.can_manage_project_setup(project_id));

create policy project_structure_nodes_select on public.project_structure_nodes
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_structure_nodes.project_id));
create policy project_structure_nodes_insert on public.project_structure_nodes
  for insert to authenticated
  with check (public.can_manage_project_setup(project_id));
create policy project_structure_nodes_update on public.project_structure_nodes
  for update to authenticated
  using (public.can_manage_project_setup(project_id))
  with check (public.can_manage_project_setup(project_id));
create policy project_structure_nodes_delete on public.project_structure_nodes
  for delete to authenticated
  using (public.can_manage_project_setup(project_id));

-- Explicitly bounded ACL (same pattern as project_classification_corrections):
-- clear everything first, including any platform default privileges, so
-- authenticated never holds TRUNCATE (which would bypass RLS and every row
-- trigger), REFERENCES or TRIGGER. Then grant only row-level DML.
revoke all on public.project_structure_levels from public, anon, authenticated;
revoke all on public.project_structure_nodes from public, anon, authenticated;
grant select, insert, update, delete on public.project_structure_levels to authenticated;
grant select, insert, update, delete on public.project_structure_nodes to authenticated;

/* ------------------------ Atomic level configuration --------------------- */

-- Replaces a project's level set in one transaction.
--
-- p_levels is the complete desired set, a JSON array of
--   { "level_number": 1..4, "singular_label": text, "plural_label": text,
--     "id": uuid (optional) }
-- covering exactly level numbers 1..n.
--
-- With no units yet, the set is applied position by position (labels updated,
-- deeper levels added, deeper levels removed). Once units exist, level
-- numbers are fixed in meaning: a retained level must be sent with its own id
-- at its own number (rename only), new levels may only be appended below the
-- deepest, and only the deepest levels with no units at all may be removed.
--
-- Security invoker: RLS on the level table still applies. Messages carry a
-- [TAG] the application maps to fixed wording.
create function public.configure_project_structure_levels(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_levels jsonb
) returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $configure$
declare
  v_count    integer;
  v_family   text;
  v_status   text;
  v_version  timestamptz;
  v_existing integer;
  v_units    integer;
  v_bad      integer;
  v_saved_at timestamptz;
begin
  -- 1. Authority first.
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_setup(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] You cannot configure this project''s structure.'
      using errcode = '42501';
  end if;

  -- 2. Payload shape.
  if p_project is null or p_expected_updated_at is null
     or p_levels is null or jsonb_typeof(p_levels) <> 'array' then
    raise exception '[INVALID_LEVELS] The structure levels are not valid.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_levels);
  if v_count < 1 then
    raise exception '[INVALID_LEVELS] Define at least one structure level.' using errcode = '22023';
  end if;
  if v_count > 4 then
    raise exception '[LEVEL_LIMIT] A project structure has at most four levels.' using errcode = '22023';
  end if;

  -- Strict JSON types: a number for level_number, strings for the labels (a
  -- number or boolean is not silently coerced into a label).
  select count(*) into v_bad
    from jsonb_array_elements(p_levels) e
   where jsonb_typeof(e) <> 'object'
      or jsonb_typeof(e -> 'level_number') is distinct from 'number'
      or jsonb_typeof(e -> 'singular_label') is distinct from 'string'
      or jsonb_typeof(e -> 'plural_label') is distinct from 'string'
      or coalesce(e ->> 'level_number', '') !~ '^[0-9]{1,2}$'
      or nullif(btrim(coalesce(e ->> 'singular_label', '')), '') is null
      or nullif(btrim(coalesce(e ->> 'plural_label', '')), '') is null
      or length(btrim(e ->> 'singular_label')) > 60
      or length(btrim(e ->> 'plural_label')) > 60
      or (e ? 'id' and jsonb_typeof(e -> 'id') <> 'null'
          and coalesce(e ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  if v_bad > 0 then
    raise exception '[INVALID_LEVELS] Every level needs a number, a singular label and a plural label (60 characters at most).'
      using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_array_elements(p_levels) e where (e ->> 'level_number')::integer > 4) then
    raise exception '[LEVEL_LIMIT] A project structure has at most four levels.' using errcode = '22023';
  end if;
  if (select count(distinct (e ->> 'level_number')::integer) from jsonb_array_elements(p_levels) e) <> v_count
     or (select min((e ->> 'level_number')::integer) from jsonb_array_elements(p_levels) e) <> 1
     or (select max((e ->> 'level_number')::integer) from jsonb_array_elements(p_levels) e) <> v_count then
    raise exception '[LEVEL_GAP] Structure levels must run from 1 without gaps.' using errcode = '22023';
  end if;
  if (select count(distinct lower(btrim(e ->> 'singular_label'))) from jsonb_array_elements(p_levels) e) <> v_count
     or (select count(distinct lower(btrim(e ->> 'plural_label'))) from jsonb_array_elements(p_levels) e) <> v_count then
    raise exception '[DUPLICATE_LABEL] Each level needs its own name.' using errcode = '23505';
  end if;

  -- 3. Same lock order as every other setup writer: advisory lock, then rows.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if auth.uid() is null or public.current_user_role() is null
     or public.can_manage_project_setup(p_project) is distinct from true then
    raise exception '[NOT_AUTHORIZED] You cannot configure this project''s structure.'
      using errcode = '42501';
  end if;

  select p.structure_family, p.status, p.updated_at
    into v_family, v_status, v_version
    from public.projects p
   where p.id = p_project
   for update;
  if not found then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'P0002';
  end if;
  if v_version is distinct from p_expected_updated_at then
    raise exception '[STALE] The project changed since this page loaded. Reload before saving.'
      using errcode = '40001';
  end if;
  if v_status = 'archived' then
    raise exception '[PROJECT_ARCHIVED] This project is archived; its structure is read-only.'
      using errcode = '42501';
  end if;
  if v_family is distinct from 'other' then
    raise exception '[NOT_OTHER] Only an Other project has a configurable Project Structure.'
      using errcode = '23514';
  end if;

  select count(*) into v_existing from public.project_structure_levels l where l.project_id = p_project;
  select count(*) into v_units from public.project_structure_nodes n where n.project_id = p_project;

  -- 4. Once units exist, level numbers are fixed in meaning.
  if v_units > 0 then
    -- Every retained level is sent with its own id at its own number.
    if exists (
      select 1
        from public.project_structure_levels l
        left join jsonb_array_elements(p_levels) e
          on (e ->> 'level_number')::integer = l.level_number
       where l.project_id = p_project
         and l.level_number <= v_count
         and lower(e ->> 'id') is distinct from l.id::text
    ) then
      raise exception '[LEVEL_IN_USE] Levels already used by structure units can only be renamed. Add new levels below the deepest one.'
        using errcode = '23514';
    end if;
    -- New levels are appended only, and carry no id.
    if exists (
      select 1 from jsonb_array_elements(p_levels) e
       where (e ->> 'level_number')::integer > v_existing
         and e ? 'id' and jsonb_typeof(e -> 'id') <> 'null'
    ) then
      raise exception '[INVALID_LEVELS] A new level cannot carry an existing id.' using errcode = '22023';
    end if;
    -- Removed (deeper) levels must have no units at all, archived included.
    if exists (
      select 1 from public.project_structure_nodes n
       where n.project_id = p_project and n.level_number > v_count
    ) then
      raise exception '[LEVEL_IN_USE] A level that has structure units cannot be removed.'
        using errcode = '23514';
    end if;
  end if;

  -- 5. Apply. Labels may swap between levels in one save, so their uniqueness
  -- is checked once all rows are written.
  set constraints public.project_structure_levels_singular_key_unique,
                  public.project_structure_levels_plural_key_unique deferred;

  update public.project_structure_levels l
     set singular_label = btrim(e ->> 'singular_label'),
         plural_label = btrim(e ->> 'plural_label')
    from jsonb_array_elements(p_levels) e
   where l.project_id = p_project
     and l.level_number = (e ->> 'level_number')::integer
     and (l.singular_label is distinct from btrim(e ->> 'singular_label')
          or l.plural_label is distinct from btrim(e ->> 'plural_label'));

  delete from public.project_structure_levels l
   where l.project_id = p_project and l.level_number > v_count;

  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  select p_project, (e ->> 'level_number')::integer,
         btrim(e ->> 'singular_label'), btrim(e ->> 'plural_label')
    from jsonb_array_elements(p_levels) e
   where (e ->> 'level_number')::integer > v_existing
   order by (e ->> 'level_number')::integer;

  set constraints public.project_structure_levels_singular_key_unique,
                  public.project_structure_levels_plural_key_unique immediate;

  select p.updated_at into v_saved_at from public.projects p where p.id = p_project;
  return v_saved_at;
end;
$configure$;

revoke execute on function public.configure_project_structure_levels(uuid, timestamptz, jsonb)
  from public, anon;
grant execute on function public.configure_project_structure_levels(uuid, timestamptz, jsonb)
  to authenticated;

/* ---------- System Admin correction: Other -> PSM structure guard -------- */

-- Body identical to 20261001000001 except step 4b.
create or replace function public.correct_project_structure_family(
  p_project uuid,
  p_expected_updated_at timestamptz,
  p_new_family text,
  p_project_type_id uuid,
  p_project_category_detail text,
  p_reason text
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $correct$
declare
  v_reason        text;
  v_detail_in     text;
  v_allows_custom boolean;
  v_new_type_name text;
  v_type_active   boolean;
  v_type_psm      boolean;
  v_old           text;
  v_old_type      uuid;
  v_old_detail    text;
  v_old_type_name text;
  v_version       timestamptz;
  v_actor_name    text;
  v_saved_at      timestamptz;
begin
  -- 1. Authority first: an unauthorized caller learns nothing about the project.
  if auth.uid() is null or public.current_user_role() is null
     or public.is_system_admin() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a System Admin can correct a Project Type.'
      using errcode = '42501';
  end if;

  -- 2. Mandatory, non-blank reason.
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception '[REASON_REQUIRED] A reason is required to correct a Project Type.'
      using errcode = '22023';
  end if;

  -- 3. The target must be a complete, valid classification.
  if p_project is null or p_expected_updated_at is null
     or p_new_family is null or p_new_family not in ('psm', 'other') then
    raise exception '[INVALID_TARGET] Invalid Project Type correction.' using errcode = '22023';
  end if;
  v_detail_in := nullif(btrim(coalesce(p_project_category_detail, '')), '');

  if p_new_family = 'psm' then
    -- A PSM project has no Project Category.
    if p_project_type_id is not null or v_detail_in is not null then
      raise exception '[INVALID_TARGET] A PSM project has no Project Category.'
        using errcode = '22023';
    end if;
  else
    if p_project_type_id is null then
      raise exception '[CATEGORY_REQUIRED] An Other project needs a Project Category.'
        using errcode = '23514';
    end if;
    select pt.allows_custom_name, pt.name, pt.active,
           public.is_psm_family_project_type(pt.code, pt.name)
      into v_allows_custom, v_new_type_name, v_type_active, v_type_psm
      from public.project_types pt
     where pt.id = p_project_type_id;
    if not found or v_type_active is distinct from true then
      raise exception '[CATEGORY_INVALID] Choose an active Project Category.'
        using errcode = '23514';
    end if;
    if v_type_psm then
      raise exception '[CATEGORY_PSM_FAMILY] An Other project cannot use a PSM / PSAIM Project Category.'
        using errcode = '23514';
    end if;
    if v_allows_custom and v_detail_in is null then
      raise exception '[DETAIL_REQUIRED] Specify the category name for this Project Category.'
        using errcode = '23514';
    end if;
    if not v_allows_custom and v_detail_in is not null then
      raise exception '[DETAIL_NOT_ALLOWED] This Project Category does not take a custom name.'
        using errcode = '23514';
    end if;
  end if;

  -- 4. Same lock order as every other setup writer: advisory lock, then rows.
  perform pg_catalog.pg_advisory_xact_lock(190726, 1);
  if auth.uid() is null or public.current_user_role() is null
     or public.is_system_admin() is distinct from true then
    raise exception '[NOT_AUTHORIZED] Only a System Admin can correct a Project Type.'
      using errcode = '42501';
  end if;

  select structure_family, project_type_id, project_category_detail, updated_at
    into v_old, v_old_type, v_old_detail, v_version
    from public.projects
   where id = p_project
   for update;
  if not found then
    raise exception '[NOT_FOUND] Project not found.' using errcode = 'P0002';
  end if;
  if v_version is distinct from p_expected_updated_at then
    raise exception '[STALE] The project changed since this page loaded. Reload before correcting.'
      using errcode = '40001';
  end if;
  if v_old is null then
    raise exception '[NOT_CLASSIFIED] This project is not classified yet. Classify it from Project Setup instead.'
      using errcode = '22023';
  end if;
  if v_old = p_new_family then
    raise exception '[SAME_TYPE] The project already has this Project Type.' using errcode = '22023';
  end if;

  -- 4b. (2C.1c) An Other project whose structure is still active cannot
  -- become PSM. Archived units alone do not block the correction; they stay
  -- with the project, read-only (the structure guard refuses writes on a
  -- non-Other project). Stronger guards arrive with historical references.
  if v_old = 'other' and p_new_family = 'psm' and exists (
    select 1 from public.project_structure_nodes n
     where n.project_id = p_project and n.archived_at is null
  ) then
    raise exception '[STRUCTURE_EXISTS] Archive this project''s structure units before changing it to a PSM Project.'
      using errcode = '23514';
  end if;

  select pt.name into v_old_type_name from public.project_types pt where pt.id = v_old_type;
  select p.full_name into v_actor_name from public.profiles p where p.id = auth.uid();

  -- 5. Audit BEFORE the change: the lock trigger looks for this row.
  insert into public.project_classification_corrections (
    project_id, old_family, new_family,
    old_project_type_id, new_project_type_id,
    old_project_type_name, new_project_type_name,
    old_category_detail, new_category_detail,
    reason, corrected_by, corrected_by_name
  ) values (
    p_project, v_old, p_new_family,
    v_old_type, p_project_type_id,
    v_old_type_name, v_new_type_name,
    v_old_detail, v_detail_in,
    v_reason, auth.uid(), v_actor_name
  );

  -- 6. Then the project, to exactly the audited target.
  update public.projects
     set structure_family = p_new_family,
         project_type_id = p_project_type_id,
         project_category_detail = v_detail_in
   where id = p_project
   returning updated_at into v_saved_at;

  return v_saved_at;
end;
$correct$;

revoke execute on function public.correct_project_structure_family(uuid, timestamptz, text, uuid, text, text)
  from public, anon;
grant execute on function public.correct_project_structure_family(uuid, timestamptz, text, uuid, text, text)
  to authenticated;

/* ----------------------------- Postconditions ---------------------------- */

do $post$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.project_structure_levels'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.project_structure_nodes'::regclass) then
    raise exception 'Postcondition failed: RLS must be enabled on both structure tables.';
  end if;
  if has_table_privilege('anon', 'public.project_structure_levels', 'select, insert, update, delete, truncate, references, trigger')
     or has_table_privilege('anon', 'public.project_structure_nodes', 'select, insert, update, delete, truncate, references, trigger') then
    raise exception 'Postcondition failed: anon must have no access to structure tables.';
  end if;
  if has_table_privilege('authenticated', 'public.project_structure_levels', 'truncate, references, trigger')
     or has_table_privilege('authenticated', 'public.project_structure_nodes', 'truncate, references, trigger') then
    raise exception 'Postcondition failed: authenticated must hold only SELECT, INSERT, UPDATE, DELETE on structure tables.';
  end if;
  if position('[STRUCTURE_EXISTS]' in (
       select prosrc from pg_proc where oid = 'public.correct_project_structure_family(uuid, timestamptz, text, uuid, text, text)'::regprocedure
     )) = 0 then
    raise exception 'Postcondition failed: the correction guard is missing.';
  end if;
end;
$post$;
