"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createDefaultNotificationService } from "@/services/setup-notification-service";
import { startForegroundPoll } from "./foreground-poll";
import { ToastBell } from "./toast-bell";
import { createToastGate, TOAST_DURATION_MS, TOAST_POSITION, type ToastGate, type ToastGateTrace, type ToastResult } from "./toast-feed";
import { createNotificationAdapter, developmentNotifications, notificationHref, type NotificationOverview, type NotificationPage, type NotificationPreferences, type NotificationQuery, type NotificationService } from "./model";

interface NotificationContextValue {
  overview: NotificationOverview | null;
  service: NotificationService;
  loading: boolean;
  busy: boolean;
  error: string | null;
  revision: number;
  refresh(): Promise<boolean>;
  setRead(id: string, read: boolean): Promise<boolean>;
  markAllRead(): Promise<boolean>;
  /** Hides the caller's resolved and informational notifications; action-required ones stay. */
  clearHistory(): Promise<boolean>;
  savePreferences(value: NotificationPreferences): Promise<boolean>;
  setDevelopment(enabled: boolean): void;
  simulateReadFailure(): void;
  /** Development only: one sample toast through the real toast renderer (renderer check). */
  showTestToast(): void;
}
const NotificationContext = React.createContext<NotificationContextValue | null>(null);
const message = (error: unknown) => error instanceof Error ? error.message : "Notifications could not be loaded. Try again.";
const DEVELOPMENT = process.env.NODE_ENV === "development";
/** Development only: each toast-gate transition, so a missing toast can be traced in the console. */
const traceToastGate: ToastGateTrace = (stage, ids) => console.info(`[EPRP toasts] ${stage}`, ids);
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [service, setService] = React.useState<NotificationService>(() => createDefaultNotificationService());
  const [overview, setOverview] = React.useState<NotificationOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const router = useRouter();
  const epoch = React.useRef(0);
  const overviewRef = React.useRef<NotificationOverview | null>(null);
  const mutating = React.useRef(false);
  const failNextRead = React.useRef(false);
  const toastGate = React.useRef<ToastGate | null>(null);
  const refresh = React.useCallback(async () => {
    const request = ++epoch.current;
    setLoading(true); setError(null);
    try {
      if (failNextRead.current) { failNextRead.current = false; throw new Error("Development preview: simulated connection failure. Retry to recover."); }
      const next = await service.getOverview();
      if (request !== epoch.current) return false;
      setOverview(next); setRevision((value) => value + 1); return true;
    } catch (failure) { if (request === epoch.current) setError(message(failure)); return false; }
    finally { if (request === epoch.current) setLoading(false); }
  }, [service]);
  React.useEffect(() => {
    // Defer to the same async refresh used by retries; cancel obsolete adapter reads.
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => { clearTimeout(timer); };
  }, [refresh]);
  React.useEffect(() => {
    overviewRef.current = overview;
  }, [overview]);

  /*
   * In-app toasts (13.9B UAT polish) for a notification that becomes visible
   * while the app is open. Connected service only. Foreground refresh: now,
   * when the tab regains focus, and ~30 s while it is visible — nothing while
   * hidden. The first pass only records the existing backlog, so signing in
   * never replays unread items as toasts; each id toasts at most once.
   *
   * A new arrival stays PENDING in the gate until the window has focus: a
   * visible-but-unfocused window (another browser, or DevTools focused) never
   * consumes it, and gaining focus shows it at once, without waiting for a
   * refresh (a focus refresh can be skipped while another is in flight).
   */
  const showToasts = React.useCallback(({ show, overflow }: ToastResult) => {
      if (DEVELOPMENT && (show.length || overflow)) console.info("[EPRP toasts] toast() called", show.map((item) => item.id), { overflow });
      for (const item of show) {
        const href = item.projectId === item.target.projectId ? notificationHref(item.target) : null;
        toast(item.toast!.title, {
          id: `notification:${item.id}`,
          description: item.toast!.description,
          icon: <ToastBell />,
          position: TOAST_POSITION,
          duration: TOAST_DURATION_MS,
          closeButton: true,
          action: href
            ? {
                label: item.toast!.actionLabel,
                onClick: () => {
                  // The same behaviour as the bell item: read, then open.
                  void service.setRead(item.id, true).catch(() => undefined).then(() => {
                    void refresh();
                    router.push(href);
                  });
                },
              }
            : undefined,
        });
      }
      if (overflow > 0) {
        toast(`${overflow} more Project Setup notification${overflow === 1 ? "" : "s"}`, {
          id: "notification:overflow",
          description: "Open the bell to see them.",
          icon: <ToastBell />,
          position: TOAST_POSITION,
          duration: TOAST_DURATION_MS,
          closeButton: true,
        });
      }
  }, [service, refresh, router]);

  React.useEffect(() => {
    if (service.mode !== "connected") return;
    // One gate per provider: an effect re-run must not re-baseline (and so swallow) a pending arrival.
    const gate = (toastGate.current ??= createToastGate(Date.now, DEVELOPMENT ? traceToastGate : undefined));
    const onFocus = () => showToasts(gate.flush());
    window.addEventListener("focus", onFocus);
    const stop = startForegroundPoll(async () => {
      const next = await service.getOverview();
      const known = overviewRef.current;
      // Keep the bell and any open list current without flashing a loading state.
      if (!mutating.current && (!known || known.unreadCount !== next.unreadCount)) {
        setOverview(next);
        setRevision((value) => value + 1);
      }
      const unread = await service.list({ projectId: "all", category: "all", read: "unread", page: 1, pageSize: 20 });
      // Focus is checked when the result is in hand; unfocused, arrivals stay pending (not consumed).
      showToasts(gate.observe(unread.items, { present: document.hasFocus() }));
    }, {
      // A failed refresh records nothing in the gate; say so in development instead of failing silently.
      onError: DEVELOPMENT ? (failure) => console.warn("[EPRP toasts] refresh failed; nothing recorded", failure) : undefined,
    });
    return () => {
      stop();
      window.removeEventListener("focus", onFocus);
    };
  }, [service, showToasts]);

  const mutate = async (operation: () => Promise<unknown>): Promise<boolean> => {
    if (mutating.current) return false;
    mutating.current = true; setBusy(true); setError(null);
    try { await operation(); return await refresh(); }
    catch (failure) { setError(message(failure)); return false; }
    finally { mutating.current = false; setBusy(false); }
  };
  const value: NotificationContextValue = {
    overview, service, loading, busy, error, revision, refresh,
    setRead: (id, read) => mutate(() => service.setRead(id, read)),
    markAllRead: () => { const cutoff = new Date().toISOString(); return mutate(() => service.markAllRead(cutoff)); },
    clearHistory: () => mutate(() => service.clearHistory()),
    savePreferences: (next) => mutate(() => service.savePreferences(next)),
    setDevelopment: (enabled) => {
      if (process.env.NODE_ENV !== "development" || mutating.current) return;
      epoch.current++; setOverview(null); setLoading(true); setError(null);
      const samples = developmentNotifications();
      setService(enabled ? createNotificationAdapter("development", samples.items, samples.options) : createDefaultNotificationService());
    },
    simulateReadFailure: () => { if (process.env.NODE_ENV === "development") { failNextRead.current = true; void refresh(); } },
    showTestToast: () => {
      if (!DEVELOPMENT) return;
      const sample = developmentNotifications().items[0];
      // A sample item whose target is not its project, so the toast has no live link.
      showToasts({ show: [{ ...sample, id: `test-${Date.now()}`, target: { ...sample.target, projectId: "00000000-0000-4000-8000-000000000000" },
        toast: { title: "Test toast", description: "Renderer check: top-centre, about 12 s, amber bell\nDevelopment preview · no real notification", actionLabel: "View details" } }], overflow: 0 });
    },
  };
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
export function useNotifications(): NotificationContextValue {
  const value = React.useContext(NotificationContext);
  if (!value) throw new Error("Notification components need NotificationProvider.");
  return value;
}
export function useNotificationPage(query: NotificationQuery) {
  const { service, revision } = useNotifications();
  const key = JSON.stringify({ query, revision });
  const [result, setResult] = React.useState<{ key: string; page: NotificationPage | null; error: string | null }>({ key: "", page: null, error: null });
  React.useEffect(() => {
    let cancelled = false;
    const parsed = JSON.parse(key) as { query: NotificationQuery };
    void service.list(parsed.query).then(
      (page) => { if (!cancelled) setResult({ key, page, error: null }); },
      (failure: unknown) => { if (!cancelled) setResult({ key, page: null, error: message(failure) }); },
    );
    return () => { cancelled = true; };
  }, [key, service]);
  return result.key === key ? { ...result, loading: false } : { page: null, error: null, loading: true };
}
