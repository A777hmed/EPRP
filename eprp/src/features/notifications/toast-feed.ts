import type { NotificationItem } from "./model";

/**
 * In-app toasts over the EXISTING notification system (13.9B UAT polish).
 *
 * The bell stays the permanent source and history; a toast is only a compact,
 * transient heads-up for a notification that becomes visible while the user is
 * already using EPRP. Pure and framework-free: the provider feeds it each
 * foreground refresh and shows what it returns.
 */

/** At most this many toasts per refresh; the rest are summarised in one. */
export const MAX_TOASTS_PER_REFRESH = 3;
/** Auto-dismiss after about 12 s; the user can also close it. */
export const TOAST_DURATION_MS = 12_000;
/** Top-centre, below the main header; the placement CSS is in globals.css. */
export const TOAST_POSITION = "top-center" as const;

export interface ToastResult {
  show: NotificationItem[];
  overflow: number;
}

export interface ToastGate {
  /**
   * Feed one foreground refresh: the caller's unread notifications.
   *
   * The FIRST call only records what is already there (the backlog at sign-in)
   * as handled; it never toasts. After that, every new toastable unread
   * notification becomes PENDING. With `present` (the window has focus) the
   * pending ones are returned to show, oldest first, capped, and from then on
   * count as toasted. Without it (visible but unfocused, e.g. the other
   * browser in a two-person UAT) they simply stay pending: nothing is consumed.
   *
   * A pending notification that is read (it leaves the unread list) before it
   * could be shown is dropped: a read notification is never toasted.
   */
  observe(unread: readonly NotificationItem[], options?: { present?: boolean }): ToastResult;
  /**
   * Show what is pending now, without waiting for a refresh. The provider
   * calls it when the window gains focus, so an arrival that waited while the
   * window was unfocused appears at once.
   */
  flush(): ToastResult;
}

/** A notification dated before the session began is backlog, never a toast. */
const BACKLOG_GRACE_MS = 60_000;

/**
 * The baseline is defined by TIME, not by "whatever the first successful
 * refresh returned": a refresh can fail or be cut short (slow REST, the 8 s
 * client timeout) and the window can then be hidden, so the first successful
 * refresh may come minutes later and already contain new arrivals. At the
 * baseline, only notifications created no later than this margin after the
 * session started count as backlog; anything newer is a fresh arrival. The
 * margin absorbs a database clock running slightly ahead of the browser's, so
 * a reload never replays what was already there.
 */
export const BASELINE_CLOCK_MARGIN_MS = 10_000;

/**
 * What one browser TAB remembers between page loads (13.12 UAT): when it last
 * looked at the caller's unread notifications, and which it already handled.
 * A reload, or a tab the browser discarded while idle and restores, is the
 * same tab: what arrived while it was away still toasts once on its return,
 * and nothing it already showed or counted as backlog is replayed. A new tab
 * or a fresh sign-in has no memory, so its backlog never toasts (as before).
 */
export interface ToastGateMemory {
  load(): RememberedToastState | null;
  save(state: RememberedToastState): void;
}
export interface RememberedToastState {
  /** The last observation, browser time; never later than the oldest still-pending arrival. */
  seenUntil: number;
  /** The most recent handled ids (bounded). */
  handled: string[];
}
/** A tab idle longer than this starts afresh: its backlog is not replayed. */
export const TOAST_MEMORY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** How many handled ids a tab remembers. */
export const TOAST_MEMORY_MAX_IDS = 200;

/** One state transition, for the development trace: baseline → discovered → (deferred) → presented, or dropped/skipped. */
export type ToastGateStage = "baseline" | "discovered" | "deferred" | "presented" | "dropped" | "skipped";
export type ToastGateTrace = (stage: ToastGateStage, ids: readonly string[]) => void;

/**
 * One gate per signed-in app session. Every id ends in exactly one place:
 * `handled` (backlog, not toastable, read before display, or toasted; it never
 * toasts again) or `pending` (waiting for a focused moment). So an id toasts at
 * most once, and an arrival is consumed only by actually being shown.
 */
export function createToastGate(now: () => number = Date.now, trace?: ToastGateTrace, memory?: ToastGateMemory): ToastGate {
  const handled = new Set<string>();
  const pending = new Map<string, NotificationItem>();
  const sessionStart = now();
  // A remembered tab baselines from when it last looked (less the clock
  // margin; what it saw then is in `handled`), otherwise from this page load.
  const remembered = memory?.load() ?? null;
  const resumed = remembered !== null && sessionStart - remembered.seenUntil <= TOAST_MEMORY_MAX_AGE_MS;
  if (resumed) for (const id of remembered.handled) handled.add(id);
  const baselineFrom = resumed ? remembered.seenUntil - BASELINE_CLOCK_MARGIN_MS : sessionStart + BASELINE_CLOCK_MARGIN_MS;
  const notBefore = Math.min(sessionStart - BACKLOG_GRACE_MS, baselineFrom);
  let baselined = false;
  const remember = () => {
    if (!memory) return;
    const oldestPending = Math.min(...[...pending.values()].map((item) => Date.parse(item.createdAt)).filter(Number.isFinite));
    memory.save({ seenUntil: Math.min(now(), oldestPending), handled: [...handled].slice(-TOAST_MEMORY_MAX_IDS) });
  };
  const note = (stage: ToastGateStage, ids: string[]) => {
    if (ids.length) trace?.(stage, ids);
  };

  const take = (): ToastResult => {
    const ordered = [...pending.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    pending.clear();
    for (const item of ordered) handled.add(item.id);
    note("presented", ordered.map((item) => item.id));
    remember();
    return { show: ordered.slice(0, MAX_TOASTS_PER_REFRESH), overflow: Math.max(0, ordered.length - MAX_TOASTS_PER_REFRESH) };
  };
  const toastable = (item: NotificationItem, from: number) => Boolean(item.toast) && !item.readAt && Date.parse(item.createdAt) >= from;

  return {
    observe(unread, { present = true } = {}) {
      const discovered: string[] = [];
      const skipped: string[] = [];
      if (!baselined) {
        // The sign-in backlog is recorded whether or not the window has focus;
        // only what was created after the session started is a fresh arrival.
        baselined = true;
        const backlog: string[] = [];
        for (const item of unread) {
          if (handled.has(item.id)) continue;
          if (toastable(item, baselineFrom)) {
            pending.set(item.id, item);
            discovered.push(item.id);
          } else {
            handled.add(item.id);
            backlog.push(item.id);
          }
        }
        note("baseline", backlog);
      } else {
        // Read (or otherwise gone) before it could be shown: never toasted.
        const stillUnread = new Set(unread.map((item) => item.id));
        const dropped: string[] = [];
        for (const id of [...pending.keys()]) {
          if (!stillUnread.has(id)) {
            pending.delete(id);
            handled.add(id);
            dropped.push(id);
          }
        }
        note("dropped", dropped);
        for (const item of unread) {
          if (handled.has(item.id) || pending.has(item.id)) continue;
          // Only notifications that carry toast wording, unread and dated in this session, are toasted.
          if (toastable(item, notBefore)) {
            pending.set(item.id, item);
            discovered.push(item.id);
          } else {
            handled.add(item.id);
            skipped.push(item.id);
          }
        }
      }
      note("discovered", discovered);
      note("skipped", skipped);
      if (present) return take();
      note("deferred", [...pending.keys()]);
      remember();
      return { show: [], overflow: 0 };
    },
    flush: take,
  };
}
