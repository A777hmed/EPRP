import type {
  ProjectDocument,
  ProjectDocumentSource,
  ProjectDocumentStatus,
  ProjectDocumentType,
} from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ProjectDocumentRow } from "@/lib/supabase/database.types";

const BUCKET = "project-reference-documents";

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

/** Metadata a user may change after upload. The FILE is never replaced. */
export interface EditProjectDocumentInput {
  title: string;
  documentType: ProjectDocumentType;
  documentNumber?: string;
  revision?: string;
  issueDate?: string;
  effectiveDate?: string;
  source?: ProjectDocumentSource | "";
  notes?: string;
}

/**
 * What permanently deleting a document would mean.
 *
 * Revision-chain membership is an IMPACT, not a block: a wrong upload that has
 * been superseded is exactly the case an administrator needs to purge, and
 * refusing it made the Trash useless. Chain links are repaired instead, and the
 * repairs are disclosed before anything is destroyed.
 *
 * `blockedBy` is reserved for genuine controlled references — evidence,
 * deliverables, milestones, reports, retained history — which must never be
 * silently broken.
 */
export interface DocumentDeleteAssessment {
  /** True when nothing hard-blocks the delete. */
  allowed: boolean;
  /** Controlled references that must be cleared first. Empty means none. */
  blockedBy: string[];
  /** The document that replaced this one, if any. */
  successor?: ProjectDocument;
  /** Documents that name this one as their replacement. */
  predecessors: ProjectDocument[];
  /** Plain-language description of every chain repair that will be applied. */
  repairs: string[];
}

export interface UploadProjectDocumentInput {
  title: string;
  documentType: ProjectDocumentType;
  documentNumber?: string;
  revision?: string;
  issueDate?: string;
  effectiveDate?: string;
  source?: ProjectDocumentSource | "";
  status: ProjectDocumentStatus;
  notes?: string;
}

function mapRow(row: ProjectDocumentRow): ProjectDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    documentType: row.document_type as ProjectDocumentType,
    documentNumber: row.document_number ?? undefined,
    revision: row.revision ?? undefined,
    issueDate: row.issue_date ?? undefined,
    effectiveDate: row.effective_date ?? undefined,
    source: (row.source as ProjectDocumentSource | null) ?? undefined,
    status: row.status as ProjectDocumentStatus,
    supersededByDocumentId: row.superseded_by_document_id ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    deletedBy: row.deleted_by ?? undefined,
    deletedByName: row.deleted_by_name ?? undefined,
    deleteReason: row.delete_reason ?? undefined,
    notes: row.notes ?? undefined,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    storagePath: row.storage_path,
    uploadedBy: row.uploaded_by ?? undefined,
    uploadedByName: row.uploaded_by_name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-");
}

