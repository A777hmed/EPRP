"use client";

import * as React from "react";
import { BellRing, Check, Clock, Info, X } from "lucide-react";
import type { NotificationToastTone } from "./model";
import { ringWhenShown } from "./toast-bell-start";

const TONE_ICON: Record<NotificationToastTone, typeof BellRing> = {
  approval: BellRing,
  approved: Check,
  rejected: X,
  pending: Clock,
  notice: Info,
};

/**
 * The status icon on a notification toast (13.9B UAT polish; 13.11 UAT: one
 * icon per status). A bell when an approval waits on the reader, a check for
 * an approval, an x for a rejection. Once the toast is visibly on screen the
 * icon plays ONE short arrival cue — the bell rings once with a ripple, the
 * others pop in with a soft glow (see `.notif-toast-bell` in globals.css) —
 * then stays static. The cue starts on visible mount, never while the toast is
 * still being created or hidden (toast-bell-start.ts). With reduced motion it
 * is simply static. No sound, no blinking toast.
 */
export function ToastIcon({ tone }: { tone: NotificationToastTone }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => (ref.current ? ringWhenShown(ref.current) : undefined), []);
  const Icon = TONE_ICON[tone];
  return (
    <span ref={ref} className="notif-toast-bell" data-tone={tone} aria-hidden="true" data-testid="notification-toast-bell">
      <span className="notif-toast-bell__ripple" />
      <Icon className="notif-toast-bell__icon" />
    </span>
  );
}

/** The approval bell — the icon of an approval request and of the overflow summary. */
export function ToastBell() {
  return <ToastIcon tone="approval" />;
}
