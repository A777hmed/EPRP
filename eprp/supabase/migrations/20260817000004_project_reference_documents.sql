-- EPRP P13 — official Project Reference Documents.
-- Additive only: new metadata table, private bucket and project-scoped RLS.
-- Existing Project, report and attachment data is not changed.

create table public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  document_type text not null,
  document_number text,
  revision text,
  issue_date date,
  status text not null default 'current',
  notes text,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  storage_path text not null unique,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_documents_title_not_blank check (length(btrim(title)) > 0),
  constraint project_documents_file_name_not_blank check (length(btrim(file_name)) > 0),
  constraint project_documents_file_size_positive check (file_size > 0),
  constraint project_documents_type_valid check (document_type in (
    'scope_of_work',
    'baseline_schedule',
    'contract_purchase_order',
    'approved_proposal',
    'organization_chart',
    'kickoff_mom',
    'other'
  )),
  constraint project_documents_status_valid check (status in (
    'current', 'superseded', 'draft', 'approved', 'cancelled'
  ))
);

comment on table public.project_documents is
  'Authoritative, revision-aware Project reference documents. Superseded rows are retained; file bytes live in the private project-reference-documents bucket.';

create index project_documents_project_date
  on public.project_documents(project_id, issue_date desc, created_at desc);

create index project_documents_project_type
  on public.project_documents(project_id, document_type, status);

create trigger set_updated_at
  before update on public.project_documents
  for each row execute function public.set_updated_at();

create or replace function public.set_project_document_authorship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
  if new.uploaded_by_name is null then
    select full_name into new.uploaded_by_name
      from public.profiles
     where id = new.uploaded_by;
  end if;
  return new;
end;
$$;

create trigger project_documents_authorship
  before insert on public.project_documents
  for each row execute function public.set_project_document_authorship();

alter table public.project_documents enable row level security;

create policy project_documents_select on public.project_documents
  for select to authenticated
  using (public.weekly_can_access_project(project_id));

create policy project_documents_insert on public.project_documents
  for insert to authenticated
  with check (public.weekly_can_manage_project(project_id));

create policy project_documents_update on public.project_documents
  for update to authenticated
  using (public.weekly_can_manage_project(project_id))
  with check (public.weekly_can_manage_project(project_id));

create policy project_documents_delete on public.project_documents
  for delete to authenticated
  using (public.weekly_can_manage_project(project_id));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'project-reference-documents',
  'project-reference-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;

-- Storage paths are always `{project UUID}/{document UUID}/{file name}`.
-- Invalid/non-project paths resolve to NULL rather than throwing in a policy.
create or replace function public.project_id_from_storage_path(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create policy project_reference_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-reference-documents'
    and public.weekly_can_access_project(public.project_id_from_storage_path(name))
  );

create policy project_reference_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-reference-documents'
    and public.weekly_can_manage_project(public.project_id_from_storage_path(name))
  );

create policy project_reference_documents_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-reference-documents'
    and public.weekly_can_manage_project(public.project_id_from_storage_path(name))
  )
  with check (
    bucket_id = 'project-reference-documents'
    and public.weekly_can_manage_project(public.project_id_from_storage_path(name))
  );

create policy project_reference_documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-reference-documents'
    and public.weekly_can_manage_project(public.project_id_from_storage_path(name))
  );
