-- Add a project-owned Department description without changing the shared
-- Department master record. Existing links remain NULL and therefore fall
-- back to the master description in the application.

alter table public.project_departments
  add column if not exists project_description text;

comment on column public.project_departments.project_description is
  'Optional project-specific scope/notes for this Department link. NULL falls back to the shared Department master description.';
