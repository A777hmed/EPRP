"use client";

import * as React from "react";
import {
  ArrowRight,
  Download,
  Eye,
  FileText,
  FileUp,
  History,
  Loader2,
  PenLine,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared";
import { PdfPreview } from "./pdf-preview";
import { formatDate } from "@/lib/formatters";
import {
  projectDocumentService,
  type EditProjectDocumentInput,
  type UploadProjectDocumentInput,
} from "@/services/project-document-service";
import { useDocumentPermissions } from "../use-document-permissions";
import type {
  ProjectDocument,
  ProjectDocumentSource,
  ProjectDocumentStatus,
  ProjectDocumentType,
} from "@/types";

const DOCUMENT_TYPES: { value: ProjectDocumentType; label: string }[] = [
  { value: "scope_of_work", label: "Official Scope of Work" },
  { value: "baseline_schedule", label: "Approved / Baseline Schedule" },
  { value: "schedule_update", label: "Schedule Revision / Update" },
  { value: "contract_purchase_order", label: "Contract / Purchase Order" },
  { value: "approved_proposal", label: "Approved Proposal" },
  { value: "organization_chart", label: "Organization Chart" },
  { value: "kickoff_mom", label: "Kick-off MOM" },
  { value: "other", label: "Other Official Reference" },
];

const DOCUMENT_STATUSES: { value: ProjectDocumentStatus; label: string }[] = [
  { value: "current", label: "Current" },
  { value: "approved", label: "Approved" },
  { value: "draft", label: "Draft" },
  { value: "superseded", label: "Superseded" },
  { value: "cancelled", label: "Cancelled" },
];

const DOCUMENT_SOURCES: { value: ProjectDocumentSource; label: string }[] = [
  { value: "client_issued", label: "Client issued" },
  { value: "internal", label: "Internal (EPROM)" },
  { value: "contractor", label: "Contractor" },
  { value: "other", label: "Other" },
];

/**
 * The four Reference Input buckets.
 *
 * Presentation only — the stored `document_type` is unchanged, and every type
 * not named here falls into Supporting Documents, so a new type can never go
 * missing from the screen.
 */
const REFERENCE_BUCKETS: {
  id: string;
  label: string;
  description: string;
  types: ProjectDocumentType[] | "rest";
}[] = [
  {
    id: "scope",
    label: "Scope of Work",
    description: "The contract scope this project is delivering against.",
    types: ["scope_of_work"],
  },
  {
    id: "baseline",
    label: "Baseline Schedule",
    description: "The approved baseline the project is measured against.",
    types: ["baseline_schedule"],
  },
  {
    id: "updates",
    label: "Schedule Updates",
    description: "Revisions and updates issued after the baseline.",
    types: ["schedule_update"],
  },
  {
    id: "supporting",
    label: "Supporting Documents",
    description: "Contract, proposal, organization chart, kick-off MOM and other controlled references.",
    types: "rest",
  },
];

/** Types claimed by a named bucket; everything else lands in Supporting. */
const NAMED_BUCKET_TYPES = new Set<ProjectDocumentType>(
  REFERENCE_BUCKETS.flatMap((bucket) =>
    bucket.types === "rest" ? [] : bucket.types
  )
);

const EMPTY_FORM: UploadProjectDocumentInput = {
  title: "",
  documentType: "scope_of_work",
  documentNumber: "",
  revision: "",
  issueDate: "",
  effectiveDate: "",
  source: "",
  status: "current",
  notes: "",
};

function typeLabel(type: ProjectDocumentType): string {
  return DOCUMENT_TYPES.find((option) => option.value === type)?.label ?? type;
}

function statusLabel(status: ProjectDocumentStatus): string {
  return DOCUMENT_STATUSES.find((option) => option.value === status)?.label ?? status;
}

function sourceLabel(source: ProjectDocumentSource | undefined): string | undefined {
  if (!source) return undefined;
  return DOCUMENT_SOURCES.find((option) => option.value === source)?.label ?? source;
}

/**
 * Whether the browser can render this file in the viewer frame.
 *
 * Decided from the ORIGINAL filename's extension, with the stored MIME only as
 * corroboration. The extension comes from the file the user actually uploaded;
 * `mime_type` is a second recording of the same fact and can disagree with it
 * — and when it wrongly claimed a renderable type, the frame loaded a viewer
 * that could not read the bytes and showed blank. Extension-first means an
 * unrecognised or wrong MIME degrades to the honest "no preview" state.
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
]);



function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function isPreviewable(document: ProjectDocument): boolean {
  return isPdf(document) || isImage(document);
}

function isPdf(document: ProjectDocument): boolean {
  const extension = fileExtension(document.fileName);
  if (extension) return extension === "pdf";
  return document.mimeType === "application/pdf";
}

function isImage(document: ProjectDocument): boolean {
  const extension = fileExtension(document.fileName);
  if (extension) return IMAGE_EXTENSIONS.has(extension);
  return document.mimeType.startsWith("image/");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium">{children}</span>;
}

export function ProjectDocumentsPanel({ projectId }: { projectId: string }) {
  const permissions = useDocumentPermissions(projectId);
  const [documents, setDocuments] = React.useState<ProjectDocument[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [form, setForm] = React.useState<UploadProjectDocumentInput>(EMPTY_FORM);
  const [file, setFile] = React.useState<File>();
  const [viewer, setViewer] = React.useState<ProjectDocument>();
  const [viewerUrl, setViewerUrl] = React.useState<string>();
  const [viewerLoading, setViewerLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setDocuments(await projectDocumentService.list(projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    let active = true;
    projectDocumentService
      .list(projectId)
      .then((rows) => {
        if (active) setDocuments(rows);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Could not load documents."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const [editing, setEditing] = React.useState<ProjectDocument>();
  const [editForm, setEditForm] = React.useState<EditProjectDocumentInput>();
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [binning, setBinning] = React.useState<ProjectDocument>();
  const [binReason, setBinReason] = React.useState("");
  const [purging, setPurging] = React.useState<ProjectDocument>();
  const [busy, setBusy] = React.useState(false);
  const [superseding, setSuperseding] = React.useState<ProjectDocument>();
  const [successorId, setSuccessorId] = React.useState("");
  const [linking, setLinking] = React.useState(false);

  /*
   * Active and binned are two separate surfaces. Deleted documents must not
   * appear in the normal list, its buckets, or the supersede picker — Trash is
   * the only place they exist.
   */
  const activeDocuments = React.useMemo(
    () => documents.filter((item) => !item.deletedAt),
    [documents]
  );
  const deletedDocuments = React.useMemo(
    () =>
      documents
        .filter((item) => item.deletedAt)
        .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "")),
    [documents]
  );

  /* Chain lookups: forward by id, and the reverse edge the row does not store. */
  const byId = React.useMemo(
    () => new Map(documents.map((item) => [item.id, item])),
    [documents]
  );
  const supersededBy = React.useMemo(() => {
    const map = new Map<string, ProjectDocument[]>();
    for (const item of documents) {
      if (!item.supersededByDocumentId) continue;
      map.set(item.supersededByDocumentId, [
        ...(map.get(item.supersededByDocumentId) ?? []),
        item,
      ]);
    }
    return map;
  }, [documents]);

  /**
   * Download the original stored file under its original name.
   *
   * A separate, explicit action — never the preview URL. `getDownloadUrl`
   * signs the object with a download disposition and the original `file_name`,
   * so the extension and bytes are exactly what was uploaded.
   *
   * "Open Original" was removed rather than renamed: in the Electron desktop
   * shell a top-level navigation to the signed URL downloads the file instead
   * of displaying it, so the two controls were the same action wearing
   * different labels. Verified at runtime before removing it.
   */
  const downloadDocument = async (document: ProjectDocument) => {
    try {
      const url = await projectDocumentService.getDownloadUrl(document);
      window.location.assign(url);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not download the file."
      );
    }
  };

  const openEdit = (document: ProjectDocument) => {
    setEditing(document);
    setEditForm({
      title: document.title,
      documentType: document.documentType,
      documentNumber: document.documentNumber ?? "",
      revision: document.revision ?? "",
      issueDate: document.issueDate ?? "",
      effectiveDate: document.effectiveDate ?? "",
      source: document.source ?? "",
      notes: document.notes ?? "",
    });
  };

  const submitEdit = async () => {
    if (!editing || !editForm) return;
    if (!editForm.title.trim()) {
      toast.error("Document title is required.");
      return;
    }
    setSavingEdit(true);
    try {
      await projectDocumentService.update(editing.id, editForm);
      toast.success("Document updated.");
      setEditing(undefined);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Update failed.");
    } finally {
      setSavingEdit(false);
    }
  };

  const submitBin = async () => {
    if (!binning) return;
    if (!binReason.trim()) {
      toast.error("A reason is required to delete a document.");
      return;
    }
    setBusy(true);
    try {
      await projectDocumentService.softDelete(binning.id, binReason);
      toast.success("Moved to Deleted Documents.");
      setBinning(undefined);
      setBinReason("");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const restoreDocument = async (document: ProjectDocument) => {
    setBusy(true);
    try {
      await projectDocumentService.restore(document.id);
      toast.success(`"${document.title}" restored.`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitPurge = async () => {
    if (!purging) return;
    setBusy(true);
    try {
      await projectDocumentService.deletePermanently(purging, documents);
      toast.success("Document permanently deleted and revision chain repaired.");
      setPurging(undefined);
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Permanent delete failed."
      );
    } finally {
      setBusy(false);
    }
  };

  const submitSupersede = async () => {
    if (!superseding || !successorId) return;
    setLinking(true);
    try {
      await projectDocumentService.supersede(superseding.id, successorId);
      toast.success("Supersession recorded.");
      setSuperseding(undefined);
      setSuccessorId("");
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not record the supersession."
      );
    } finally {
      setLinking(false);
    }
  };

  const patchForm = <K extends keyof UploadProjectDocumentInput>(
    key: K,
    value: UploadProjectDocumentInput[K]
  ) => setForm((current) => ({ ...current, [key]: value }));

  const submitUpload = async () => {
    if (!form.title.trim()) {
      toast.error("Document title is required.");
      return;
    }
    if (!file) {
      toast.error("Select a file to upload.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("The maximum file size is 25 MB.");
      return;
    }

    setUploading(true);
    try {
      await projectDocumentService.upload(projectId, form, file);
      toast.success("Project reference document uploaded.");
      setUploadOpen(false);
      setForm(EMPTY_FORM);
      setFile(undefined);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const openViewer = async (document: ProjectDocument) => {
    setViewer(document);
    setViewerUrl(undefined);
    setViewerLoading(true);
    try {
      /*
       * The preview URL is INLINE and is only ever consumed in-app — by the
       * PDF.js canvas renderer or an <img>. Download is a separate, explicit
       * action with its own signed URL.
       */
      // Only sign a preview URL for something we can actually render; a DOCX
      // needs no URL until the user asks to download it.
      if (isPreviewable(document)) {
        setViewerUrl(await projectDocumentService.getViewUrl(document));
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not open document.");
    } finally {
      setViewerLoading(false);
    }
  };

  const changeStatus = async (
    document: ProjectDocument,
    status: ProjectDocumentStatus
  ) => {
    try {
      const updated = await projectDocumentService.setStatus(document.id, status);
      setDocuments((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      toast.success(`Document marked ${statusLabel(status).toLowerCase()}.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Status update failed.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading project reference documents…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Controlled project references are retained by revision; superseded files are not deleted.
        </p>
        <Button type="button" onClick={() => setUploadOpen(true)}>
          <FileUp aria-hidden="true" />
          Upload Document
        </Button>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No project reference documents yet"
          description="Upload the official scope, baseline schedule, a schedule revision, the contract, approved proposal, organization chart, kick-off MOM, or another controlled reference."
          className="py-8"
        />
      ) : (
        <div className="space-y-6">
          {REFERENCE_BUCKETS.map((bucket) => {
            const rows = activeDocuments.filter((item) =>
              bucket.types === "rest"
                ? !NAMED_BUCKET_TYPES.has(item.documentType)
                : bucket.types.includes(item.documentType)
            );
            return (
              <section key={bucket.id}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{bucket.label}</h3>
                    <p className="text-xs text-muted-foreground">{bucket.description}</p>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {rows.length} {rows.length === 1 ? "document" : "documents"}
                  </span>
                </div>
                {rows.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    Nothing filed under {bucket.label.toLowerCase()} yet.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {rows.map((document) => {
                      const successor = document.supersededByDocumentId
                        ? byId.get(document.supersededByDocumentId)
                        : undefined;
                      const predecessors = supersededBy.get(document.id) ?? [];
                      const linked = Boolean(document.supersededByDocumentId);
                      return (
                        <li key={document.id} className="rounded-xl border p-4">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium">{document.title}</p>
                                <span className="rounded-full border bg-muted px-2 py-0.5 text-[11px] font-medium">
                                  {statusLabel(document.status)}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {typeLabel(document.documentType)}
                                {document.documentNumber ? ` · ${document.documentNumber}` : ""}
                                {document.revision ? ` · Rev. ${document.revision}` : ""}
                                {document.issueDate ? ` · Issued ${formatDate(document.issueDate)}` : ""}
                                {document.effectiveDate ? ` · Effective ${formatDate(document.effectiveDate)}` : ""}
                                {sourceLabel(document.source) ? ` · ${sourceLabel(document.source)}` : ""}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {document.fileName} · {formatBytes(document.fileSize)} · Uploaded by {document.uploadedByName ?? "authorized project user"}
                              </p>

                              {/* The revision chain, shown from both ends so a
                                  document is never silently the outdated one. */}
                              {successor && (
                                <p className="flex items-center gap-1.5 pt-1 text-xs text-warning">
                                  <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
                                  Superseded by {successor.title}
                                  {successor.revision ? ` (Rev. ${successor.revision})` : ""}
                                </p>
                              )}
                              {predecessors.length > 0 && (
                                <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                                  <ArrowRight className="size-3.5 shrink-0 rotate-180" aria-hidden="true" />
                                  Supersedes {predecessors.map((item) => item.title).join(", ")}
                                </p>
                              )}
                              {document.notes && <p className="pt-1 text-sm">{document.notes}</p>}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <Select
                                value={document.status}
                                disabled={linked || !permissions.canEdit}
                                onValueChange={(value) =>
                                  void changeStatus(document, value as ProjectDocumentStatus)
                                }
                              >
                                <SelectTrigger
                                  className="w-36"
                                  aria-label={`Status for ${document.title}`}
                                  title={
                                    linked
                                      ? "This document points at a successor, so its status is fixed at Superseded."
                                      : undefined
                                  }
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DOCUMENT_STATUSES.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {permissions.canEdit && !linked && activeDocuments.length > 1 && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSuperseding(document)}
                                >
                                  <History aria-hidden="true" />
                                  Supersede
                                </Button>
                              )}
                              <Button type="button" variant="outline" size="sm" onClick={() => void openViewer(document)}>
                                <Eye aria-hidden="true" />
                                View Document
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void downloadDocument(document)}
                              >
                                <Download aria-hidden="true" />
                                Download
                              </Button>
                              {permissions.canEdit && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openEdit(document)}
                                >
                                  <PenLine aria-hidden="true" />
                                  Edit
                                </Button>
                              )}
                              {permissions.canBin && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Delete ${document.title}`}
                                  onClick={() => {
                                    setBinning(document);
                                    setBinReason("");
                                  }}
                                >
                                  <Trash2 aria-hidden="true" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {deletedDocuments.length > 0 && (
        <section className="rounded-xl border border-dashed p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Trash2 className="size-4 text-muted-foreground" aria-hidden="true" />
                Deleted Documents
              </h3>
              <p className="text-xs text-muted-foreground">
                Retained in full. Deleted documents do not appear in the lists above,
                in reports, or in any picker.
              </p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {deletedDocuments.length} deleted
            </span>
          </div>

          <ul className="space-y-3">
            {deletedDocuments.map((document) => {
              const check = projectDocumentService.assessPermanentDelete(
                document,
                documents
              );
              return (
                <li key={document.id} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{document.title}</p>
                        <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          Deleted
                        </span>
                        {/* The original status survives the delete, so a binned
                            superseded document still reads as superseded. */}
                        <span className="rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium">
                          {statusLabel(document.status)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {typeLabel(document.documentType)}
                        {document.revision ? ` · Rev. ${document.revision}` : ""}
                        {" · "}
                        {document.fileName} · {formatBytes(document.fileSize)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Uploaded by {document.uploadedByName ?? "authorized project user"}
                      </p>
                      <p className="text-xs text-destructive">
                        Deleted by {document.deletedByName ?? "unknown"}
                        {document.deletedAt ? ` on ${formatDate(document.deletedAt)}` : ""}
                        {document.deleteReason ? ` — ${document.deleteReason}` : ""}
                      </p>
                      {permissions.canPurge && !check.allowed && (
                        <p className="flex items-start gap-1.5 pt-1 text-xs text-destructive">
                          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            Blocked from permanent deletion: {check.blockedBy.join(" ")}
                          </span>
                        </p>
                      )}
                      {permissions.canPurge && check.allowed && check.repairs.length > 0 && (
                        <p className="flex items-start gap-1.5 pt-1 text-xs text-warning">
                          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            In a revision chain — permanent deletion will repair{" "}
                            {check.repairs.length === 1 ? "1 relationship" : `${check.repairs.length} relationships`}.
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {permissions.canBin && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void restoreDocument(document)}
                        >
                          <RotateCcw aria-hidden="true" />
                          Restore
                        </Button>
                      )}
                      {permissions.canPurge && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || !check.allowed}
                          title={check.allowed ? undefined : check.blockedBy.join(" ")}
                          onClick={() => setPurging(document)}
                        >
                          <Trash2 aria-hidden="true" />
                          Delete Permanently
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {editing?.title}</DialogTitle>
            <DialogDescription>
              Metadata only. The uploaded file is never replaced — upload a new
              revision and supersede this one instead.
            </DialogDescription>
          </DialogHeader>
          {editForm && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 sm:col-span-2">
                <FieldLabel>Title *</FieldLabel>
                <Input
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Document Type *</FieldLabel>
                <Select
                  value={editForm.documentType}
                  onValueChange={(v) =>
                    setEditForm({ ...editForm, documentType: v as ProjectDocumentType })
                  }
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Source</FieldLabel>
                <Select
                  value={editForm.source === "" || editForm.source === undefined ? "unset" : editForm.source}
                  onValueChange={(v) =>
                    setEditForm({ ...editForm, source: v === "unset" ? "" : (v as ProjectDocumentSource) })
                  }
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not recorded</SelectItem>
                    {DOCUMENT_SOURCES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Document / Reference No.</FieldLabel>
                <Input
                  value={editForm.documentNumber ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, documentNumber: e.target.value })}
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Revision</FieldLabel>
                <Input
                  value={editForm.revision ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, revision: e.target.value })}
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Issue Date</FieldLabel>
                <Input
                  type="date"
                  value={editForm.issueDate ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, issueDate: e.target.value })}
                />
              </label>
              <label className="space-y-1.5">
                <FieldLabel>Effective Date</FieldLabel>
                <Input
                  type="date"
                  value={editForm.effectiveDate ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, effectiveDate: e.target.value })}
                />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <FieldLabel>Notes</FieldLabel>
                <Textarea
                  rows={3}
                  value={editForm.notes ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                File: {editing?.fileName} — not editable. Status and revision links
                are changed with their own controls.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={() => void submitEdit()} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PenLine aria-hidden="true" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(binning)} onOpenChange={(open) => !open && setBinning(undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete {binning?.title}?</DialogTitle>
            <DialogDescription>
              It moves to Deleted Documents. The file and every field are kept, and
              an authorized user can restore it. Nothing is destroyed here.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1.5">
            <FieldLabel>Reason *</FieldLabel>
            <Textarea
              rows={3}
              value={binReason}
              onChange={(e) => setBinReason(e.target.value)}
              placeholder="e.g. Uploaded to the wrong project"
            />
            <span className="block text-xs text-muted-foreground">
              Recorded against the document permanently.
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBinning(undefined)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitBin()}
              disabled={busy || !binReason.trim()}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Move to Deleted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(purging)}
        onOpenChange={(open) => !open && setPurging(undefined)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Are you sure you want to permanently delete this document?
            </DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>

          {purging && (() => {
            const check = projectDocumentService.assessPermanentDelete(purging, documents);
            return (
              <div className="space-y-3">
                {/* The title is generic, so the document has to be named here —
                    the admin must be able to see WHICH file this is. */}
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium text-destructive">{purging.title}</p>
                  <p className="text-muted-foreground">
                    {purging.fileName} · {formatBytes(purging.fileSize)}
                  </p>
                  <p className="text-muted-foreground">
                    Deleted by {purging.deletedByName ?? "unknown"}
                    {purging.deleteReason ? ` — ${purging.deleteReason}` : ""}
                  </p>
                </div>

                {/* Chain impact is disclosed as a consequence, not a refusal. */}
                {check.repairs.length > 0 && (
                  <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                      <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                      This document is part of a revision chain
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Permanent deletion will remove it and repair the affected
                      revision relationships:
                    </p>
                    <ul className="mt-2 space-y-1">
                      {check.repairs.map((repair) => (
                        <li key={repair} className="flex items-start gap-1.5 text-sm">
                          <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
                          <span>{repair}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      No other document is deleted.
                    </p>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Controlled references checked: evidence, deliverables, milestones,
                  reports and retained history — none found.
                </p>
              </div>
            );
          })()}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPurging(undefined)}
              disabled={busy}
            >
              No, Keep Document
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitPurge()}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Yes, Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(superseding)} onOpenChange={(open) => !open && setSuperseding(undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Supersede {superseding?.title}</DialogTitle>
            <DialogDescription>
              Choose the document that replaced it. The original is retained and marked
              superseded — nothing is deleted, and the link is recorded on both.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1.5">
            <FieldLabel>Replaced by *</FieldLabel>
            <Select value={successorId} onValueChange={setSuccessorId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select the replacement document…" />
              </SelectTrigger>
              <SelectContent>
                {activeDocuments
                  .filter((item) => item.id !== superseding?.id)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                      {item.revision ? ` · Rev. ${item.revision}` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSuperseding(undefined)} disabled={linking}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitSupersede()} disabled={linking || !successorId}>
              {linking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <History aria-hidden="true" />}
              Record Supersession
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload Project Reference Document</DialogTitle>
            <DialogDescription>
              Each upload creates a separate traceable revision. Existing revisions are retained.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 sm:col-span-2">
              <FieldLabel>Title *</FieldLabel>
              <Input value={form.title} onChange={(event) => patchForm("title", event.target.value)} placeholder="e.g. Project Scope of Work" />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Document Type *</FieldLabel>
              <Select value={form.documentType} onValueChange={(value) => patchForm("documentType", value as ProjectDocumentType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Status *</FieldLabel>
              <Select value={form.status} onValueChange={(value) => patchForm("status", value as ProjectDocumentStatus)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_STATUSES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Document / Reference No.</FieldLabel>
              <Input value={form.documentNumber ?? ""} onChange={(event) => patchForm("documentNumber", event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Revision</FieldLabel>
              <Input value={form.revision ?? ""} onChange={(event) => patchForm("revision", event.target.value)} placeholder="e.g. 01" />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Issue Date</FieldLabel>
              <Input type="date" value={form.issueDate ?? ""} onChange={(event) => patchForm("issueDate", event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Effective Date</FieldLabel>
              <Input type="date" value={form.effectiveDate ?? ""} onChange={(event) => patchForm("effectiveDate", event.target.value)} />
              <span className="block text-xs text-muted-foreground">When it takes effect, if that differs from the issue date.</span>
            </label>
            <label className="space-y-1.5">
              <FieldLabel>Source</FieldLabel>
              <Select
                value={form.source === "" || form.source === undefined ? "unset" : form.source}
                onValueChange={(value) =>
                  patchForm("source", value === "unset" ? "" : (value as ProjectDocumentSource))
                }
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not recorded</SelectItem>
                  {DOCUMENT_SOURCES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="block text-xs text-muted-foreground">Who issued it — not who uploaded it.</span>
            </label>
            <label className="space-y-1.5">
              <FieldLabel>File *</FieldLabel>
              <Input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg"
                onChange={(event) => setFile(event.target.files?.[0])}
              />
              <span className="block text-xs text-muted-foreground">PDF, Office, PNG or JPEG · maximum 25 MB</span>
            </label>
            <label className="space-y-1.5 sm:col-span-2">
              <FieldLabel>Notes</FieldLabel>
              <Textarea rows={3} value={form.notes ?? ""} onChange={(event) => patchForm("notes", event.target.value)} />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
            <Button type="button" onClick={() => void submitUpload()} disabled={uploading}>
              {uploading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileUp aria-hidden="true" />}
              Upload Revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewer)} onOpenChange={(open) => !open && setViewer(undefined)}>
        {/* `flex flex-col` is load-bearing: DialogContent is a `grid` by
            default, and `flex-1` on the frame wrapper below is inert on a grid
            item. Without it the wrapper is content-sized, the iframe's
            `h-full` resolves against nothing, and the preview collapses to a
            dark strip. */}
        <DialogContent className="flex h-[90vh] flex-col sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{viewer?.title ?? "Document Viewer"}</DialogTitle>
            <DialogDescription>
              {viewer
                ? `${typeLabel(viewer.documentType)}${viewer.revision ? ` · Rev. ${viewer.revision}` : ""} · ${viewer.fileName}`
                : "Project document"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
            {/* min-h-0 lets this shrink inside the flex column; without it the
                frame would push the dialog past 90vh. */}
            {viewerLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Preparing secure viewer…
              </div>
            ) : viewer && viewerUrl && isPdf(viewer) ? (
              /* Rendered in-app, not by a browser plugin — see PdfPreview. */
              <PdfPreview
                url={viewerUrl}
                title={viewer.title}
                onDownload={() => void downloadDocument(viewer)}
              />
            ) : viewer && viewerUrl && isImage(viewer) ? (
              <div className="h-full overflow-auto p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed,
                    short-lived storage URL; next/image cannot optimise it. */}
                <img
                  src={viewerUrl}
                  alt={viewer.title}
                  className="mx-auto max-w-full rounded-sm bg-white"
                />
              </div>
            ) : (
              /* Never an empty frame: a format the browser cannot render says so
                 and offers the file, rather than loading a viewer that shows
                 nothing. */
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <FileText className="size-8 text-muted-foreground" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Preview not available</p>
                  <p className="text-sm text-muted-foreground">
                    {viewer
                      ? `${fileExtension(viewer.fileName).toUpperCase() || "This"} files cannot be displayed here. Download the file to open it in the application it belongs to.`
                      : "This format cannot be displayed here."}
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            {viewer && (
              <Button onClick={() => void downloadDocument(viewer)}>
                <Download aria-hidden="true" />
                Download
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