export const projectDocumentService = {
  async list(projectId: string): Promise<ProjectDocument[]> {
    const { data, error } = await client()
      .from("project_documents")
      .select("*")
      .eq("project_id", projectId)
      .order("issue_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ProjectDocumentRow[]).map(mapRow);
  },

  async upload(
    projectId: string,
    input: UploadProjectDocumentInput,
    file: File
  ): Promise<ProjectDocument> {
    const sb = client();
    const id = globalThis.crypto.randomUUID();
    const storagePath = `${projectId}/${id}/${safeFileName(file.name)}`;

    const { error: uploadError } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await sb
      .from("project_documents")
      .insert({
        id,
        project_id: projectId,
        title: input.title.trim(),
        document_type: input.documentType,
        document_number: clean(input.documentNumber),
        revision: clean(input.revision),
        issue_date: clean(input.issueDate),
        effective_date: clean(input.effectiveDate),
        source: clean(input.source),
        status: input.status,
        notes: clean(input.notes),
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        file_size: file.size,
        storage_path: storagePath,
      })
      .select("*")
      .single();

    if (error) {
      await sb.storage.from(BUCKET).remove([storagePath]);
      throw new Error(error.message);
    }
    return mapRow(data as ProjectDocumentRow);
  },

  async setStatus(
    documentId: string,
    status: ProjectDocumentStatus
  ): Promise<ProjectDocument> {
    const { data, error } = await client()
      .from("project_documents")
      .update({ status })
      .eq("id", documentId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(data as ProjectDocumentRow);
  },

  /**
   * Record that one document has been replaced by another.
   *
   * The status and the chain link are written by a SINGLE update statement, so
   * there is no window in which a document points at a successor without being
   * marked superseded. A database CHECK refuses the half-written state
   * independently, so a future caller cannot reintroduce the drift by updating
   * either column on its own.
   *
   * Both documents are re-read first rather than trusted from the caller: the
   * checks below are about what is actually stored, and the project comparison
   * is what stops a link being forged across projects. RLS still applies to
   * every statement here — a caller who cannot see a document cannot link it.
   *
   * Returns both rows as they now stand, predecessor first.
   */
  async supersede(
    predecessorId: string,
    successorId: string
  ): Promise<{ predecessor: ProjectDocument; successor: ProjectDocument }> {
    if (predecessorId === successorId) {
      throw new Error("A document cannot supersede itself.");
    }

    const sb = client();
    const { data: pair, error: readError } = await sb
      .from("project_documents")
      .select("*")
      .in("id", [predecessorId, successorId]);
    if (readError) throw new Error(readError.message);

    const rows = (pair ?? []) as ProjectDocumentRow[];
    const predecessor = rows.find((row) => row.id === predecessorId);
    const successor = rows.find((row) => row.id === successorId);
    if (!predecessor || !successor) {
      throw new Error(
        "Both documents must exist and be visible to you before one can supersede the other."
      );
    }
    if (predecessor.project_id !== successor.project_id) {
      throw new Error(
        "A document can only be superseded by another document on the same project."
      );
    }
    // Refuse the two-row cycle. Longer cycles are not reachable while a
    // document has at most one successor and the chain is only ever extended
    // from the newest end.
    if (successor.superseded_by_document_id === predecessorId) {
      throw new Error(
        "That document is already superseded by this one; linking them both ways would create a loop."
      );
    }

    const { data, error } = await sb
      .from("project_documents")
      .update({
        status: "superseded",
        superseded_by_document_id: successorId,
      })
      .eq("id", predecessorId)
      // Belt and braces on project isolation: even if the read above were
      // stale, the write cannot land on a row in another project.
      .eq("project_id", predecessor.project_id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return {
      predecessor: mapRow(data as ProjectDocumentRow),
      successor: mapRow(successor),
    };
  },

  /**
   * Update a document's METADATA. The uploaded file is never touched.
   *
   * Replacing a file is what "upload a new revision" is for — rewriting the
   * bytes under an unchanged row would silently falsify history. Status and
   * the supersession link are excluded too: those belong to `setStatus` and
   * `supersede`, which enforce their own rules.
   */
  async update(
    documentId: string,
    input: EditProjectDocumentInput
  ): Promise<ProjectDocument> {
    const { data, error } = await client()
      .from("project_documents")
      .update({
        title: input.title.trim(),
        document_type: input.documentType,
        document_number: clean(input.documentNumber),
        revision: clean(input.revision),
        issue_date: clean(input.issueDate),
        effective_date: clean(input.effectiveDate),
        source: clean(input.source),
        notes: clean(input.notes),
      })
      .eq("id", documentId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(data as ProjectDocumentRow);
  },

  /**
   * Stage 1 — move a document to Trash.
   *
   * Nothing is destroyed: the row stays, the storage object stays, and
   * `status` is deliberately NOT overwritten, so a superseded document that is
   * binned is still superseded and Restore can return it to exactly that.
   *
   * `deleted_by` and `deleted_by_name` are stamped by a database trigger, which
   * also enforces that only a System Administrator or the Project Control
   * Manager may cross this axis — the Reporting Coordinator keeps metadata edit
   * and supersede rights but cannot bin anything.
   */
  async softDelete(
    documentId: string,
    reason: string
  ): Promise<ProjectDocument> {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new Error("A reason is required to delete a document.");
    }
    const { data, error } = await client()
      .from("project_documents")
      .update({
        deleted_at: new Date().toISOString(),
        delete_reason: trimmed,
      })
      .eq("id", documentId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(data as ProjectDocumentRow);
  },

  /**
   * Take a document back out of Trash.
   *
   * Only `deleted_at` is cleared here; the trigger clears `deleted_by`,
   * `deleted_by_name` and `delete_reason` in the same statement, so a restored
   * document carries no residue of the deletion that was undone. Its original
   * status is untouched and therefore already correct.
   */
  async restore(documentId: string): Promise<ProjectDocument> {
    const { data, error } = await client()
      .from("project_documents")
      .update({ deleted_at: null })
      .eq("id", documentId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(data as ProjectDocumentRow);
  },

  /**
   * What would stop this document being permanently removed.
   *
   * Checked BEFORE the delete rather than relying on the foreign key:
   * `superseded_by_document_id` is ON DELETE SET NULL, so deleting a document
   * inside a chain would silently null its predecessor's link and leave that
   * predecessor marked superseded with nothing to point at. Refusing up front
   * is what keeps the revision history honest, and it is why the caller is told
   * exactly what is blocking instead of getting a database error.
   *
   * `siblings` is the project's full document list, which the panel already
   * holds — the reverse edge is not stored, so it has to be computed.
   *
   * Evidence and milestone/deliverable/report references are not checked here
   * because none of those tables exist yet. Each lands with its own phase, and
   * its check belongs in this function when it does.
   */
  /**
   * Assess a permanent delete: what blocks it, and what it would repair.
   *
   * `siblings` is the project's full document list, which the panel already
   * holds — the reverse edge (who points AT this document) is not stored and
   * has to be computed.
   *
   * Controlled references — evidence, deliverables, milestones, reports,
   * retained history — are the only hard blocks. None of those tables exist
   * yet; each lands with its own phase and its check belongs here when it does.
   * They are listed in the UI as "none found" rather than silently omitted, so
   * the absence is visible rather than assumed.
   */
  assessPermanentDelete(
    document: ProjectDocument,
    siblings: ProjectDocument[]
  ): DocumentDeleteAssessment {
    const blockedBy: string[] = [];
    if (!document.deletedAt) {
      blockedBy.push("It must be moved to Deleted Documents first.");
    }

    const successor = document.supersededByDocumentId
      ? siblings.find((item) => item.id === document.supersededByDocumentId)
      : undefined;
    const predecessors = siblings.filter(
      (item) => item.supersededByDocumentId === document.id
    );

    /*
     * Describe the repair in the same terms the chain is displayed in, so the
     * confirmation reads as the consequence of the act rather than as jargon.
     */
    const repairs: string[] = [];
    for (const predecessor of predecessors) {
      if (successor && successor.id !== predecessor.id) {
        repairs.push(
          `"${predecessor.title}" will point at "${successor.title}" instead, and stays superseded.`
        );
      } else {
        repairs.push(
          `"${predecessor.title}" will no longer be marked superseded — nothing would replace it — and returns to Current.`
        );
      }
    }
    if (successor && predecessors.length === 0) {
      repairs.push(
        `"${successor.title}" is unaffected; only this document's own link to it is removed.`
      );
    }

    return {
      allowed: blockedBy.length === 0,
      blockedBy,
      successor,
      predecessors,
      repairs,
    };
  },

  /**
   * Stage 2 — repair the revision chain, then remove the row and the file.
   *
   * ORDER IS THE WHOLE POINT. Predecessors are rewired BEFORE the row goes,
   * because `superseded_by_document_id` is ON DELETE SET NULL: delete first and
   * the database nulls those links itself, losing the information needed to
   * reconnect them and leaving documents marked superseded with nothing to
   * point at. Rewiring first means that by the time the row is deleted, nothing
   * references it and the cascade has nothing to do.
   *
   * Chain repair, given A → B → C and deleting B:
   *   A is rewired to C and stays superseded, giving A → C.
   * Given A → B and deleting B:
   *   A's link is cleared AND its status returns to Current, because leaving it
   *   "Superseded" with no successor is a false statement about the document.
   *
   * No other document is ever deleted. Only the links that named the purged
   * document are touched; every other field on every other row is left alone.
   */
  async deletePermanently(
    document: ProjectDocument,
    siblings: ProjectDocument[] = []
  ): Promise<void> {
    const sb = client();
    const successorId = document.supersededByDocumentId ?? null;
    const predecessors = siblings.filter(
      (item) => item.supersededByDocumentId === document.id
    );

    for (const predecessor of predecessors) {
      /*
       * Guard against pointing a document at itself. supersede() already
       * refuses the two-row cycle that would produce this, but a repair must
       * not be the thing that creates one.
       */
      const rewireTo =
        successorId && successorId !== predecessor.id ? successorId : null;

      const { error } = await sb
        .from("project_documents")
        .update(
          rewireTo
            ? { superseded_by_document_id: rewireTo }
            : {
                // Both in one statement: the CHECK requires that a document
                // carrying a link is superseded, so they can never disagree.
                superseded_by_document_id: null,
                status: "current",
              }
        )
        .eq("id", predecessor.id);
      if (error) {
        throw new Error(
          `Could not repair the revision chain for "${predecessor.title}": ${error.message}`
        );
      }
    }

    const { error: storageError } = await sb.storage
      .from(BUCKET)
      .remove([document.storagePath]);
    if (storageError) throw new Error(storageError.message);

    const { error } = await sb
      .from("project_documents")
      .delete()
      .eq("id", document.id);
    if (error) throw new Error(error.message);
  },

  /**
   * A signed URL for INLINE preview only.
   *
   * Served with `Content-Disposition: inline`, so the browser renders it in the
   * viewer frame. Only ever hand this to a preview surface: for a format the
   * browser cannot render, an inline URL lets whatever plugin claims the
   * content type take over the tab, which is how a Word file ended up in a PDF
   * reader. Anything the user is meant to keep goes through `getDownloadUrl`.
   */
  async getViewUrl(document: ProjectDocument): Promise<string> {
    const { data, error } = await client().storage
      .from(BUCKET)
      .createSignedUrl(document.storagePath, 60 * 60);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  /**
   * A signed URL that returns the ORIGINAL uploaded file.
   *
   * `download` sets `Content-Disposition: attachment` with an explicit
   * filename, which fixes two things at once:
   *
   * - the browser saves the file instead of handing it to a viewer plugin, so
   *   the bytes are never reinterpreted as another format;
   * - the saved name is the ORIGINAL `file_name`, not the sanitised segment of
   *   `storage_path`. `safeFileName()` rewrites spaces and other characters on
   *   upload, and without this the browser named the download from the path.
   *
   * Nothing is converted. The stored object, its bytes, its extension and its
   * content type are returned exactly as uploaded.
   */
  async getDownloadUrl(document: ProjectDocument): Promise<string> {
    const { data, error } = await client()
      .storage.from(BUCKET)
      .createSignedUrl(document.storagePath, 60 * 60, {
        download: document.fileName,
      });
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
};
import type { SupabaseClient } from "@supabase/supabase-js";
