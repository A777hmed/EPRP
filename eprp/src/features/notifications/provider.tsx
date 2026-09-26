"use client";

import * as React from "react";
import { createNotificationAdapter, developmentNotifications, type NotificationOverview, type NotificationPage, type NotificationPreferences, type NotificationQuery, type NotificationService } from "./model";

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
  savePreferences(value: NotificationPreferences): Promise<boolean>;
  setDevelopment(enabled: boolean): void;
  simulateReadFailure(): void;
}
const NotificationContext = React.createContext<NotificationContextValue | null>(null);
const message = (error: unknown) => error instanceof Error ? error.message : "Notifications could not be loaded. Try again.";
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [service, setService] = React.useState<NotificationService>(() => createNotificationAdapter());
  const [overview, setOverview] = React.useState<NotificationOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const epoch = React.useRef(0);
  const mutating = React.useRef(false);
  const failNextRead = React.useRef(false);
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
    savePreferences: (next) => mutate(() => service.savePreferences(next)),
    setDevelopment: (enabled) => {
      if (process.env.NODE_ENV !== "development" || mutating.current) return;
      epoch.current++; setOverview(null); setLoading(true); setError(null);
      const samples = developmentNotifications();
      setService(enabled ? createNotificationAdapter("development", samples.items, samples.options) : createNotificationAdapter());
    },
    simulateReadFailure: () => { if (process.env.NODE_ENV === "development") { failNextRead.current = true; void refresh(); } },
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
