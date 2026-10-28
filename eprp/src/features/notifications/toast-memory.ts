import type { RememberedToastState, ToastGateMemory } from "./toast-feed";

/**
 * The toast gate's per-tab memory (13.12 UAT), in `sessionStorage`: it lives
 * as long as the browser tab — across reloads and a tab the browser discarded
 * and restored — and is never shared with another tab or person. Keyed by the
 * signed-in user, so another account in the same tab starts afresh. Storage
 * that is missing or refuses (private mode, quota) simply means no memory:
 * the gate then behaves as on a first visit.
 */

type TabStorage = Pick<Storage, "getItem" | "setItem">;

const KEY_PREFIX = "eprp:notification-toasts:";

function browserSessionStorage(): TabStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isRemembered(value: unknown): value is RememberedToastState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<RememberedToastState>;
  return typeof state.seenUntil === "number" && Number.isFinite(state.seenUntil)
    && Array.isArray(state.handled) && state.handled.every((id) => typeof id === "string");
}

export function tabToastMemory(viewerId: string | null, storage: TabStorage | null = browserSessionStorage()): ToastGateMemory | undefined {
  if (!viewerId || !storage) return undefined;
  const key = `${KEY_PREFIX}${viewerId}`;
  return {
    load() {
      try {
        const raw = storage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return isRemembered(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        storage.setItem(key, JSON.stringify(state));
      } catch {
        // No memory this time; the next page load behaves as a first visit.
      }
    },
  };
}
