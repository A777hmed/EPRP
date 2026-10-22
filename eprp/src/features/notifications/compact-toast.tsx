"use client";

import { toast } from "sonner";

import type { NotificationToastTone } from "./model";
import { ToastIcon } from "./toast-bell";
import { TOAST_DURATION_MS, TOAST_POSITION } from "./toast-feed";

/** An in-page confirmation is read at once; it leaves sooner than an arrival. */
export const CONFIRMATION_TOAST_DURATION_MS = 6_000;

/**
 * The ONE compact toast (13.11 UAT): a short title, one context line, an
 * optional action, and a status icon aligned with the title. Used by the
 * notification feed and by every in-page Project Setup amendment action, so
 * they look and behave the same. Sonner supplies the short slide / fade on
 * arrival and drops it under `prefers-reduced-motion`.
 */
export function showCompactToast(input: {
  id?: string;
  title: string;
  context: string;
  tone: NotificationToastTone;
  action?: { label: string; onClick: () => void };
  duration?: number;
}): void {
  toast(input.title, {
    id: input.id,
    description: input.context,
    icon: <ToastIcon tone={input.tone} />,
    position: TOAST_POSITION,
    duration: input.duration ?? TOAST_DURATION_MS,
    closeButton: true,
    action: input.action,
  });
}
