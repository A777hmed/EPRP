"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CheckCheck, ChevronLeft, ChevronRight, Eraser, ExternalLink, Filter, Mail, MailOpen, RefreshCw, Settings2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { defaultQuery, groupNotifications, notificationCategories, notificationHref, type NotificationItem, type NotificationQuery } from "./model";
import { useNotificationPage, useNotifications } from "./provider";

export function NotificationModeNotice() {
  const { service, busy, setDevelopment, simulateReadFailure, showTestToast } = useNotifications();
  const demo = service.mode === "development";
  const connected = service.mode === "connected";
  return <div className={cn("rounded-lg border px-4 py-3 text-sm", demo ? "border-amber-300/60 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" : "bg-muted/30")}>
    <p className="font-medium">{demo ? "Development preview · sample notifications" : connected ? "Project Setup approvals" : "Notification delivery is not connected yet"}</p>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{demo ? "These are sample records, not your work. Read states and preferences stay in this tab and reset on reload." : connected ? "Project Setup amendment requests and decisions are delivered here. Read state is saved; preferences are kept in this tab only and never hide a request that needs your decision." : "Your inbox will remain empty until the notification backend is connected. Preferences are kept in this tab only."}</p>
    {process.env.NODE_ENV === "development" && <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setDevelopment(!demo)}>{demo ? "Exit sample preview" : "Preview sample notifications"}</Button>
      {demo && <Button size="sm" variant="ghost" disabled={busy} onClick={simulateReadFailure}>Simulate connection error</Button>}
      {/* Renderer check: one sample toast through the real toast path (top-centre, ~12 s, bell). */}
      <Button size="sm" variant="ghost" onClick={showTestToast}>Show test toast</Button>
    </div>}
  </div>;
}
export function NotificationError({ text, retry }: { text: string; retry: () => void }) {
  return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
    <p className="text-sm font-medium">Could not update notifications</p><p className="mt-1 text-sm text-muted-foreground">{text}</p>
    <Button variant="outline" size="sm" className="mt-3" onClick={retry}><RefreshCw className="size-3.5" />Try again</Button>
  </div>;
}
function NotificationFilters({ query, onChange }: { query: NotificationQuery; onChange: (query: NotificationQuery) => void }) {
  const { overview, loading } = useNotifications();
  const update = (patch: Partial<NotificationQuery>) => onChange({ ...query, ...patch, page: 1 });
  const control = "mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    <label className="text-xs font-medium text-muted-foreground">Project<select aria-label="Filter notifications by project" className={control} value={query.projectId} disabled={loading} onChange={(event) => update({ projectId: event.target.value })}><option value="all">All permitted projects</option>{overview?.options.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <label className="text-xs font-medium text-muted-foreground">Type<select aria-label="Filter notifications by type" className={control} value={query.category} disabled={loading} onChange={(event) => update({ category: event.target.value as NotificationQuery["category"] })}><option value="all">All types</option>{overview?.options.categories.map((category) => <option key={category} value={category}>{notificationCategories[category].label}</option>)}</select></label>
    <label className="text-xs font-medium text-muted-foreground">Read status<select aria-label="Filter notifications by read status" className={control} value={query.read} onChange={(event) => update({ read: event.target.value as NotificationQuery["read"] })}><option value="all">All notifications</option><option value="unread">Unread</option><option value="read">Read</option></select></label>
  </div>;
}
function SentTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  return <time dateTime={iso} title={date.toLocaleString()}>{date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>;
}
/**
 * One presentation for every notification: structured rows when the item has
 * them (project and time are rows, so nothing repeats under the card), the
 * short description otherwise.
 */
