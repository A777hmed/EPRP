"use client";

import * as React from "react";
import { BellRing } from "lucide-react";
import { ringWhenShown } from "./toast-bell-start";

/**
 * The attention icon on an amendment toast (13.9B UAT polish). Once the toast
 * is visibly on screen the amber bell rings with a soft glow and ripple: 3
 * finite pulses, about 2.4 s in total (see `.notif-toast-bell` in
 * globals.css), then it stays static until the toast goes. The ring starts on
 * visible mount, never while the toast is still being created or hidden (see
 * toast-bell-start.ts). With reduced motion it is simply static. No sound, no
 * blinking toast.
 */
export function ToastBell() {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => (ref.current ? ringWhenShown(ref.current) : undefined), []);
  return (
    <span ref={ref} className="notif-toast-bell" aria-hidden="true" data-testid="notification-toast-bell">
      <span className="notif-toast-bell__ripple" />
      <BellRing className="notif-toast-bell__icon" />
    </span>
  );
}
