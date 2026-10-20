/**
 * When the toast bell starts ringing (13.9B UAT).
 *
 * A CSS animation starts when its element is created. A Sonner toast is
 * created invisible (opacity 0, `data-mounted="false"`), mounts a frame later
 * and slides in; and the first toast after a page load can block the main
 * thread for a second or more while styles are computed. An animation started
 * at creation could therefore run — and finish — before the toast was ever
 * painted, so the user saw a static bell. The bell is marked `data-ringing`
 * only once its toast is mounted, the page is visible, and two frames have
 * been painted since; the CSS animates only a ringing bell. Pure: the browser
 * is injected so the timing is testable.
 */

export interface BellStartEnvironment {
  isVisible(): boolean;
  onVisibilityChange(listener: () => void): () => void;
  /** Calls `listener` whenever the toast's attributes change. */
  observeAttributes(target: BellToastElement, listener: () => void): () => void;
  nextFrame(callback: () => void): () => void;
}

export interface BellToastElement {
  getAttribute(name: string): string | null;
}

export interface BellElement {
  closest(selector: string): BellToastElement | null;
  setAttribute(name: string, value: string): void;
}

export const browserBellEnvironment: BellStartEnvironment = {
  isVisible: () => document.visibilityState === "visible",
  onVisibilityChange(listener) {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
  observeAttributes(target, listener) {
    const observer = new MutationObserver(listener);
    observer.observe(target as unknown as Node, { attributes: true, attributeFilter: ["data-mounted"] });
    return () => observer.disconnect();
  },
  nextFrame(callback) {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  },
};

/** Marks `bell` as ringing once its toast is visibly mounted; returns a cleanup. Rings at most once. */
export function ringWhenShown(bell: BellElement, environment: BellStartEnvironment = browserBellEnvironment): () => void {
  const toast = bell.closest("[data-sonner-toast]");
  const shown = () => environment.isVisible() && (!toast || toast.getAttribute("data-mounted") === "true");
  const cleanups: (() => void)[] = [];
  let scheduled = false;
  const cleanup = () => {
    for (const stop of cleanups.splice(0)) stop();
  };
  const check = () => {
    if (scheduled || !shown()) return;
    scheduled = true;
    // Two frames: the mounted toast has been painted, and any first-paint style work is behind us.
    cleanups.push(environment.nextFrame(() => {
      cleanups.push(environment.nextFrame(() => {
        bell.setAttribute("data-ringing", "true");
      }));
    }));
  };
  cleanups.push(environment.onVisibilityChange(check));
  if (toast) cleanups.push(environment.observeAttributes(toast, check));
  check();
  return cleanup;
}
