-- EPRP Phase 13.1 — Reference Input metadata.
--
-- Additive only. Three nullable columns and two widened/added CHECK constraints
-- on the existing public.project_documents table. No new table, no RLS change,
-- no storage-bucket change, no existing row read or written, and nothing that
-- parses an uploaded file.
--
-- NOTE ON THE "P13" LABEL: migration 20260817000004 is headed "EPRP P13 —
-- official Project Reference Documents". That label refers to the shipped
-- Project Reference Documents work, not to this phase. This migration is
-- sub-phase 13.1 of Phase 13 (Master Planning & Control) as numbered in
-- docs/15_DEVELOPMENT_ROADMAP.md.

/* ------------------------------- columns --------------------------------- */

alter table public.project_documents
  -- The revision chain. Self-referencing and nullable: most documents have no
  -- successor. ON DELETE SET NULL so removing a successor un-links the
  -- predecessor rather than cascading a delete through the chain.
  add column if not exists superseded_by_document_id uuid
    references public.project_documents(id) on delete set null,
  -- Where the document came from. Distinct from uploaded_by, which is who put
  -- it into the platform.
  add column if not exists source text,
  -- When the document takes effect, which is not always when it was issued.
  add column if not exists effective_date date;

comment on column public.project_documents.superseded_by_document_id is
  'The document that replaced this one. Written only by projectDocumentService.supersede(), together with status = ''superseded'', so the two representations cannot drift.';
comment on column public.project_documents.source is
  'Provenance of the document: client_issued | internal | contractor | other.';
comment on column public.project_documents.effective_date is
  'Date the document takes effect. Distinct from issue_date.';

/* ------------------------------ constraints ------------------------------- */

-- document_type widened by 'schedule_update' so a schedule revision can be
-- filed as its own reference input rather than as another baseline_schedule.
-- Every previously legal value is retained; no stored row can be invalidated.
alter table public.project_documents
  drop constraint if exists project_documents_type_valid;

alter table public.project_documents
  add constraint project_documents_type_valid check (document_type in (
    'scope_of_work',
    'baseline_schedule',
    'schedule_update',
    'contract_purchase_order',
    'approved_proposal',
    'organization_chart',
    'kickoff_mom',
    'other'
  ));

alter table public.project_documents
  add constraint project_documents_source_valid check (
    source is null or source in (
      'client_issued',
      'internal',
      'contractor',
      'other'
    )
  );

-- A document cannot supersede itself.
alter table public.project_documents
  add constraint project_documents_supersede_not_self check (
    superseded_by_document_id is null
    or superseded_by_document_id <> id
  );

/*
 * The invariant, enforced in the only direction that is safe.
 *
 * A document that POINTS AT a successor must be at status 'superseded'. That is
 * the half that can drift — a chain link written without the status would leave
 * the register showing a current document that has in fact been replaced.
 *
 * The converse is deliberately NOT enforced: a document may legitimately be at
 * status 'superseded' with no link, either because it was superseded by
 * something outside the platform, or because it was already marked that way
 * before this migration existed. Enforcing that direction would invalidate
 * stored rows, which this migration must not do.
 */
alter table public.project_documents
  add constraint project_documents_supersede_status check (
    superseded_by_document_id is null
    or status = 'superseded'
  );

/* -------------------------------- indexes --------------------------------- */

-- Supports "what did this document replace?" — the reverse of the stored edge.
create index if not exists project_documents_superseded_by
  on public.project_documents(superseded_by_document_id)
  where superseded_by_document_id is not null;

-- Supports the four Reference Input buckets, which read by type within a
-- project and order by effective date.
create index if not exists project_documents_project_type_effective
  on public.project_documents(project_id, document_type, effective_date desc);
