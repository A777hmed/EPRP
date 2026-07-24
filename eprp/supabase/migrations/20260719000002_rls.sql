-- EPRP Phase 5C — Row Level Security.
--
-- RLS is enabled on every table. Temporary policies grant authenticated
-- users full CRUD (the "Admin" role until real RBAC lands in a later phase).
-- Anonymous access is intentionally denied. The service-role key bypasses
-- RLS and must remain server-only.

alter table public.clients             enable row level security;
alter table public.project_types       enable row level security;
alter table public.project_phases      enable row level security;
alter table public.departments         enable row level security;
alter table public.contacts            enable row level security;
alter table public.systems             enable row level security;
alter table public.disciplines         enable row level security;
alter table public.projects            enable row level security;
alter table public.project_departments enable row level security;
alter table public.project_contacts    enable row level security;

-- One temporary "authenticated full access" policy per table.
-- TODO(Phase 6): replace with role-based policies once auth + RBAC exist.

do $$
declare
  tbl text;
  tables text[] := array[
    'clients', 'project_types', 'project_phases', 'departments', 'contacts',
    'systems', 'disciplines', 'projects', 'project_departments',
    'project_contacts'
  ];
begin
  foreach tbl in array tables loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      tbl || '_authenticated_all',
      tbl
    );
  end loop;
end;
$$;
