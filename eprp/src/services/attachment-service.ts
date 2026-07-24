import type { Attachment } from "@/types";
import { notImplemented } from "./not-implemented";

/** File attachments for reports, submissions, and comments. */
export interface AttachmentService {
  listForEntity(entityId: string): Promise<Attachment[]>;
  upload(file: File, entityId: string): Promise<Attachment>;
  remove(attachmentId: string): Promise<void>;
  getDownloadUrl(attachmentId: string): Promise<string>;
}

export const attachmentService: AttachmentService = {
  listForEntity: notImplemented("attachmentService.listForEntity"),
  upload: notImplemented("attachmentService.upload"),
  remove: notImplemented("attachmentService.remove"),
  getDownloadUrl: notImplemented("attachmentService.getDownloadUrl"),
};
