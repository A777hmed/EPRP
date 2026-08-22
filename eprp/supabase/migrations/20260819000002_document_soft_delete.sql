-- EPRP Phase 13.1 — two-stage delete for Project Reference Documents.
--
-- Stage 1 (soft delete) moves a document to Trash: the row and the storage
-- object both remain. Stage 2 (permanent delete) removes both, and is reserved
-- for System Administrators.
--
-- DELETION IS A SEPARATE AXIS FROM STATUS. `deleted_at` is the discriminator;
-- `status` is never overwritten. Two reasons, both load-bearing:
--
--   1. 20260819000001 added
--        check (superseded_by_document_id is null or status = 'superseded')
--      so writing status = 'deleted' on a superseded document would be
--      rejected outright.
--   2. Restore has to return the document to what it WAS. Overwriting status
--      destroys that, and the platform's rule is that superseded revisions stay
--      superseded — "Superseded is not Deleted".
--
-- Additive except two policy replacements. No existing row is read or written.

/* -------------------------------- columns --------------------------------- */

alter table public.project_documents
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid
    references public.profiles(id) on delete set null,
  -- Name snapshot, mirroring uploaded_by_name: who deleted it must stay
  -- readable after the account is archived or unlinked.
  add column if not exists deleted_by_name text,
  add column if not exists delete_reason text;

comment on column public.project_documents.deleted_at is
  'Soft-delete discriminator. NULL = active. Never derived from status, which keeps its own value so Restore can return the document to what it was.';
comment on column public.project_documents.delete_reason is
  'Why the document was moved to Trash. Mandatory whenever deleted_at is set.';

/* ------------------------------ constraints ------------------------------- */

-- A reason is mandatory on soft delete, and meaningless without one.
alter table public.project_documents
  add constraint project_documents_delete_reason_required check (
    (deleted_at is null and delete_reason is null)
    or (deleted_at is not null and length(btrim(coalesce(delete_reason, ''))) > 0)
  );

/* -------------------------------- indexes --------------------------------- */

-- The active list is the common read; keep it off the deleted rows.
create index if not exists project_documents_active
  on public.project_documents(project_id, document_type)
  where deleted_at is null;

create index if not exists project_documents_deleted
  on public.project_documents(project_id, deleted_at desc)
  where deleted_at is not null;

/* ------------------------------- permissions ------------------------------ */

/*
 * Who may move a document to Trash, and take it back out.
 *
 * Deliberately NOT weekly_can_manage_project: that helper also admits the
 * Reporting Coordinator, who may edit metadata and supersede but must never
 * delete or restore. This is the same shape minus that one arm.
 */
create or replace function public.can_bin_project_document(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_system_admin()
    or (
      public.current_contact_id() is not null
      and exists (
        select 1 from public.projects pr
         where pr.id = p_project
           and pr.project_control_manager_id = public.current_contact_id()
      )
    );
$$;

comment on function public.can_bin_project_document(uuid) is
  'True for a System Administrator or the project''s Project Control Manager. Excludes the Reporting Coordinator, who may edit and supersede but not delete or restore.';

/*
 * Guard the deleted_at axis at column level.
 *
 * A blanket UPDATE restriction would be too coarse — it would also strip the
 * Reporting Coordinator's metadata edit and supersede rights, which they keep.
 * This fires only when deleted_at actually changes, so every other update is
 * untouched.
 *
 * The trigger also stamps deleted_by / deleted_by_name and clears the whole
 * delete triple on restore, so the application cannot leave a half-written
 * state behind.
 */
create or replace function public.guard_project_document_bin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if not public.can_bin_project_document(new.project_id) then
      raise exception
        'Only a System Administrator or the Project Control Manager may delete or restore a project document'
        using errcode = 'insufficient_privilege';
    end if;

    if new.deleted_at is not null then
      new.deleted_by := coalesce(new.deleted_by, auth.uid());
      if new.deleted_by_name is null then
        select full_name into new.deleted_by_name
          from public.profiles where id = new.deleted_by;
      end if;
    else
      -- Restore clears the whole triple; a restored document carries no
      -- residue of the deletion that was undone.
      new.deleted_by := null;
      new.deleted_by_name := null;
      new.delete_reason := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger project_documents_bin_guard
  before update on public.project_documents
  for each row execute function public.guard_project_document_bin();

/*
 * Permanent delete is System Administrator only.
 *
 * Replaces the previous policy, which admitted anyone passing
 * weekly_can_manage_project — that is, the Project Control Manager and the
 * Reporting Coordinator too.
 */
drop policy if exists project_documents_delete on public.project_documents;

create policy project_documents_delete on public.project_documents
  for delete to authenticated
  using (public.is_system_admin());

/*
 * The storage object must follow the same rule. Left as it was, a Project
 * Control Manager could delete the file directly through the storage API while
 * the metadata row survived, leaving a row pointing at nothing.
 */
drop policy if exists project_reference_documents_delete on storage.objects;

create policy project_reference_documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-reference-documents'
    and public.is_system_admin()
  );