function NotificationBody({ item }: { item: NotificationItem }) {
  if (item.details?.length) {
    return <dl className="mt-2 grid gap-1 text-xs">
      {item.details.map((detail, index) => <div key={`${detail.label}-${index}`} className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
        <dt className="font-medium text-foreground">{detail.label}</dt>
        <dd className="min-w-0 break-words text-muted-foreground">{detail.value}</dd>
      </div>)}
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
        <dt className="font-medium text-foreground">Notification sent</dt>
        <dd className="min-w-0 text-muted-foreground"><SentTime iso={item.createdAt} /></dd>
      </div>
    </dl>;
  }
  return <>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
    <p className="mt-2 text-xs text-muted-foreground">{item.projectName} · Notification sent <SentTime iso={item.createdAt} /></p>
  </>;
}
export function NotificationFeed({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const center = useNotifications();
  const router = useRouter();
  const [query, setQuery] = React.useState({ ...defaultQuery, pageSize: compact ? 5 : 10 });
  const result = useNotificationPage(query);
  const [sampleDestination, setSampleDestination] = React.useState<string | null>(null);
  const filtered = query.projectId !== "all" || query.category !== "all" || query.read !== "all";
  const loading = center.loading || result.loading;
  const error = center.error ?? result.error;
  const page = result.page;
  return <div className="space-y-4">
    <NotificationFilters query={query} onChange={setQuery} />
    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
      <p className="text-xs text-muted-foreground" role="status">{loading ? "Loading notifications…" : error ? "Notifications unavailable" : `${page?.total ?? 0} ${filtered ? "matching notifications" : "notifications"}`}</p>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" disabled={loading || center.busy || Boolean(error) || !center.overview?.unreadCount} onClick={() => { void center.markAllRead(); }}><CheckCheck className="size-4" />Mark all read</Button>
        <ConfirmDialog
          trigger={<Button size="sm" variant="ghost" disabled={loading || center.busy || Boolean(error) || (!filtered && !page?.total)}><Eraser className="size-4" />Clear history</Button>}
          title="Clear notification history?"
          description="Removes resolved and informational notifications from your inbox. Items that still require your action remain visible. Project and approval history are not affected."
          confirmLabel="Clear history"
          cancelLabel="Cancel"
          onConfirm={async () => {
            // The provider refreshes the bell and every open list on success; a failure keeps the dialog open.
            if (!(await center.clearHistory())) throw new Error("Notification history could not be cleared.");
          }}
        />
      </div>
    </div>
    {sampleDestination && <div role="status" className="rounded-lg border bg-muted/40 p-3 text-xs break-all">Sample destination: {sampleDestination}. No real report is opened in this preview.</div>}
    {error ? <NotificationError text={error} retry={() => { void center.refresh(); }} /> : loading ? <div aria-label="Loading notifications" role="status" className="space-y-4">{[1, 2, 3].map((number) => <div key={number} className="flex gap-3"><Skeleton className="size-9 shrink-0 rounded-lg" /><div className="w-full space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div> : !page?.items.length ? <div className="flex flex-col items-center px-4 py-12 text-center">
      <div className="mb-4 rounded-full bg-muted p-4">{filtered ? <Filter className="size-6 text-muted-foreground" /> : <BellOff className="size-6 text-muted-foreground" />}</div>
      <h2 className="text-base font-semibold">{filtered ? "No notifications match these filters" : "Your inbox is clear"}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{filtered ? "Try another project or type, or clear the filters to see your inbox." : "Updates and reminders will appear here when notification delivery is connected."}</p>
      {filtered && <Button variant="outline" size="sm" className="mt-4" onClick={() => setQuery({ ...defaultQuery, pageSize: query.pageSize })}>Clear filters</Button>}
    </div> : <div className="space-y-5">{groupNotifications(page.items).map((group) => <section key={group.label} aria-label={group.label}>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</h2>
      <ul className="space-y-2">{group.items.map((item) => {
        const href = item.projectId === item.target.projectId ? notificationHref(item.target) : null;
        const unread = !item.readAt;
        return <li key={item.id} data-unread={unread ? "true" : undefined} className={cn("rounded-lg border p-3 transition-colors", unread ? "border-l-4 border-primary/30 border-l-primary bg-primary/[0.06] shadow-sm" : "bg-background")}>
          <div className="flex items-start gap-3">
            <span className={cn("mt-1 rounded-md p-2", unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{item.readAt ? <MailOpen className="size-4" /> : <Mail className="size-4" />}</span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2"><Badge variant="secondary" className="text-[10px]">{notificationCategories[item.category].label}</Badge>{unread && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary"><span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />Unread</span>}</div>
              {href ? <Link href={href} className={cn("text-sm leading-snug hover:underline focus-visible:outline-ring", unread ? "font-semibold text-foreground" : "font-medium text-foreground/80")} onClick={(event) => {
                event.preventDefault();
                if (center.service.mode === "development") { setSampleDestination(href); void center.setRead(item.id, true); return; }
                void center.setRead(item.id, true).then(() => { onOpen?.(); router.push(href); });
              }}>{item.title}<ExternalLink aria-hidden="true" className="ml-1 inline size-3" /></Link> : <p className={cn("text-sm", unread ? "font-semibold" : "font-medium text-foreground/80")}>{item.title}</p>}
              <NotificationBody item={item} />
            </div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" disabled={center.busy} aria-label={`Mark ${item.title} as ${item.readAt ? "unread" : "read"}`} onClick={() => { void center.setRead(item.id, !item.readAt); }}>{item.readAt ? <Mail className="size-4" /> : <MailOpen className="size-4" />}</Button>
          </div>
        </li>;
      })}</ul>
    </section>)}</div>}
    {!loading && !error && page && page.total > 0 && <nav aria-label={compact ? "Panel notification pages" : "Notification history pages"} className="flex items-center justify-between border-t pt-4">
      <Button variant="outline" size="sm" disabled={page.page <= 1} onClick={() => setQuery({ ...query, page: page.page - 1 })}><ChevronLeft className="size-4" />Previous</Button>
      <span className="text-xs text-muted-foreground">Page {page.page} of {page.pageCount}</span>
      <Button variant="outline" size="sm" disabled={page.page >= page.pageCount} onClick={() => setQuery({ ...query, page: page.page + 1 })}>Next<ChevronRight className="size-4" /></Button>
    </nav>}
  </div>;
}
export function NotificationBell() {
  const { overview, loading, error } = useNotifications();
  const [open, setOpen] = React.useState(false);
  const unread = overview?.unreadCount ?? 0;
  const label = loading ? "Notifications, loading" : error ? "Notifications unavailable, open to retry" : `Notifications, ${unread} unread`;
  // 13.11 UAT: the badge bumps once when the unread count goes up (never on
  // the first load, never looping; static under reduced motion).
  const [bump, setBump] = React.useState(0);
  const seenUnread = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (loading || error) return;
    if (seenUnread.current !== null && unread > seenUnread.current) setBump((count) => count + 1);
    seenUnread.current = unread;
  }, [unread, loading, error]);
  return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button variant="ghost" size="icon" className="relative" aria-label={label}><Bell aria-hidden="true" />{!loading && !error && unread > 0 && <span key={bump} aria-hidden="true" data-bump={bump > 0 ? "true" : undefined} className="notif-badge absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">{unread > 9 ? "9+" : unread}</span>}{error && <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-amber-500" />}</Button></SheetTrigger>
    <SheetContent size="wide" className="gap-0 data-[side=right]:sm:max-w-lg data-[side=right]:lg:max-w-lg">
      <SheetHeader className="border-b pr-12"><SheetTitle>Notifications</SheetTitle><SheetDescription>Updates that matter to your work.</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mb-4"><NotificationModeNotice /></div><NotificationFeed compact onOpen={() => setOpen(false)} /></div>
      <div className="flex flex-wrap justify-between gap-2 border-t p-4"><Button variant="outline" asChild><Link href="/notifications" onClick={() => setOpen(false)}>View full history</Link></Button><Button variant="ghost" size="sm" asChild><Link href="/settings/notifications" onClick={() => setOpen(false)}><Settings2 className="size-4" />Preferences</Link></Button></div>
    </SheetContent>
  </Sheet>;
}
export function NotificationHistory() {
  return <div className="space-y-6"><PageHeader eyebrow="Your workspace" title="Notifications" description="Your updates, reminders and notification history." actions={<Button variant="outline" asChild><Link href="/settings/notifications"><Settings2 className="size-4" />Preferences</Link></Button>} /><NotificationModeNotice /><div className="rounded-xl border bg-card p-4 sm:p-6"><NotificationFeed /></div></div>;
}
