"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Check, Save, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { notificationCategories, type NotificationOptions, type NotificationPreferences } from "./model";
import { NotificationError, NotificationModeNotice } from "./notification-center";
import { useNotifications } from "./provider";

function PreferencesEditor({ initial, options }: { initial: NotificationPreferences; options: NotificationOptions }) {
  const center = useNotifications();
  const [draft, setDraft] = React.useState(() => structuredClone(initial));
  const [baseline, setBaseline] = React.useState(() => structuredClone(initial));
  const [saved, setSaved] = React.useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const patch = (next: NotificationPreferences) => { setDraft(next); setSaved(false); };
  const save = async () => {
    const submitted = structuredClone(draft);
    if (await center.savePreferences(submitted)) { setBaseline(submitted); setSaved(true); }
  };
  return <div className="space-y-5">
    <section aria-labelledby="notification-category-heading" className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b p-4 sm:p-6"><h2 id="notification-category-heading" className="font-semibold">Choose your notifications</h2><p className="mt-1 text-sm text-muted-foreground">All categories are optional, including tasks and approval notifications.</p></div>
      <div className="divide-y">{options.categories.map((category) => <div key={category} className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div><label htmlFor={`notification-${category}`} className="text-sm font-medium">{notificationCategories[category].label}</label><p id={`notification-${category}-description`} className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{notificationCategories[category].description}</p></div>
        <Switch id={`notification-${category}`} aria-describedby={`notification-${category}-description`} checked={draft.categories[category]} disabled={center.busy} onCheckedChange={(enabled) => patch({ ...draft, categories: { ...draft.categories, [category]: enabled } })} />
      </div>)}</div>
    </section>
    <section aria-labelledby="notification-project-heading" className="rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex items-start gap-3"><SlidersHorizontal className="mt-0.5 size-5 text-muted-foreground" /><div><h2 id="notification-project-heading" className="font-semibold">Projects you follow</h2><p className="mt-1 text-sm text-muted-foreground">Follow informational updates from projects you are permitted to read. Following a project grants no editing or approval permissions.</p></div></div>
      {!options.canFollowProjects || !options.projects.length ? <div className="mt-4 rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">Permitted project subscriptions will be available after backend integration. No project access is inferred here.</div> : <fieldset className="mt-4 space-y-2"><legend className="sr-only">Permitted project subscriptions</legend>{options.projects.map((project) => <label key={project.id} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={draft.followedProjectIds.includes(project.id)} disabled={center.busy} onChange={(event) => patch({ ...draft, followedProjectIds: event.target.checked ? [...draft.followedProjectIds, project.id] : draft.followedProjectIds.filter((id) => id !== project.id) })} />{project.name}</label>)}</fieldset>}
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Project Control defines deadlines separately for each project. These preferences do not change reporting dates, responsibilities or workflow permissions.</p>
    </section>
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-muted-foreground" role="status">{saved && !dirty ? <span className="flex items-center gap-1.5 text-foreground"><Check className="size-4" />Saved for this tab only</span> : dirty ? "Unsaved preference changes" : "Preferences are not saved remotely"}<p className="mt-1">Changes reset on reload. Email and push delivery are not enabled.</p></div>
      <Button disabled={!dirty || center.busy} onClick={() => { void save(); }}><Save className="size-4" />{center.busy ? "Saving…" : "Save for this tab"}</Button>
    </div>
  </div>;
}
export function NotificationPreferencesView() {
  const center = useNotifications();
  // Adapter switching deliberately replaces a session; ordinary read-state changes
  // do not remount the editor or discard unsaved preference edits.
  return <div className="space-y-6"><PageHeader eyebrow="Personal preferences" title="Notification preferences" description="Choose what you want to hear about, without changing your responsibilities." actions={<Button variant="outline" asChild><Link href="/notifications"><ArrowLeft className="size-4" />Notifications</Link></Button>} /><NotificationModeNotice />
    {center.error && <NotificationError text={center.error} retry={() => { void center.refresh(); }} />}
    {!center.overview ? <div aria-label="Loading notification preferences" role="status" className="space-y-4"><Skeleton className="h-48 w-full rounded-xl" /><Skeleton className="h-32 w-full rounded-xl" /></div> : <PreferencesEditor key={center.service.mode} initial={center.overview.preferences} options={center.overview.options} />}
  </div>;
}
